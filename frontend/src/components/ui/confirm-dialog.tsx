import * as React from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

// In-app confirmation for irreversible actions.
//
// This exists because `window.confirm` cannot be relied on: browsers suppress it in
// a growing number of situations (no recent user gesture, a user who ticked "prevent
// this page from creating more dialogs", installed-PWA windows), and a suppressed
// confirm does not throw — it silently returns false. Every caller here is written
// as "bail out unless confirmed", so a blocked dialog turned a destructive button
// into a button that did nothing at all, with no error and no feedback.
//
// The confirm step is deliberately part of the same component as the action's own
// button so the two can't drift apart: there is no way to render the trigger without
// the guard.

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  pending = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What will actually happen, in plain terms — including what is NOT affected. */
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm gap-4">
        <div className="flex flex-col gap-1.5">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </div>
        {/* Cancel first in the DOM so it takes initial focus: the safe choice should
            be the one a stray Enter lands on. */}
        <div className="flex justify-end gap-2 border-t pt-4 max-sm:pt-5">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending} className="max-sm:h-12 max-sm:text-base">
            {cancelLabel ?? t("common.cancel")}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={pending}
            className="max-sm:h-12 max-sm:text-base"
          >
            {confirmLabel ?? t("confirm.confirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
