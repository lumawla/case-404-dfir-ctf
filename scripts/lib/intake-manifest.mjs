// Writes the two intake manifests: the hashes "sealed" when each batch of evidence was collected.
// Run after any listed file changes (npm run evidence and npm run assets both do this).
//
// manifest.json (Act II) seals the access controller's own log without naming a file: investigators
// must hash the exports to find out which copy matches it.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const FIRST_BATCH = [
  {
    item: "DER-404-01",
    description: "Access controller (ACS) log, all readers, window 2026-10-31 18:00-24:00, pulled by DER directly from the controller's read-only mirror",
    source: "access_control/exports/ACS-EXP-7731.csv",
    path: null,
    collected_at: "2026-11-01T00:22:00+02:00",
    note: "Retained on DER storage. Any working copy of this log must match this hash.",
  },
  { item: "DER-404-02", path: "photobooth/device.log", description: "PhotoBooth PB-2 device log", collected_at: "2026-11-01T00:29:40+02:00" },
  { item: "DER-404-03", path: "photobooth/DCIM/PB2_0027.jpg", description: "PhotoBooth PB-2 frame exported by DER", collected_at: "2026-11-01T00:29:40+02:00" },
  { item: "DER-404-04", path: "phones/nadia_haddad/media_log.csv", description: "Victim's phone, camera roll index (logical extraction)", collected_at: "2026-11-01T00:47:00+02:00" },
  { item: "DER-404-05", path: "campus_security/GATE-N_index.csv", description: "Campus camera GATE-N clip index", collected_at: "2026-11-01T00:40:08+02:00" },
];

const SECOND_BATCH = [
  { item: "DER-404-11", path: "social/originals/IMG_4471.jpg", description: "MASKED Social media store, original upload", collected_at: "2026-11-01T01:30:12+02:00" },
  { item: "DER-404-12", path: "cctv/nvr8/CAM-03_20261031_234807.jpg", description: "Local recorder NVR-8, corridor camera still", collected_at: "2026-11-01T01:12:15+02:00" },
  { item: "DER-404-13", path: "cctv/nvr8/CAM-01_dj_station.csv", description: "Local recorder NVR-8 and mixing console log", collected_at: "2026-11-01T01:12:15+02:00" },
  { item: "DER-404-14", path: "phones/salma_nasser/sms.db", description: "Witness's phone, Messages database (copied without opening)", collected_at: "2026-11-01T02:10:00+02:00" },
  { item: "DER-404-15", path: "logs/maskmail_auth.log", description: "maskmail-01 authentication log", collected_at: "2026-11-01T00:58:02+02:00" },
  { item: "DER-404-16", path: "network/wifi.log", description: "Venue Wi-Fi controller log", collected_at: "2026-11-01T01:05:00+02:00" },
  { item: "DER-404-17", path: "finance/expenses_export.csv", description: "Event finance dashboard, current export", collected_at: "2026-11-01T00:48:00+02:00" },
];

function seal(caseRoot, entry) {
  const bytes = readFileSync(path.join(caseRoot, entry.path ?? entry.source));
  const { source: _source, ...rest } = entry;
  const sealed = { ...rest, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  if (sealed.path === null) delete sealed.path;
  return sealed;
}

function write(caseRoot, file, batch, entries) {
  const manifest = {
    manifest: `CASE 404 - EVIDENCE INTAKE, BATCH ${batch}`,
    intake_desk: "Digital Evidence Response",
    hash_algorithm: "SHA-256",
    paths_relative_to: "~/case404",
    hashed: "At collection, before any analysis",
    sealed: entries.map((e) => seal(caseRoot, e)),
    not_sealed: "Material received second-hand (forwarded files, screenshots, re-exports) is not authenticated and is not listed.",
    notice: "Fictional in-story record for CASE 404. Not a real legal certification.",
  };
  writeFileSync(path.join(caseRoot, file), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function writeIntakeManifests(caseRoot) {
  write(caseRoot, "intake/manifest.json", 1, FIRST_BATCH);
  write(caseRoot, "intake/manifest_2.json", 2, SECOND_BATCH);
}
