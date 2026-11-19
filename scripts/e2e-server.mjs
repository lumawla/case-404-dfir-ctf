// Starts the built server on a fresh throwaway database for Playwright.
// Requires `npm run build` first.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";

const port = process.argv[2] ?? "8788";
if (!existsSync("apps/api/dist/server.js") || !existsSync("apps/web/dist/index.html")) {
  console.error("Build first: npm run build");
  process.exit(1);
}
mkdirSync("test-results", { recursive: true });
for (const f of ["test-results/e2e.db", "test-results/e2e.db-wal", "test-results/e2e.db-shm"]) rmSync(f, { force: true });
const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "apps/api/dist/server.js"], {
  stdio: "inherit",
  env: { ...process.env, PORT: port, HOST: "127.0.0.1", DATABASE_PATH: "test-results/e2e.db", ADMIN_TOKEN: "e2e-admin-token-123456", APP_SECRET: "e2e-app-secret-123456" },
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));

// Open only the isolated fixture event; production defaults remain closed.
const base = `http://127.0.0.1:${port}`;
for (let attempt = 0; attempt < 100; attempt++) {
  try {
    const login = await fetch(`${base}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "e2e-admin-token-123456" }) });
    if (!login.ok) throw new Error("Fixture login failed");
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const opened = await fetch(`${base}/api/admin/event`, { method: "PUT", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ startOpen: true }) });
    if (!opened.ok) throw new Error("Fixture setup failed");
    break;
  } catch (e) {
    if (attempt === 99) { child.kill(); throw e; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
