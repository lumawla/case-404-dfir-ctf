// Real production startup, static boundary, secure cookies, and restart persistence.
// Runs only on an isolated local temporary database; never opens the event.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
const dir = mkdtempSync(path.join(tmpdir(),'case404-production-'));
const admin = randomBytes(24).toString('hex'), secret = randomBytes(32).toString('hex');
const port = 8790, base = `http://127.0.0.1:${port}`;
try { await fetch(`${base}/api/health`); throw new Error('Smoke port already in use'); } catch(e) { if (e.message.includes('already in use')) throw e; }
let child;
async function start() {
  child = spawn(process.execPath,['apps/api/dist/server.js'],{ stdio:['ignore','ignore','inherit'], env:{...process.env,NODE_ENV:'production',PORT:String(port),HOST:'127.0.0.1',DATABASE_PATH:path.join(dir,'smoke.db'),ADMIN_TOKEN:admin,APP_SECRET:secret} });
  for(let i=0;i<100;i++) { try { if((await fetch(`${base}/api/health`)).ok) return; } catch {} if(child.exitCode !== null) throw new Error('Production startup failed'); await new Promise(r=>setTimeout(r,100)); }
  throw new Error('Production startup timed out');
}
async function stop() { if (!child || child.exitCode !== null) return; const done = new Promise(r=>child.once('exit',r)); child.kill('SIGTERM'); await done; }
try {
  await start();
  const index = await fetch(base); assert.equal(index.headers.get('cache-control'),'no-cache'); assert.equal(index.status,200);
  for(const file of ['/private/organizer/answers.json','/data/event-secrets.json','/release-manifest.json','/apps/api/dist/server.js.map']) {
    const res = await fetch(base+file), text = await res.text(); assert(!text.includes(secret)); assert(!text.includes(admin)); assert(!text.includes('"flags"')); assert(res.status===404 || res.headers.get('content-type').includes('text/html'));
  }
  const create = await fetch(base+'/api/teams',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({teamName:'Production Smoke',nickname:'Ana'})});
  assert.equal(create.status,200); const setCookie = create.headers.get('set-cookie'); assert(setCookie.includes('Secure')); assert(setCookie.includes('HttpOnly')); const cookie=setCookie.split(';')[0];
  const get = async url => { const res=await fetch(base+url,{headers:{cookie}}); assert.equal(res.status,200); return res.json(); };
  const before=await get('/api/me/team-state');
  await stop(); await start(); const after=await get('/api/me/team-state'); assert.equal(after.team.id,before.team.id); assert.equal(after.members.length,1); assert.equal(after.team.status,'NOT_STARTED');
  assert.equal((await fetch(base+'/api/case/fs/raw?path=intake/manifest.json')).status,401);
  const backup = spawn(process.execPath,['scripts/backup-db.mjs',path.join(dir,'smoke.db'),path.join(dir,'snapshot.db')],{stdio:'inherit'});
  assert.equal(await new Promise(r=>backup.once('exit',r)),0);
  console.log('Production smoke passed: release guard, HTML caching, private-file boundary, secure cookie, restart persistence, verified snapshot.');
} finally { await stop(); }
