import type { TimelineEntry } from "@case404/shared";
import { useEffect, useState } from "react";
import { ApiError, api } from "../../api";
import { ErrorNote, Loading } from "../../components/ui";
import { useCaseData } from "../../state/caseData";
import { useTeam } from "../../state/team";

const day = (iso: string) => {
  const d = iso.slice(0, 10);
  return d === "2026-10-31" ? "31 October" : d === "2026-11-01" ? "1 November" : new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
};

/** The case timeline: what was known when you arrived, and what each owned challenge established. */
export function TimelinePanel() {
  const { state } = useTeam();
  const { challenges } = useCaseData();
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const solvedKey = state?.solvedIds.join(",");

  useEffect(() => {
    api
      .timeline()
      .then(setEntries)
      .catch((e: ApiError) => setError(e.message));
  }, [solvedKey]);

  if (error && !entries) return <ErrorNote>{error}</ErrorNote>;
  if (!entries) return <Loading label="Loading the timeline" />;
  const title = (id: string) => challenges?.find((c) => c.id === id)?.title ?? id;

  let lastDay = "";
  return (
    <div className="timeline-panel">
      <h2>Timeline</h2>
      <p className="muted small">What you knew when you arrived, plus everything your team has established. Each owned challenge adds to it.</p>
      <ol className="timeline">
        {entries.map((e) => {
          const d = day(e.at);
          const heading = d !== lastDay ? d : null;
          lastDay = d;
          return (
            <li key={e.id} className={e.struck ? "struck" : undefined}>
              {heading && <span className="timeline-day">{heading}</span>}
              <div className="timeline-row">
                <span className="timeline-time mono">{e.label}</span>
                <div>
                  {e.struck ? (
                    <p>
                      <del>{e.text}</del> <span className="visually-hidden">(no longer holds)</span>
                    </p>
                  ) : (
                    <p>{e.text}</p>
                  )}
                  <span className="timeline-source">{e.source ? `From “${title(e.source)}”` : "Known at the start"}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
