// Runs the API (tsx watch, :8787) and the Vite dev server (:5173, proxies /api) together.
import { spawn } from "node:child_process";

const procs = [
  spawn("npm", ["run", "dev", "-w", "@case404/api"], { stdio: "inherit", shell: process.platform === "win32" }),
  spawn("npm", ["run", "dev", "-w", "@case404/web"], { stdio: "inherit", shell: process.platform === "win32" }),
];
const stop = () => procs.forEach((p) => p.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
procs.forEach((p) => p.on("exit", (code) => code && stop()));
