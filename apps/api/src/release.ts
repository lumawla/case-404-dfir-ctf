import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Production fails closed after incomplete builds or stale/mixed artifacts. */
export function verifyRelease(root: string) {
  const file = path.join(root, "release-manifest.json");
  if (!existsSync(file)) throw new Error("Missing release manifest. Run npm run build before production startup.");
  const manifest = JSON.parse(readFileSync(file, "utf8")) as { sources: Record<string, string>; artifacts: Record<string, string> };
  // Packaged containers contain built artifacts only. Check source too in checkouts.
  const records = existsSync(path.join(root, "apps/api/src")) ? { ...manifest.sources, ...manifest.artifacts } : manifest.artifacts;
  if (!records || !Object.keys(records).length) throw new Error("Invalid release manifest.");
  for (const [relative, expected] of Object.entries(records)) {
    const target = path.join(root, relative);
    if (!existsSync(target) || createHash("sha256").update(readFileSync(target)).digest("hex") !== expected) {
      throw new Error(`Stale or missing release file: ${relative}. Run npm run build; startup stopped.`);
    }
  }
}
