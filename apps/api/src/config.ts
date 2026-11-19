import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export type Config = {
  port: number;
  host: string;
  production: boolean;
  adminToken: string;
  appSecret: string;
  databasePath: string;
  contentDir: string;
  answersPath: string;
  webDist: string;
  trustProxy: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production";
  const adminToken = env.ADMIN_TOKEN ?? (production ? "" : "dev-admin-token");
  const appSecret = env.APP_SECRET ?? (production ? "" : "dev-app-secret");
  if (production && (adminToken.length < 16 || appSecret.length < 16)) {
    throw new Error("ADMIN_TOKEN and APP_SECRET must each be at least 16 characters in production.");
  }
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? "0.0.0.0",
    production,
    adminToken,
    appSecret,
    databasePath: path.resolve(env.DATABASE_PATH ?? path.join(repoRoot, "data/case404.db")),
    contentDir: path.resolve(env.CONTENT_DIR ?? path.join(repoRoot, "content")),
    answersPath: path.resolve(env.CASE_ANSWERS_PATH ?? path.join(repoRoot, "private/organizer/answers.json")),
    webDist: path.resolve(env.WEB_DIST ?? path.join(repoRoot, "apps/web/dist")),
    trustProxy: env.TRUST_PROXY === "1" || env.TRUST_PROXY === "true",
  };
}
