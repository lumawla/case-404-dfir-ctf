import { Suspense, lazy } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Loading } from "./components/ui";
import { CreateTeam, JoinTeam } from "./routes/JoinCreate";
import { Landing } from "./routes/Landing";
import { Leaderboard, Scoreboard } from "./routes/Leaderboard";
import { Lobby } from "./routes/Lobby";
import { NotFound } from "./routes/NotFound";
import { SettingsProvider } from "./state/settings";
import { TeamProvider, useTeam } from "./state/team";
import { ToastProvider } from "./state/toasts";

const CaseShell = lazy(() => import("./routes/case/CaseShell"));
const Workspace = lazy(() => import("./routes/case/Workspace"));
const CaseFilePage = lazy(() => import("./routes/case/CaseFilePage"));
const AccusePage = lazy(() => import("./routes/case/AccusePage"));
const ResultPage = lazy(() => import("./routes/case/ResultPage"));
const Admin = lazy(() => import("./routes/Admin"));
const Practice = lazy(() => import("./routes/Practice"));

function CaseScoreboard() {
  const { state } = useTeam();
  return (
    <div className="page">
      <Scoreboard highlight={state?.team.name} />
    </div>
  );
}

export function App() {
  return (
    <SettingsProvider>
      <ToastProvider>
        <TeamProvider>
          <BrowserRouter>
            <Suspense
              fallback={
                <div className="page">
                  <Loading />
                </div>
              }
            >
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/join" element={<JoinTeam />} />
                <Route path="/create" element={<CreateTeam />} />
                <Route path="/team" element={<Lobby />} />
                <Route path="/team/practice" element={<Practice />} />
                <Route path="/leaderboard" element={<Leaderboard />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/case" element={<CaseShell />}>
                  <Route index element={<Workspace />} />
                  <Route path="file" element={<CaseFilePage />} />
                  <Route path="accuse" element={<AccusePage />} />
                  <Route path="scoreboard" element={<CaseScoreboard />} />
                  <Route path="result" element={<ResultPage />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </TeamProvider>
      </ToastProvider>
    </SettingsProvider>
  );
}
