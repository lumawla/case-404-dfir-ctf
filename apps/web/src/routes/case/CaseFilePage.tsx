import type { CaseFile, PersonView } from "@case404/shared";
import { useEffect, useState } from "react";
import { ApiError, api, fileUrl } from "../../api";
import { ErrorNote, Loading, Portrait } from "../../components/ui";

function Person({ p }: { p: PersonView }) {
  return (
    <article className="person">
      <Portrait src={p.portrait} alt={p.portraitAlt} note={p.portraitNote} lazy />
      <div className="person-body">
        <h3>{p.name}</h3>
        <span className="alias">{p.alias}</span>
        <dl>
          <dt>Role</dt>
          <dd>{p.role}</dd>
          <dt>Costume</dt>
          <dd>{p.costume}</dd>
          <dt>Connection</dt>
          <dd>{p.relationship}</dd>
        </dl>
      </div>
    </article>
  );
}

/** The story: briefing, victim, persons of interest and the venue. Evidence lives in the terminal. */
export default function CaseFilePage() {
  const [file, setFile] = useState<CaseFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .caseFile()
      .then(setFile)
      .catch((e: ApiError) => setError(e.message));
  }, []);

  if (error) return <div className="page"><ErrorNote>{error}</ErrorNote></div>;
  if (!file) return <div className="page"><Loading label="Opening the case file" /></div>;

  return (
    <div className="page stack">
      <header className="briefing">
        <p className="eyebrow">Case {file.caseId}</p>
        <h1>{file.title}</h1>
        {file.briefing.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </header>

      <section className="card victim" aria-labelledby="victim-title">
        <Portrait src={file.victim.portrait} alt={file.victim.portraitAlt} />
        <div className="stack-sm">
          <p className="eyebrow">Victim</p>
          <h2 id="victim-title" style={{ margin: 0 }}>
            {file.victim.name}
          </h2>
          <p className="muted" style={{ margin: 0 }}>
            {file.victim.role}
          </p>
          <p style={{ margin: 0 }}>{file.victim.summary}</p>
        </div>
      </section>

      <section className="stack-sm" aria-labelledby="poi-title">
        <h2 id="poi-title">Persons of interest</h2>
        <div className="people">
          {file.suspects.map((s) => (
            <Person key={s.id} p={s} />
          ))}
        </div>
      </section>

      <section className="stack-sm" aria-labelledby="witness-title">
        <h2 id="witness-title">Witnesses</h2>
        <div className="people">
          {file.witnesses.map((s) => (
            <Person key={s.id} p={s} />
          ))}
        </div>
      </section>

      <section className="stack-sm" aria-labelledby="venue-title">
        <h2 id="venue-title">Blackthorn Hall</h2>
        <div className="floorplan">
          <img src={fileUrl("venue/floorplan.svg")} alt="Floor plan of Blackthorn Hall: ground floor with the north gate, coat check, main floor, photo booth, stage and DJ station; second floor with the projection room off the corridor." />
        </div>
      </section>
    </div>
  );
}
