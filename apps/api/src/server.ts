import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyRelease } from "./release.js";
import { buildApp } from "./app.js";
import { systemClock } from "./clock.js";
import { loadConfig } from "./config.js";
import { loadContent } from "./content.js";
import { openDb } from "./db.js";

const config = loadConfig();
if (config.production || path.basename(path.dirname(fileURLToPath(import.meta.url))) === "dist") verifyRelease(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."));
const content = loadContent(config.contentDir, config.answersPath);
const db = openDb(config.databasePath);
const app = await buildApp({ db, clock: systemClock, config, content, logger: true });

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: config.host });
app.log.info(`CASE 404 API listening on :${config.port} (evidence files: ${content.files.size})`);
