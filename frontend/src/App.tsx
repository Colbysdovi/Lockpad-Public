import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { HomePage, FolderPage, TagPage, ArchivePage, TrashPage } from "@/pages/ListPages";
import { SettingsPage } from "@/pages/SettingsPage";
import { LoginScreen } from "@/components/LoginScreen";
import { ServerUnreachable } from "@/components/ServerUnreachable";
import { useAuth } from "@/lib/auth";
import { OnboardingGate } from "@/components/onboarding/OnboardingGate";

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

  // Nothing renders until the server has said whether a password is required —
  // showing the app and then yanking it away, or flashing a login screen at someone
  // who has no password set, are both worse than a moment of "Loading…".
  //
  // `open` (no password configured) and `authed` both fall through to the app.
  if (status === "loading") {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-canvas text-muted-foreground">Loading…</div>;
  }
  if (status === "needs-login") {
    return <LoginScreen />;
  }
  // The server never answered. Distinct from needs-login on purpose: a password box
  // here can never succeed, because the login endpoint is just as unreachable.
  if (status === "unreachable") {
    return <ServerUnreachable />;
  }

  // Mounted beside the routes rather than inside Layout, because the welcome
  // animation covers the whole viewport and should not be a child of the sidebar
  // and top bar it is meant to precede. It renders nothing at all for anyone who
  // has already been onboarded, which is everyone except a genuinely new install.
  return (
    <>
      <OnboardingGate />
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
    </>
  );
}
