#!/usr/bin/env node
// Free event hosting from a laptop:  npm run host
//
// 1. Builds the current source on every invocation.
// 2. Starts the production server on this computer (database in data/).
// 3. If `cloudflared` is installed, opens a free Cloudflare quick tunnel and prints a public
//    https:// link that players can open from any network. No Cloudflare account needed.
//
// Secrets are generated once and saved in data/event-secrets.json, so restarting keeps
// everyone's sessions and team join codes valid. Keep the laptop plugged in and awake.

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.PORT ?? "8787";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

process.chdir(root);

{
  console.log("Building the current source…");
  const build = spawnSync(npm, ["run", "build"], { stdio: "inherit", shell: process.platform === "win32" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

mkdirSync("data", { recursive: true });
const secretsFile = path.join("data", "event-secrets.json");
let secrets;
if (existsSync(secretsFile)) {
  secrets = JSON.parse(readFileSync(secretsFile, "utf8"));
} else {
  secrets = { adminToken: randomBytes(18).toString("base64url"), appSecret: randomBytes(32).toString("base64url") };
  writeFileSync(secretsFile, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
}
const adminToken = process.env.ADMIN_TOKEN ?? secrets.adminToken;

const children = [];
const stopAll = () => {
  for (const c of children) if (!c.killed) c.kill("SIGTERM");
};
process.on("SIGINT", () => {
  console.log("\nStopping. Team progress is saved in data/case404.db.");
  stopAll();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopAll();
  process.exit(0);
});

const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "apps/api/dist/server.js"], {
  stdio: ["ignore", "ignore", "inherit"],
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: port,
    HOST: "127.0.0.1",
    TRUST_PROXY: "1",
    ADMIN_TOKEN: adminToken,
    APP_SECRET: process.env.APP_SECRET ?? secrets.appSecret,
  },
});
children.push(server);
server.on("exit", (code) => {
  console.error(`\nThe game server stopped (exit code ${code}).`);
  stopAll();
  process.exit(code ?? 1);
});

// Keep a Mac awake while hosting.
if (process.platform === "darwin") children.push(spawn("caffeinate", ["-dimsu", "-w", String(server.pid)], { stdio: "ignore" }));

function banner(publicUrl) {
  const line = "═".repeat(64);
  console.log(`\n${line}`);
  console.log("  CASE 404 is live");
  if (publicUrl) {
    console.log(`  Players open:     ${publicUrl}`);
    console.log(`  Organizers open:  ${publicUrl}/admin`);
  } else {
    console.log(`  On this computer: http://localhost:${port}`);
    console.log(`  Organizers:       http://localhost:${port}/admin`);
  }
  console.log(`  Organizer token:  ${adminToken}`);
  console.log("  Keep this window open and the laptop plugged in. Ctrl+C stops it.");
  console.log(`${line}\n`);
}

const hasCloudflared = spawnSync("cloudflared", ["--version"], { stdio: "ignore", shell: process.platform === "win32" }).status === 0;
if (!hasCloudflared) {
  banner(null);
  console.log("To give players a public https:// link, install Cloudflare's free tunnel tool and run `npm run host` again:");
  console.log("  Windows: winget install --id Cloudflare.cloudflared");
  console.log("  macOS:   brew install cloudflared");
  console.log("  Linux:   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/");
} else {
  console.log("Opening a free Cloudflare tunnel…");
  const tunnel = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  children.push(tunnel);
  let announced = false;
  const watch = (chunk) => {
    // The tunnel's own address, e.g. https://fame-cheap-assist-tooth.trycloudflare.com
    // (cloudflared also prints api.trycloudflare.com in errors, which is not a player link).
    const match = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/.exec(chunk.toString());
    if (match && !announced) {
      announced = true;
      banner(match[0]);
    }
  };
  tunnel.stdout.on("data", watch);
  tunnel.stderr.on("data", watch);
  tunnel.on("exit", (code) => {
    if (!announced) {
      banner(null);
      console.error("Couldn't open the Cloudflare tunnel. Check this computer's internet connection, then stop (Ctrl+C) and run `npm run host` again.");
    } else {
      console.error(`\nThe Cloudflare tunnel closed (exit code ${code}). Players can't reach the game until you run "npm run host" again (it gets a new link).`);
    }
  });
}
