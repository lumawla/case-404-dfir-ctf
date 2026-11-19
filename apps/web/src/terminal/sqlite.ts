// A read-only reader for small SQLite databases, enough for `sqlite3 file "SELECT ..."` in the terminal.
// It walks table b-trees the way SQLite does, so it shows only live rows: deleted records stay in the
// file's free space, where `strings` and `xxd` still see them.

import { utf8 } from "./media";

export class SqliteError extends Error {}

type Value = number | string | null | Uint8Array;
type Table = { name: string; rootpage: number; sql: string; columns: string[]; rowidAlias: number };

function varint(b: Uint8Array, at: number): [number, number] {
  let v = 0;
  for (let i = 0; i < 9; i++) {
    const byte = b[at + i];
    if (i === 8) return [v * 256 + byte, 9];
    v = v * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return [v, i + 1];
  }
  return [v, 9];
}

function record(b: Uint8Array): Value[] {
  const [headerSize, n0] = varint(b, 0);
  const types: number[] = [];
  for (let at = n0; at < headerSize; ) {
    const [t, n] = varint(b, at);
    types.push(t);
    at += n;
  }
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Value[] = [];
  let at = headerSize;
  for (const t of types) {
    if (t === 0) out.push(null);
    else if (t >= 1 && t <= 6) {
      const len = [0, 1, 2, 3, 4, 6, 8][t];
      let x = 0;
      for (let i = 0; i < len; i++) x = x * 256 + b[at + i];
      if (b[at] & 0x80) x -= 2 ** (8 * len);
      out.push(x);
      at += len;
    } else if (t === 7) {
      out.push(v.getFloat64(at));
      at += 8;
    } else if (t === 8 || t === 9) out.push(t - 8);
    else if (t >= 12 && t % 2 === 0) {
      const len = (t - 12) / 2;
      out.push(b.slice(at, at + len));
      at += len;
    } else if (t >= 13) {
      const len = (t - 13) / 2;
      out.push(utf8.decode(b.subarray(at, at + len)));
      at += len;
    } else throw new SqliteError("database disk image is malformed");
  }
  return out;
}

export class SqliteDb {
  private readonly pageSize: number;
  private readonly usable: number;

  constructor(private readonly b: Uint8Array) {
    if (b.length < 100 || utf8.decode(b.subarray(0, 16)) !== "SQLite format 3\0") throw new SqliteError("file is not a database");
    const raw = (b[16] << 8) | b[17];
    this.pageSize = raw === 1 ? 65536 : raw;
    this.usable = this.pageSize - b[20];
  }

  /** Every row of a table b-tree, in rowid order: [rowid, values]. */
  rows(root: number): [number, Value[]][] {
    const out: [number, Value[]][] = [];
    const visit = (page: number, depth: number) => {
      if (depth > 20 || page < 1) throw new SqliteError("database disk image is malformed");
      const base = (page - 1) * this.pageSize;
      const hdr = base + (page === 1 ? 100 : 0);
      const b = this.b;
      const type = b[hdr];
      const cells = (b[hdr + 3] << 8) | b[hdr + 4];
      const ptrs = hdr + (type === 0x05 ? 12 : 8);
      for (let i = 0; i < cells; i++) {
        const at = base + ((b[ptrs + 2 * i] << 8) | b[ptrs + 2 * i + 1]);
        if (type === 0x05) {
          visit(((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3], depth + 1);
        } else if (type === 0x0d) {
          const [size, n1] = varint(b, at);
          const [rowid, n2] = varint(b, at + n1);
          if (size > this.usable - 35) throw new SqliteError("record too large for this reader");
          out.push([rowid, record(b.subarray(at + n1 + n2, at + n1 + n2 + size))]);
        } else throw new SqliteError("database disk image is malformed");
      }
      if (type === 0x05) visit(((b[hdr + 8] << 24) >>> 0) + (b[hdr + 9] << 16) + (b[hdr + 10] << 8) + b[hdr + 11], depth + 1);
    };
    visit(root, 0);
    return out;
  }

  tables(): Table[] {
    return this.rows(1)
      .filter(([, r]) => r[0] === "table")
      .map(([, r]) => {
        const sql = String(r[4] ?? "");
        const body = sql.slice(sql.indexOf("(") + 1, sql.lastIndexOf(")"));
        const defs = body.split(",").map((d) => d.trim());
        const columns = defs.map((d) => d.split(/\s+/)[0].replace(/^["`[]|["`\]]$/g, ""));
        return { name: String(r[1]), rootpage: Number(r[3]), sql, columns, rowidAlias: defs.findIndex((d) => /\bINTEGER\s+PRIMARY\s+KEY\b/i.test(d)) };
      });
  }
}

const show = (v: Value) => (v === null ? "" : v instanceof Uint8Array ? utf8.decode(v) : String(v));

type Cond = { col: string; op: string; value: Value };

function parseLiteral(s: string): Value {
  if (/^'.*'$/s.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^null$/i.test(s)) return null;
  throw new SqliteError(`near "${s}": syntax error`);
}

function compare(a: Value, op: string, b: Value): boolean {
  const x = a instanceof Uint8Array ? utf8.decode(a) : a;
  if (op === "IS") return x === b;
  if (op === "IS NOT") return x !== b;
  if (x === null || b === null) return false;
  if (op === "LIKE") {
    const re = new RegExp(`^${String(b).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, "is");
    return re.test(String(x));
  }
  const l = typeof x === "number" && typeof b === "number" ? x : String(x);
  const r = typeof x === "number" && typeof b === "number" ? b : String(b);
  return op === "=" || op === "==" ? l === r : op === "!=" || op === "<>" ? l !== r : op === "<" ? l < r : op === "<=" ? l <= r : op === ">" ? l > r : l >= r;
}

/** Runs one statement (a SELECT or a dot command) and returns sqlite3's list-mode output. */
export function runSql(db: SqliteDb, input: string, opts: { headers: boolean }): string {
  const stmt = input.trim().replace(/;\s*$/, "");
  const tables = db.tables();
  const table = (name: string) => {
    const t = tables.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!t) throw new SqliteError(`no such table: ${name}`);
    return t;
  };
  if (/^\.tables$/i.test(stmt)) return tables.map((t) => t.name).sort().join("  ");
  const schema = /^\.schema(?:\s+(\S+))?$/i.exec(stmt);
  if (schema) return (schema[1] ? [table(schema[1])] : tables).map((t) => `${t.sql};`).join("\n");
  if (stmt.startsWith(".")) throw new SqliteError(`unknown command or invalid arguments:  "${stmt.slice(1).split(/\s/)[0]}". Enter ".help" for help`);

  const m = /^select\s+(.+?)\s+from\s+(\w+)(?:\s+where\s+(.+?))?(?:\s+order\s+by\s+(\w+)(?:\s+(asc|desc))?)?(?:\s+limit\s+(\d+))?$/is.exec(stmt);
  if (!m) throw new SqliteError(`this sqlite3 understands .tables, .schema and SELECT ... FROM ... [WHERE ...] [ORDER BY ...] [LIMIT n]`);
  const t = table(m[2]);
  const cols = ["rowid", ...t.columns];
  // Column 0 is the rowid; a column declared INTEGER PRIMARY KEY is stored as NULL and reads as the rowid.
  const index = (c: string) => {
    const named = cols.slice(1).findIndex((x) => x.toLowerCase() === c.toLowerCase());
    if (named >= 0) return named + 1;
    if (c.toLowerCase() === "rowid") return 0;
    throw new SqliteError(`no such column: ${c}`);
  };
  const rows = db.rows(t.rootpage).map(([rowid, vals]): Value[] => [rowid, ...t.columns.map((_, i) => (i === t.rowidAlias ? rowid : (vals[i] ?? null)))]);

  const conds: Cond[] = [];
  if (m[3]) {
    for (const part of m[3].split(/\s+and\s+/i)) {
      const c = /^(\w+)\s*(=|==|!=|<>|<=|>=|<|>|\bis\s+not\b|\bis\b|\blike\b)\s*(.+)$/is.exec(part.trim());
      if (!c) throw new SqliteError(`near "${part.trim()}": syntax error`);
      conds.push({ col: c[1], op: c[2].toUpperCase().replace(/\s+/g, " "), value: parseLiteral(c[3].trim()) });
    }
  }
  let selected = rows.filter((r) => conds.every((c) => compare(r[index(c.col)], c.op, c.value)));
  if (m[4]) {
    const i = index(m[4]);
    const dir = m[5]?.toLowerCase() === "desc" ? -1 : 1;
    selected = [...selected].sort((a, b) => {
      const x = a[i];
      const y = b[i];
      if (x === y) return 0;
      if (x === null) return -dir;
      if (y === null) return dir;
      return (x < y ? -1 : 1) * dir;
    });
  }
  if (m[6]) selected = selected.slice(0, Number(m[6]));

  const what = m[1].trim();
  if (/^count\(\s*\*\s*\)$/i.test(what)) return `${opts.headers ? "count(*)\n" : ""}${selected.length}`;
  const picks = what === "*" ? t.columns.map((c) => index(c)) : what.split(",").map((c) => index(c.trim()));
  const lines = selected.map((r) => picks.map((i) => show(r[i])).join("|"));
  if (opts.headers) lines.unshift(picks.map((i) => cols[i]).join("|"));
  return lines.join("\n");
}
