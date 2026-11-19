import { CHALLENGE_IDS, type ResultView } from "@case404/shared";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../../api";
import { ErrorNote, Loading, formatDuration } from "../../components/ui";
import { useTeam } from "../../state/team";

export default function ResultPage() {
  const { state } = useTeam();
  const [result, setResult] = useState<ResultView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusKey = `${state?.team.status}|${state?.event.revealed}`;

  useEffect(() => {
    api
      .result()
      .then(setResult)
      .catch((e: ApiError) => setError(e.message));
  }, [statusKey]);

  if (error) return <div className="page"><ErrorNote>{error}</ErrorNote></div>;
  if (!result) return <div className="page"><Loading /></div>;

  const solved = result.status === "SOLVED";
  const closed = result.status !== "ACTIVE" && result.status !== "NOT_STARTED";
  return (
    <div className="page stack">
      <section className="result-hero">
        <img
          src={solved ? "/art/result-solved.svg" : "/art/result-unsolved.svg"}
          alt={solved ? "A closed case file stamped CLOSED, with a photograph clipped to its corner." : "A sealed case file marked UNRESOLVED."}
          width={800}
          height={500}
          style={{ borderRadius: "var(--radius-lg)", border: "1px solid var(--rule)" }}
        />
        <div className="stack-sm">
          <p className="eyebrow">Team {result.teamName}</p>
          <h1 style={{ margin: 0 }}>{result.ending.title}</h1>
          <p style={{ fontSize: "var(--text-lg)", margin: 0 }}>{result.ending.text}</p>
          {!closed && (
            <p className="muted" style={{ margin: 0 }}>
              Still running. <Link to="/case">Back to the workspace</Link>.
            </p>
          )}
        </div>
      </section>

      <section className="stats" aria-label="Results">
        <div className="stat">
          <span className="value">{result.score.total}</span>
          <span className="label">Points</span>
        </div>
        <div className="stat">
          <span className="value">{formatDuration(result.elapsedSeconds)}</span>
          <span className="label">Time</span>
        </div>
        <div className="stat">
          <span className="value">
            {result.solvedIds.length}/{CHALLENGE_IDS.length}
          </span>
          <span className="label">Challenges owned</span>
        </div>
        <div className="stat">
          <span className="value">{result.wrongAttempts}</span>
          <span className="label">Wrong accusations</span>
        </div>
      </section>
      <p className="small muted" style={{ margin: 0 }}>
        Flags +{result.score.flagPoints} · Accusation +{result.score.verdictPoints}
        {result.score.bonusPoints ? ` · Accomplice +${result.score.bonusPoints}` : ""} · Penalties −{result.score.penalties}
      </p>
      {result.accompliceNamed === false && <p className="small muted" style={{ margin: 0 }}>Your accusation didn't name the person who helped.</p>}

      {result.reconstruction ? (
        <section className="card stack-sm" aria-labelledby="what-happened">
          <h2 id="what-happened">What happened</h2>
          <p className="reconstruction">{result.reconstruction.text}</p>
          <p className="stinger">{result.reconstruction.stinger}</p>
          {result.reconstruction.answers.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Challenge</th>
                    <th scope="col">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {result.reconstruction.answers.map((a) => (
                    <tr key={a.challengeId}>
                      <td>{a.title}</td>
                      <td className="mono">{a.flag}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        closed && <p className="muted">The full story is shown here after the organizers' closing reveal.</p>
      )}

      <div className="row">
        <Link className="btn" to="/case/scoreboard">
          Scoreboard
        </Link>
        <Link className="btn btn-ghost" to="/case">
          Back to the files
        </Link>
      </div>
    </div>
  );
}
