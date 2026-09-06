import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { HomePage, FolderPage, TagPage, ArchivePage, TrashPage } from "@/pages/ListPages";
import { SettingsPage } from "@/pages/SettingsPage";
import { LoginScreen } from "@/components/LoginScreen";
import { ServerUnreachable } from "@/components/ServerUnreachable";
import { useAuth } from "@/lib/auth";
import { OnboardingGate } from "@/components/onboarding/OnboardingGate";
import { useT } from "@/lib/i18n";

// The route table, and the password gate in front of it.
//
// Every screen renders inside Layout (the sidebar, top bar, and the note sheet), so
// the routes below only decide what fills the content area.
//
// An OPEN NOTE IS NOT A ROUTE. It is the `?note=<id>` query parameter on whatever
// list you were already looking at, which is what lets the note appear as a sheet
// over a list that stays mounted and scrolled where you left it. A shared /notes/:id
// link still works — it redirects to the home list with that parameter set, so the
// note opens over a real list rather than over nothing.
function NoteRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/?note=${id}`} replace />;
}

export default function App() {
  const { status } = useAuth();
  const t = useT();

  // Nothing renders until the server has said whether a password is required —
  // showing the app and then yanking it away, or flashing a login screen at someone
  // who has no password set, are both worse than a moment of "Loading…".
  //
  // `open` (no password configured) and `authed` both fall through to the app.
  if (status === "loading") {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-canvas text-muted-foreground">{t("common.loading")}</div>;
  }
  if (status === "needs-login") {
    return <LoginScreen />;
  }
  // The server never answered. Distinct from needs-login on purpose: a password box
  // here can never succeed, because the login endpoint is just as unreachable.
  if (status === "unreachable") {
    return <ServerUnreachable />;
  }

  // The route table is WRAPPED by the gate, not placed beside it, and that nesting
  // is the whole mechanism: on a genuinely new install the gate withholds everything
  // below until the welcome animation and the wizard are done, so the app is never
  // glimpsed underneath them, and then hands it back with a slow fade up from the
  // page canvas. On every other load it is a plain passthrough that renders the
  // routes and no extra markup — see OnboardingGate for the full sequence.
  return (
    <OnboardingGate>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/folders/:id" element={<FolderPage />} />
          <Route path="/tags/:id" element={<TagPage />} />
          <Route path="/archive" element={<ArchivePage />} />
          <Route path="/trash" element={<TrashPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="/notes/:id" element={<NoteRedirect />} />
      </Routes>
    </OnboardingGate>
  );
}
