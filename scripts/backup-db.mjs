// Consistent SQLite snapshot, including committed WAL transactions. Never resets data.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const [sourceArg, destinationArg] = process.argv.slice(2);
if (!sourceArg || !destinationArg) throw new Error('Usage: node scripts/backup-db.mjs SOURCE.db NEW-SNAPSHOT.db');
const source = path.resolve(sourceArg), destination = path.resolve(destinationArg);
if (!existsSync(source)) throw new Error('Source database does not exist');
if (source === destination || existsSync(destination)) throw new Error('Destination must be a new file');
mkdirSync(path.dirname(destination), { recursive: true });
const db = new DatabaseSync(source, { readOnly: true });
try { db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`); } finally { db.close(); }
const snapshot = new DatabaseSync(destination, { readOnly: true });
try {
  if (snapshot.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Snapshot integrity check failed');
} finally { snapshot.close(); }
console.log(`Verified snapshot: ${destination}`);
