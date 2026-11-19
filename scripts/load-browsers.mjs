// Isolated rehearsal: 60 independent authenticated browser contexts, 30 teams.
// Uses a fresh temporary database and never connects to a deployed event.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
mkdirSync('test-results', { recursive: true });
const port = Number(process.env.LOAD_PORT || 8799);
const seconds = Number(process.env.LOAD_SECONDS || 120);
const participants = Number(process.env.LOAD_PARTICIPANTS || 60);
if (!Number.isInteger(participants) || participants < 2 || participants > 60 || participants % 2) throw new Error('Use an even participant count from 2 to 60');
const dir = mkdtempSync(path.join(tmpdir(), 'case404-load-'));
const base = `http://127.0.0.1:${port}`;
const adminToken = randomBytes(24).toString('hex');
// Refuse an occupied port, preventing accidental writes to an existing server.
try { await fetch(`${base}/api/health`); throw new Error('Load port already serves an application; choose LOAD_PORT'); }
catch (e) { if (e.message.includes('already serves')) throw e; }
let phase = 'arrival';
const serverTimings = [], steadyTimings = [];
const server = spawn(process.execPath, ['apps/api/dist/server.js'], { stdio: ['ignore','pipe','inherit'], env: { ...process.env, NODE_ENV: 'test', PORT: String(port), HOST: '127.0.0.1', DATABASE_PATH: path.join(dir,'load.db'), ADMIN_TOKEN: adminToken, APP_SECRET: randomBytes(32).toString('hex') } });
let buffer = '';
server.stdout.on('data', chunk => {
  buffer += chunk.toString();
  const lines = buffer.split('\n'); buffer = lines.pop();
  for (const line of lines) {
    try { const record = JSON.parse(line); if (typeof record.responseTime === 'number') serverTimings.push({ phase, ms: record.responseTime }); } catch {}
  }
});
let browser;
const errors = [], timings = [], pages = [];
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    if (i > 100 || server.exitCode !== null) throw new Error('Load server did not start');
    await new Promise(r => setTimeout(r,100));
  }
  browser = await chromium.launch({ headless: true });
  const admin = await browser.newContext({ baseURL: base });
  if (!(await admin.request.post('/api/admin/login', { data: { token: adminToken } })).ok()) throw new Error('Login failed');
  if (!(await admin.request.put('/api/admin/event', { data: { startOpen: true } })).ok()) throw new Error('Opening fixture failed');
  async function checked(response) { if (!response.ok()) throw new Error(`Fixture request failed: ${response.status()}`); return response.json(); }
  for (let i = 0; i < participants / 2; i++) {
    const captain = await browser.newContext({ baseURL: base }), mate = await browser.newContext({ baseURL: base });
    const created = await checked(await captain.request.post('/api/teams', { data: { teamName: `Load ${i}`, nickname: 'Captain' } }));
    await checked(await mate.request.post('/api/teams/join', { data: { code: created.joinCode, nickname: 'Mate' } }));
    await checked(await captain.request.post('/api/case/start', { data: {} }));
    for (const ctx of [captain, mate]) {
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', async res => {
        if (!res.url().includes('/api/')) return;
        if (res.status() >= 400) errors.push(`${res.status()} ${new URL(res.url()).pathname}`);
        try { await res.finished(); const t = res.request().timing(); if (t.responseEnd >= 0) { timings.push(t.responseEnd); if (phase === "steady") steadyTimings.push(t.responseEnd); } } catch {}
      });
      pages.push(page);
    }
  }
  // All browsers arrive together and continue normal four-second UI polling.
  await Promise.all(pages.map(async page => {
    await page.goto(`${base}/case`, { timeout: 120_000 });
    await page.getByRole('heading', { name: 'Challenges', exact: true }).waitFor({ timeout: 120_000 });
    await page.getByLabel('Terminal command').fill('ls -a; cat interviews/salma_nasser.txt');
    await page.getByLabel('Terminal command').press('Enter');
    await page.getByRole('tab', { name: 'Notes', exact: true }).click();
    await page.getByLabel('New note', { exact: false }).fill(`Load note ${pages.indexOf(page)}`);
    await page.getByRole('button', { name: 'Add note', exact: false }).click();
  }));
  // Both members submit the same correct flag together. Each team must score once.
  const answer = JSON.parse(readFileSync('private/organizer/answers.json','utf8')).flags.EV01;
  const submissions = await Promise.all(pages.map(async page => checked(await page.request.post('/api/case/challenges/EV01/submit', { data: { answer } }))));
  if (submissions.filter(r => r.status === 'correct').length !== participants / 2 || submissions.filter(r => r.status === 'already_solved').length !== participants / 2) throw new Error('Duplicate or missing flag award');
  phase = "steady";
  for (let elapsed = 0; elapsed < seconds; elapsed += 10) {
    await new Promise(r => setTimeout(r, Math.min(10, seconds - elapsed) * 1000));
    console.log(`Authenticated browsers: ${pages.length}; soak ${Math.min(elapsed + 10,seconds)}/${seconds}s; errors ${errors.length}`);
  }
  phase = "refresh";
  // Refresh every browser and verify shared progress survived.
  await Promise.all(pages.map(async page => { await page.reload({ timeout: 120_000 }); const state = await checked(await page.request.get('/api/me/team-state')); if (state.team.status !== 'ACTIVE' || state.members.length !== 2 || !state.solvedIds.includes('EV01')) throw new Error('Progress changed'); const notes = await checked(await page.request.get('/api/notes')); if (notes.notes.length !== 2) throw new Error('Missing shared notes'); }));
  timings.sort((a,b) => a-b);
  const summary = values => { values.sort((a,b) => a-b); return { requests: values.length, p50Ms: values[Math.floor(values.length*.5)], p95Ms: values[Math.floor(values.length*.95)], p99Ms: values[Math.floor(values.length*.99)] }; };
  const result = { browserSteady: summary(steadyTimings), serverAll: summary(serverTimings.map(t => t.ms)), serverSteady: summary(serverTimings.filter(t => t.phase === "steady").map(t => t.ms)), participants, seconds, apiRequests: timings.length, p50Ms: timings[Math.floor(timings.length*.5)], p95Ms: timings[Math.floor(timings.length*.95)], p99Ms: timings[Math.floor(timings.length*.99)], errors, database: path.join(dir,'load.db') };
  writeFileSync('test-results/load-results.json', JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
  if (errors.length) process.exitCode = 1;
} finally {
  if (browser) await browser.close(); server.kill('SIGTERM');
}
