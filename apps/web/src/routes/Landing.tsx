import { ArrowRight, KeyRound, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type PublicEvent } from "../api";
import { useTeam } from "../state/team";
import { PublicLayout } from "./PublicLayout";

export function Landing() {
  const { state } = useTeam();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  useEffect(() => {
    api
      .event()
      .then(setEvent)
      .catch(() => setEvent(null));
  }, []);

  return (
    <PublicLayout>
      <section className="hero" aria-labelledby="hero-title">
        <img className="hero-art" src="/art/cover-hall.jpg" alt="" width={1600} height={900} />
        <div className="hero-content">
          <p className="eyebrow">Blackthorn Hall · 31 October</p>
          <h1 id="hero-title" className="hero-title">
            Case 404
          </h1>
          <p className="hero-sub">The Last Photograph</p>
          <p className="tagline">Everyone came dressed as someone else. One of them came to kill.</p>
          <div className="row" style={{ justifyContent: "center" }}>
            {state ? (
              <Link className="btn btn-primary btn-lg" to={state.team.status === "NOT_STARTED" ? "/team" : "/case"}>
                Return to {state.team.name} <ArrowRight aria-hidden="true" />
              </Link>
            ) : (
              <>
                <Link className="btn btn-primary btn-lg" to="/join">
                  <KeyRound aria-hidden="true" /> Join a team
                </Link>
                {(event?.createTeamEnabled ?? true) && (
                  <Link className="btn btn-lg" to="/create">
                    <Users aria-hidden="true" /> Create a team
                  </Link>
                )}
              </>
            )}
          </div>
          {event && !event.registrationOpen && !state && <p className="small muted">Registration is closed. Teams that already joined can sign in with their code.</p>}
          <ul className="facts">
            <li>{event ? `${event.minTeamSize}–${event.maxTeamSize}` : "2–3"} per team</li>
            <li>{event ? Math.round(event.durationSeconds / 60) : 75} minutes</li>
            <li>3 acts</li>
            <li>8 challenges</li>
            <li>1 accusation</li>
          </ul>
        </div>
      </section>
    </PublicLayout>
  );
}
