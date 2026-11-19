import { Link } from "react-router-dom";
import { PublicLayout } from "./PublicLayout";

export function NotFound() {
  return (
    <PublicLayout>
      <div className="narrow card stack" style={{ textAlign: "center" }}>
        <p className="eyebrow">404</p>
        <h1>Not found</h1>
        <p className="muted">This page isn't in the case record.</p>
        <Link className="btn btn-primary" to="/">
          Back to the start
        </Link>
      </div>
    </PublicLayout>
  );
}
