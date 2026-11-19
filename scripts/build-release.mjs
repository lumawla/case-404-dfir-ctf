// Build both halves, check public output, then seal this release. A failed build
// leaves no valid manifest, so an old release cannot masquerade as the new one.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

rmSync('release-manifest.json', { force: true });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const args of [['run','build','-w','@case404/web'], ['run','build','-w','@case404/api'], ['run','check:bundle']]) {
  const result = spawnSync(npm, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const hash = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = `${dir}/${e.name}`;
  return e.isDirectory() ? walk(p) : [p];
});
const sources = [...['apps/api/src','apps/web/src','apps/web/public','packages/shared/src','scripts'].flatMap(walk),
  'package.json','package-lock.json','apps/api/build.mjs','apps/api/package.json','apps/web/package.json','apps/web/vite.config.ts','tsconfig.base.json',
  'apps/api/tsconfig.json','apps/web/tsconfig.json','packages/shared/tsconfig.json','packages/shared/package.json','apps/web/index.html'];
const artifacts = [...walk('apps/api/dist'), ...walk('apps/web/dist')];
const records = files => Object.fromEntries(files.map(f => [f.replaceAll(path.sep, '/'), hash(f)]));
writeFileSync('release-manifest.json', JSON.stringify({ sources: records(sources), artifacts: records(artifacts) }, null, 2));
console.log('Release manifest sealed.');
