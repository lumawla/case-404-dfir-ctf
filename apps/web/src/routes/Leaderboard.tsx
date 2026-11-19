import type { LeaderboardRow } from "@case404/shared";
import { useEffect, useState } from "react";
import { ApiError, api } from "../api";
import { Loading, clockTime } from "../components/ui";
import { PublicLayout } from "./PublicLayout";

const STATUS: Record<string, string> = {
  NOT_STARTED: "In lobby",
  ACTIVE: "Investigating",
  SOLVED: "Case closed",
  WRONG_VERDICT: "Wrong accusation",
  TIME_EXPIRED: "Out of time",
};

export function LeaderboardTable({ rows, highlight }: { rows: LeaderboardRow[]; highlight?: string }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="visually-hidden">Scoreboard</caption>
        <thead>
          <tr>
            <th scope="col" className="num">
              #
            </th>
            <th scope="col">Team</th>
            <th scope="col" className="num">
              Points
            </th>
            <th scope="col" className="num">
              Owned
            </th>
            <th scope="col">Status</th>
            <th scope="col">Last score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.teamName} className={r.teamName === highlight ? "me" : undefined}>
              <td className="num">{r.rank}</td>
              <td style={{ fontWeight: 650, color: "var(--text-strong)" }}>{r.teamName}</td>
              <td className="num">{r.score}</td>
              <td className="num">{r.solvedCount}/6</td>
              <td>{STATUS[r.status] ?? r.status}</td>
              <td className="mono small">{r.lastScoreAt ? clockTime(r.lastScoreAt) : "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                No teams yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Scoreboard({ highlight }: { highlight?: string }) {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [hidden, setHidden] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .leaderboard()
        .then((r) => alive && (setRows(r.rows), setHidden(null)))
        .catch((e: ApiError) => alive && setHidden(e.message));
    load();
    const id = window.setInterval(load, 10_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="stack">
      <div>
        <p className="eyebrow">Case 404</p>
        <h1>Scoreboard</h1>
        <p className="muted" style={{ margin: 0 }}>
          Ranked by points; ties go to the team that got there first.
        </p>
      </div>
      {hidden ? <p className="empty">{hidden}</p> : rows ? <LeaderboardTable rows={rows} highlight={highlight} /> : <Loading />}
    </div>
  );
}

export function Leaderboard() {
  return (
    <PublicLayout>
      <Scoreboard />
    </PublicLayout>
  );
}
