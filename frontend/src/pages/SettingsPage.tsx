import { useState } from "react";
import { Upload, Download, Lock, Hash, FolderMinus, Info, RotateCcw } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { SettingsSection, DataRow } from "@/components/SettingsPrimitives";
import { LanguageSettings } from "@/components/LanguageSettings";
import { ImportDialog } from "@/components/ImportDialog";
import { CleanupDialog, type CleanupKind } from "@/components/CleanupDialog";
import { SecuritySettings } from "@/components/SecuritySettings";
import { AboutSettings } from "@/components/AboutSettings";
import { OnboardingReplay } from "@/components/onboarding/OnboardingGate";
import { useOnboardingActions } from "@/lib/onboarding";
import { api } from "@/lib/api";
import { downloadText } from "@/lib/download";
import { useT } from "@/lib/i18n";

// The bits of the export file this page reads to describe what just happened. The
// downloaded file carries far more (every note, folder, tag and link — see
// backend/src/routes/export.ts); only the summary counts are typed here.
//
// `skippedLocked` matters: locked notes CANNOT be exported, because the server holds
// only their ciphertext. Rather than silently omitting them, the export names them
// so the user can unlock and re-export, or export those notes individually.
interface ExportFile {
  exportedAt: string;
  counts: { notes: number; folders: number; tags: number; noteLinks: number; skippedLocked: number };
  skippedLocked: { id: string; title: string }[];
}

// Settings — the home for actions that affect the WHOLE library rather than one
// note. Five groups, and the order is the argument:
//
//   Data            Import from other apps; export everything as one JSON file.
//   Getting started The welcome tour, on demand.
//   Security        Who can reach this server, and signing other devices out.
//   About           What you are running.
//   Danger zone     Permanent deletions, with no trash to fall back on.
//
// Data is first because someone who opens Settings is nearly always here to do one
// specific thing, and it is where most of those things live.
//
// Danger zone is LAST, and it used to be second. Reaching a permanent deletion
// should take a scroll: the further it sits from the thing people actually came
// for, the fewer people arrive at it by accident. Everything above it is either
// reversible or merely a fact, so nothing is buried by the move.
//
// Everything here runs against the user's own server. The export is a plain file
// downloaded by the browser and the import is parsed locally — nothing is uploaded
// anywhere, which is worth stating on the page itself and does not change here.
//
// Deliberately not a preferences screen: the theme toggle lives in the top bar
// where it is used, and there is no account to manage.
//
// Not tabs, and not a settings sidebar. Those pay off when there is a genuine
// "advanced" tier worth hiding behind a primary one; eight items in a single
// scroll do not have that shape, and splitting them would add a navigation step to
// every visit in exchange for nothing. Worth revisiting past a dozen items.

export function SettingsPage() {
  const t = useT();
  const [importOpen, setImportOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const { reset: resetOnboarding } = useOnboardingActions();
  // One dialog component, two entry points — null when neither is open.
  const [cleanup, setCleanup] = useState<CleanupKind | null>(null);
  const [exporting, setExporting] = useState(false);
  const [summary, setSummary] = useState<ExportFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const data = await api.get<ExportFile>("/export");
      // Name the file with the export date; download the whole payload verbatim.
      const date = (data.exportedAt ?? new Date().toISOString()).slice(0, 10);
      downloadText(JSON.stringify(data, null, 2), `lockpad-export-${date}.json`, "application/json");
      setSummary(data);
    } catch {
      setError(t("settings.export.failed"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto overscroll-contain">
      <div className="px-5 py-8 sm:px-8">
        <h1 className="type-section mb-1">{t("settings.title")}</h1>
        <p className="mb-8 text-sm text-muted-foreground">
          {t("settings.intro")}
        </p>

        {/* One gap, declared once. Each section now draws its own surface, so the
            separation is carried by the tint rather than by whitespace, and the wide
            `mt-10` every section used to set for itself would read as the page having
            come apart. Setting it here also means a new section cannot forget it. */}
        <div className="space-y-8">
        <SettingsSection
          id="data-heading"
          title={t("settings.data.title")}
          description={t("settings.data.description")}
        >
          <div className="grid gap-3 md:grid-cols-2">
            {/* The full caveat lives HERE rather than in the welcome tour. It is
                advice about how to run an import — bring a small batch first, check
                it — and it is only actionable at the moment somebody is about to do
                one. In the tour it was three lines of hedging aimed at a person who
                has not yet decided whether they have notes to bring, and who cannot
                act on it for another week. The tour says import is optimised for
                Google Keep, which is the fact; this says what to do about it. */}
            <DataRow
              icon={Upload}
              title={t("settings.import.title")}
              description={t("settings.import.description")}
            >
              <Button variant="outline" onClick={() => setImportOpen(true)} className="gap-1.5">
                <Upload className="h-4 w-4" /> {t("settings.import.button")}
              </Button>
            </DataRow>

            <DataRow
              icon={Download}
              title={t("settings.export.title")}
              description={t("settings.export.description")}
            >
              <Button onClick={runExport} disabled={exporting} className="gap-1.5">
                <Download className="h-4 w-4" /> {exporting ? t("settings.export.exporting") : t("settings.export.button")}
              </Button>
            </DataRow>
          </div>

          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

          {summary && (
            <div className="mt-4 rounded-xl border bg-card p-4 text-sm">
              <p className="font-medium">{t("settings.export.complete")}</p>
              <p className="mt-1 text-muted-foreground">
                {/* Three counted nouns in one sentence. Each goes through the
                    plural machinery separately and the sentence that joins them is
                    itself a catalogue string, so a language that orders or joins them
                    differently is free to. */}
                {t("settings.export.saved", {
                  notes: t("settings.export.counts", {
                    notes: t("notes.count", { count: summary.counts.notes }),
                    folders: t("folders.count", { count: summary.counts.folders }),
                    tags: t("tags.count", { count: summary.counts.tags }),
                  }),
                })}
              </p>

              {summary.skippedLocked.length > 0 && (
                <div className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--muted-foreground)_35%,transparent)] bg-[color-mix(in_srgb,var(--muted)_50%,transparent)] p-3">
                  <div className="flex items-center gap-1.5 font-medium">
                    <Lock className="h-4 w-4" />
                    {t("settings.export.skipped", { count: summary.skippedLocked.length })}
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {t("settings.export.skippedWhy")}
                  </p>
                  <ul className="mt-2 list-inside list-disc text-muted-foreground">
                    {summary.skippedLocked.map((n) => (
                      <li key={n.id} className="truncate">{n.title || t("note.untitled")}</li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="mt-3 text-xs text-muted-foreground">
                {t("settings.export.keepSafe")}
              </p>
            </div>
          )}
        </SettingsSection>

        {/* Getting started sits after Data rather than before it: a person who opens
            Settings is nearly always here to do something specific, and a "show me
            the tour again" card at the top would push the thing they actually came
            for below the fold. */}
        <SettingsSection
          id="guide-heading"
          title={t("settings.guide.title")}
          description={t("settings.guide.description")}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <DataRow
              icon={Info}
              title={t("settings.guide.show.title")}
              description={t("settings.guide.show.description")}
            >
              <Button variant="outline" onClick={() => setGuideOpen(true)} className="gap-1.5">
                <Info className="h-4 w-4" /> {t("settings.guide.show.button")}
              </Button>
            </DataRow>

            {import.meta.env.DEV && (
              /* Development only, and compiled out of production builds entirely —
                 `import.meta.env.DEV` is a literal at build time, so Vite removes
                 this whole branch rather than merely hiding it. The server refuses
                 the route in production regardless, because a reset control that
                 ships and simply trusts the client is not a defensible thing for an
                 app whose entire proposition is that your notes are yours.

                 It re-arms the first-run flag and nothing else: no note, folder or
                 tag is touched, which is what makes it safe against the seeded dev
                 library you QA everything else with. */
              <DataRow
                icon={RotateCcw}
                title="Replay first run (dev)"
                description="Re-arms the first-run flag so the welcome animation and the wizard play again on reload. Adds no notes, because starter-note seeding stays done. Never ships to production."
              >
                <Button
                  variant="outline"
                  onClick={() => resetOnboarding.mutate(undefined, { onSuccess: () => window.location.reload() })}
                  className="gap-1.5"
                >
                  <RotateCcw className="h-4 w-4" /> Re-arm
                </Button>
              </DataRow>
            )}
          </div>
        </SettingsSection>

        {/* Language sits above Security and below Getting started. It is the only
            setting here that changes what every other word on the page says, so
            burying it under the destructive sections would mean the person who most
            needs it — someone whose language was guessed wrong — scrolls furthest
            through text they cannot read to reach it. */}
        <LanguageSettings />

        <SecuritySettings />
        <AboutSettings />

        {/* Last on the page, and that position is the feature.
            These two are the only things in Lockpad that delete something with no
            trash to fall back on, so they are kept away from the sections people
            actually come here for and put under a heading that says what they are.
            The cards stay white and the buttons stay ordinary, because "Review" is
            not the destructive action — it opens a dialog that lists what would go
            and asks again, and that dialog is where the delete actually lives. A
            red button here would spend the alarm on the safe step and leave
            nothing louder for the real one. The heading is what marks the group. */}
        <SettingsSection
          id="danger-heading"
          title={t("settings.danger.title")}
          description={t("settings.danger.description")}
          tone="danger"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <DataRow
              icon={Hash}
              tone="danger"
              title={t("settings.cleanupTags.title")}
              description={t("settings.cleanupTags.description")}
            >
              <Button variant="outline" onClick={() => setCleanup("tags")} className="gap-1.5">
                <Hash className="h-4 w-4" /> {t("cleanup.review")}
              </Button>
            </DataRow>

            <DataRow
              icon={FolderMinus}
              tone="danger"
              title={t("settings.cleanupFolders.title")}
              description={t("settings.cleanupFolders.description")}
            >
              <Button variant="outline" onClick={() => setCleanup("folders")} className="gap-1.5">
                <FolderMinus className="h-4 w-4" /> {t("cleanup.review")}
              </Button>
            </DataRow>
          </div>
        </SettingsSection>
        </div>
      </div>

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <OnboardingReplay open={guideOpen} onClose={() => setGuideOpen(false)} />
      {cleanup && (
        <CleanupDialog
          key={cleanup}
          kind={cleanup}
          open
          onOpenChange={(next) => { if (!next) setCleanup(null); }}
        />
      )}
    </div>
  );
}
