// Fails if the built web client contains answers, the accusation rule, spoiler narrative or evidence content.
// Run after `npm run build`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const dist = "apps/web/dist";
const answers = JSON.parse(readFileSync(process.env.CASE_ANSWERS_PATH ?? "private/organizer/answers.json", "utf8"));
const verdict = JSON.parse(readFileSync("content/gated/verdict.json", "utf8"));

const needles = [
  ...Object.values(answers.flags),
  ...Object.values(answers.practice),
  // The motive id is a common word; its label is what would give the answer away.
  verdict.motives.find((m) => m.id === answers.verdict.motive).label,
  ...Object.values(answers.verdict.groups).flat(),
  verdict.reconstruction.stinger.slice(0, 40),
  verdict.reconstruction.text.slice(0, 40),
  verdict.endings.solved_accomplice.text.slice(0, 40),
  // Evidence, its layout, act titles and timeline entries are served by the API only, as they open.
  ...JSON.parse(readFileSync("content/gated/acts.json", "utf8")).acts.map((a) => a.intro.slice(0, 40)),
  ...Object.values(JSON.parse(readFileSync("content/gated/timeline.json", "utf8")).solved)
    .flat()
    .map((e) => e.text.slice(0, 40)),
  "Yze zgpc epie",
  "4359805ecab2319a",
  "ledger_2026-10-30",
  "yasmine.treasurer",
  "keep him there",
  "ACS-EXP-7731",
];

const files = [];
const walk = (d) => readdirSync(d).forEach((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : files.push(path.join(d, f))));
walk(dist);

const problems = [];
for (const f of files) {
  if (f.endsWith(".map")) problems.push(`${f}: source map shipped`);
  if (!/\.(js|css|html|json|svg|txt)$/.test(f)) continue;
  const text = readFileSync(f, "utf8");
  for (const n of needles) if (text.includes(n)) problems.push(`${f}: contains "${n.slice(0, 32)}…"`);
}
if (problems.length) {
  console.error("Spoiler leak check FAILED:\n" + problems.join("\n"));
  process.exit(1);
}
console.log(`Spoiler leak check passed (${files.length} files, ${needles.length} patterns).`);
