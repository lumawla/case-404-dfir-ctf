import { readExif } from "@case404/shared";
import { AwkError, runAwk } from "./awk";
import { examplesFor } from "./cheatsheet";
import { JqError, compileJq, formatJson } from "./jq";
import { describe, digest, encode, hexdump, isBinary, isPdf, jpegInfo, latin1, md5, pdfInfo, pngInfo, pngText, strings, utf8 } from "./media";
import type { Out, Shell, Span } from "./shell";
import { SqliteDb, SqliteError, runSql } from "./sqlite";
import { HOME, type DirNode, type FileNode, type Node, inWorldNow, resolvePath } from "./vfs";

export type CommandContext = { argv: string[]; args: string[]; stdin: Uint8Array | null; tty: boolean; sh: Shell; cols: number };
export type CommandResult = { stdout?: string | Uint8Array; rich?: Span[][]; stderr?: string[]; blocks?: Out[]; code?: number };
export type Command = { summary: string; usage: string; hidden?: boolean; run(ctx: CommandContext): Promise<CommandResult> };

// ---------------------------------------------------------------------------------------------
// helpers

type Opts = { flags: Set<string>; values: Map<string, string>; operands: string[] };

/**
 * getopt-style parsing: combined short flags (-la), values attached or separate (-n5, -n 5),
 * long options mapped to short ones, `--` to stop, `-` as an operand, optional numeric shorthand (-5).
 */
function getopt(cmd: string, args: string[], spec: { flags?: string; values?: string; long?: Record<string, string>; numeric?: string }): Opts | { error: string } {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const operands: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith("--") && spec.long) {
      const [name, val] = a.slice(2).split(/=(.*)/s);
      const short = spec.long[name];
      if (!short) return { error: `${cmd}: unrecognized option '${a}'` };
      if (spec.values?.includes(short)) {
        const v = val ?? args[++i];
        if (v === undefined) return { error: `${cmd}: option '--${name}' requires an argument` };
        values.set(short, v);
      } else flags.add(short);
      continue;
    }
    if (a.startsWith("-") && a.length > 1) {
      if (spec.numeric && /^-\d+$/.test(a)) {
        values.set(spec.numeric, a.slice(1));
        continue;
      }
      for (let j = 1; j < a.length; j++) {
        const ch = a[j];
        if (spec.values?.includes(ch)) {
          const v = a.slice(j + 1) || args[++i];
          if (v === undefined) return { error: `${cmd}: option requires an argument -- '${ch}'` };
          values.set(ch, v);
          break;
        }
        if (!spec.flags?.includes(ch)) return { error: `${cmd}: invalid option -- '${ch}'` };
        flags.add(ch);
      }
      continue;
    }
    operands.push(a);
  }
  return { flags, values, operands };
}

const fail = (msg: string, code = 1): CommandResult => ({ stderr: [msg], code });

/** Resolves an argument to a node, with the standard error text. */
export function lookup(sh: Shell, cmd: string, arg: string): { node: Node; abs: string } | { error: string } {
  const abs = resolvePath(sh.cwd, arg);
  const node = sh.vfs.stat(abs);
  if (!node) return { error: `${cmd}: ${arg}: No such file or directory` };
  return { node, abs };
}

async function bytesOf(ctx: CommandContext, node: FileNode): Promise<Uint8Array> {
  return node.data ?? ctx.sh.io.read(node);
}

type Input = { name: string; bytes: Uint8Array; node?: FileNode };

/** Reads each operand (or stdin when there are none / "-"). Directory and missing-file errors are collected. */
async function readInputs(ctx: CommandContext, cmd: string, operands: string[]): Promise<{ inputs: Input[]; errors: string[] }> {
  const inputs: Input[] = [];
  const errors: string[] = [];
  const list = operands.length ? operands : ["-"];
  for (const op of list) {
    if (op === "-") {
      if (ctx.stdin === null && !operands.length) errors.push(`${cmd}: missing file operand`);
      else inputs.push({ name: "-", bytes: ctx.stdin ?? new Uint8Array() });
      continue;
    }
    const found = lookup(ctx.sh, cmd, op);
    if ("error" in found) errors.push(found.error);
    else if (found.node.type === "dir") errors.push(`${cmd}: ${op}: Is a directory`);
    else inputs.push({ name: op, bytes: await bytesOf(ctx, found.node), node: found.node });
  }
  return { inputs, errors };
}

const textOf = (b: Uint8Array) => utf8.decode(b);
const linesOf = (text: string) => {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
};
const joinLines = (lines: string[]) => (lines.length ? `${lines.join("\n")}\n` : "");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-01T00:22:00+02:00" → "Nov  1 00:22" (the timestamp is already local, +02:00). */
function lsDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${String(Number(m[3])).padStart(2)} ${m[4]}:${m[5]}`;
}

function humanSize(n: number) {
  if (n < 1024) return String(n);
  const units = ["K", "M", "G"];
  let v = n;
  let u = -1;
  do {
    v /= 1024;
    u++;
  } while (v >= 1024 && u < units.length - 1);
  return v < 10 ? `${(Math.ceil(v * 10) / 10).toFixed(1)}${units[u]}` : `${Math.ceil(v)}${units[u]}`;
}

const isMedia = (name: string) => /\.(jpe?g|png|svg|pdf|gif)$/i.test(name);
const nodeClass = (n: Node): Span["c"] => (n.type === "dir" ? "dir" : isMedia(n.name) ? "media" : undefined);
const sizeOf = (n: Node) => (n.type === "dir" ? 4096 : n.size);
const caseOwned = (sh: Shell, n: Node) => n.abs === sh.vfs.caseRoot || n.abs.startsWith(`${sh.vfs.caseRoot}/`);
function perms(sh: Shell, n: Node) {
  if (n.type === "dir") return n.writable ? "drwxrwxrwt" : caseOwned(sh, n) ? "dr-xr-xr-x" : "drwxr-xr-x";
  return caseOwned(sh, n) ? "-r--r--r--" : "-rw-r--r--";
}
const owner = (sh: Shell, n: Node) => (caseOwned(sh, n) ? ["der", "evidence"] : n.abs.startsWith(HOME) || n.abs.startsWith("/tmp") ? ["investigator", "investigator"] : ["root", "root"]);

/** Lays out names in columns, column-major, like ls does on a terminal. */
function columns(items: Span[], width: number): Span[][] {
  if (!items.length) return [];
  const colWidth = Math.max(...items.map((s) => s.t.length)) + 2;
  const perRow = Math.max(1, Math.floor(width / colWidth));
  const rows = Math.ceil(items.length / perRow);
  const out: Span[][] = [];
  for (let r = 0; r < rows; r++) {
    const line: Span[] = [];
    for (let c = 0; c < perRow; c++) {
      const item = items[c * rows + r];
      if (!item) continue;
      const last = c === perRow - 1 || !items[(c + 1) * rows + r];
      line.push(item);
      if (!last) line.push({ t: " ".repeat(colWidth - item.t.length) });
    }
    out.push(line);
  }
  return out;
}

/** Converts a GNU basic regular expression to a JavaScript one (\| \( \) \{ \} \+ \? are the operators). */
function breToJs(p: string): string {
  let out = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "\\" && i + 1 < p.length) {
      const n = p[++i];
      out += "|(){}+?".includes(n) ? n : `\\${n}`;
    } else out += "|(){}+?".includes(c) ? `\\${c}` : c;
  }
  return out;
}

/** Expands tr sets: ranges, escapes and [:classes:]. */
function trSet(spec: string): string[] {
  const classes: Record<string, string> = {
    upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    lower: "abcdefghijklmnopqrstuvwxyz",
    digit: "0123456789",
    space: " \t\n\r\v\f",
    punct: "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
  };
  classes.alpha = classes.upper + classes.lower;
  classes.alnum = classes.alpha + classes.digit;
  const chars: string[] = [];
  const unescaped: string[] = [];
  for (let i = 0; i < spec.length; i++) {
    const cls = /^\[:(\w+):\]/.exec(spec.slice(i));
    if (cls && classes[cls[1]]) {
      unescaped.push(...classes[cls[1]]);
      i += cls[0].length - 1;
      continue;
    }
    if (spec[i] === "\\" && i + 1 < spec.length) {
      const n = spec[++i];
      unescaped.push(({ n: "\n", t: "\t", r: "\r", "\\": "\\" } as Record<string, string>)[n] ?? n);
    } else unescaped.push(spec[i]);
  }
  for (let i = 0; i < unescaped.length; i++) {
    if (unescaped[i + 1] === "-" && i + 2 < unescaped.length) {
      const from = unescaped[i].charCodeAt(0);
      const to = unescaped[i + 2].charCodeAt(0);
      for (let c = from; c <= to; c++) chars.push(String.fromCharCode(c));
      i += 2;
    } else chars.push(unescaped[i]);
  }
  return chars;
}

/** Line diff via LCS. Returns edit script entries. */
type Edit = { op: "=" | "-" | "+"; a: number; b: number; line: string };
function lineDiff(a: string[], b: string[]): Edit[] {
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) throw new Error("files too large to compare");
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: Edit[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) out.push({ op: "=", a: i++, b: j++, line: a[i - 1] });
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ op: "-", a: i++, b: j, line: a[i - 1] });
    else out.push({ op: "+", a: i, b: j++, line: b[j - 1] });
  }
  while (i < n) out.push({ op: "-", a: i++, b: j, line: a[i - 1] });
  while (j < m) out.push({ op: "+", a: i, b: j++, line: b[j - 1] });
  return out;
}

const range = (start: number, count: number) => (count === 1 ? `${start}` : count === 0 ? `${start - 1}` : `${start},${start + count - 1}`);

function normalDiff(edits: Edit[]): Span[][] {
  const out: Span[][] = [];
  let k = 0;
  while (k < edits.length) {
    if (edits[k].op === "=") {
      k++;
      continue;
    }
    const del: Edit[] = [];
    const add: Edit[] = [];
    const first = edits[k];
    while (k < edits.length && edits[k].op !== "=") (edits[k].op === "-" ? del : add).push(edits[k++]);
    const aStart = del.length ? del[0].a + 1 : first.a;
    const bStart = add.length ? add[0].b + 1 : first.b;
    const head = del.length && add.length ? `${range(aStart, del.length)}c${range(bStart, add.length)}` : del.length ? `${range(aStart, del.length)}d${bStart}` : `${aStart}a${range(bStart, add.length)}`;
    out.push([{ t: head, c: "accent" }]);
    for (const d of del) out.push([{ t: `< ${d.line}`, c: "err" }]);
    if (del.length && add.length) out.push([{ t: "---" }]);
    for (const a of add) out.push([{ t: `> ${a.line}`, c: "bold" }]);
  }
  return out;
}

function unifiedDiff(edits: Edit[], nameA: string, nameB: string, dateA: string, dateB: string, context = 3): Span[][] {
  const out: Span[][] = [[{ t: `--- ${nameA}\t${dateA}`, c: "bold" }], [{ t: `+++ ${nameB}\t${dateB}`, c: "bold" }]];
  const changed = edits.map((e, i) => (e.op !== "=" ? i : -1)).filter((i) => i >= 0);
  let idx = 0;
  while (idx < changed.length) {
    let start = Math.max(0, changed[idx] - context);
    let end = Math.min(edits.length - 1, changed[idx] + context);
    while (idx + 1 < changed.length && changed[idx + 1] - context <= end + 1) {
      idx++;
      end = Math.min(edits.length - 1, changed[idx] + context);
    }
    idx++;
    const hunk = edits.slice(start, end + 1);
    const aCount = hunk.filter((e) => e.op !== "+").length;
    const bCount = hunk.filter((e) => e.op !== "-").length;
    const aStart = (hunk.find((e) => e.op !== "+")?.a ?? hunk[0].a) + (aCount ? 1 : 0);
    const bStart = (hunk.find((e) => e.op !== "-")?.b ?? hunk[0].b) + (bCount ? 1 : 0);
    out.push([{ t: `@@ -${aStart},${aCount} +${bStart},${bCount} @@`, c: "accent" }]);
    for (const e of hunk) out.push([{ t: `${e.op === "=" ? " " : e.op}${e.line}`, c: e.op === "-" ? "err" : e.op === "+" ? "bold" : undefined }]);
    start = end;
  }
  return out;
}

const plain = (lines: Span[][]) => joinLines(lines.map((l) => l.map((s) => s.t).join("")));

const EXIF_LABELS: Record<string, string> = {
  ImageDescription: "Image Description",
  Make: "Make",
  Model: "Camera Model Name",
  Orientation: "Orientation",
  Software: "Software",
  DateTime: "Modify Date",
  Artist: "Artist",
  Copyright: "Copyright",
  ExposureTime: "Exposure Time",
  FNumber: "F Number",
  ISOSpeedRatings: "ISO",
  DateTimeOriginal: "Date/Time Original",
  DateTimeDigitized: "Create Date",
  OffsetTime: "Offset Time",
  OffsetTimeOriginal: "Offset Time Original",
  OffsetTimeDigitized: "Offset Time Digitized",
  FocalLength: "Focal Length",
  PixelXDimension: "Exif Image Width",
  PixelYDimension: "Exif Image Height",
  BodySerialNumber: "Serial Number",
  LensModel: "Lens Model",
};

function exifDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2})(.*)$/.exec(iso);
  return m ? `${m[1]}:${m[2]}:${m[3]} ${m[4]}${m[5]}` : iso;
}

function exiftoolLines(name: string, dirName: string, node: FileNode | undefined, b: Uint8Array): [string, string][] {
  const rows: [string, string][] = [
    ["ExifTool Version Number", "12.76"],
    ["File Name", name],
    ["Directory", dirName],
    ["File Size", b.length < 1000 ? `${b.length} bytes` : `${Math.round(b.length / 1000)} kB`],
  ];
  if (node) rows.push(["File Modification Date/Time", exifDate(node.modified)], ["File Permissions", node.casePath ? "-r--r--r--" : "-rw-r--r--"]);
  const j = jpegInfo(b);
  const p = pngInfo(b);
  const pdf = pdfInfo(b);
  if (j) {
    rows.push(["File Type", "JPEG"], ["File Type Extension", "jpg"], ["MIME Type", "image/jpeg"]);
    if (j.jfif) rows.push(["JFIF Version", j.jfif]);
    const exif = readExif(b);
    if (exif) {
      rows.push(["Exif Byte Order", "Big-endian (Motorola, MM)"]);
      for (const [k, v] of Object.entries(exif)) {
        const label = EXIF_LABELS[k];
        if (!label) continue;
        rows.push([label, k === "FocalLength" ? `${v}.0 mm` : k === "FNumber" ? Number(v).toFixed(1) : v]);
      }
    }
    rows.push(["Image Width", String(j.width)], ["Image Height", String(j.height)], ["Encoding Process", j.progressive ? "Progressive DCT, Huffman coding" : "Baseline DCT, Huffman coding"]);
    rows.push(["Bits Per Sample", "8"], ["Color Components", String(j.components)], ["Image Size", `${j.width}x${j.height}`], ["Megapixels", ((j.width * j.height) / 1e6).toFixed(1)]);
  } else if (p) {
    rows.push(["File Type", "PNG"], ["File Type Extension", "png"], ["MIME Type", "image/png"], ["Image Width", String(p.width)], ["Image Height", String(p.height)]);
    rows.push(["Bit Depth", String(p.bitDepth)], ["Color Type", p.colorType], ["Interlace", p.interlaced ? "Adam7 Interlace" : "Noninterlaced"]);
    for (const [k, v] of pngText(b)) rows.push([k, v]);
    rows.push(["Image Size", `${p.width}x${p.height}`]);
  } else if (pdf) {
    rows.push(["File Type", "PDF"], ["File Type Extension", "pdf"], ["MIME Type", "application/pdf"], ["PDF Version", pdf.version], ["Linearized", "No"]);
    if (pdf.creator) rows.push(["Creator", pdf.creator]);
    if (pdf.producer) rows.push(["Producer", pdf.producer]);
  } else if (!isBinary(b)) {
    const text = textOf(b);
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    const type = ext === "csv" ? "CSV" : ext === "json" ? "JSON" : ext === "svg" ? "SVG" : "TXT";
    rows.push(["File Type", type], ["File Type Extension", ext || "txt"], ["MIME Type", type === "CSV" ? "text/csv" : type === "JSON" ? "application/json" : type === "SVG" ? "image/svg+xml" : "text/plain"]);
    if (type !== "SVG") rows.push(["MIME Encoding", /^[\x00-\x7f]*$/.test(text) ? "us-ascii" : "utf-8"], ["Newlines", text.includes("\r\n") ? "Windows CRLF" : "Unix LF"], ["Line Count", String(linesOf(text).length)], ["Word Count", String(text.split(/\s+/).filter(Boolean).length)]);
  } else {
    rows.push(["Error", "Unknown file type"]);
  }
  return rows;
}

const keyOf = (label: string) => label.replace(/[^A-Za-z]/g, "").toLowerCase();

// ---------------------------------------------------------------------------------------------
// commands

const readOnly = (cmd: string, verb: string): Command => ({
  summary: "",
  usage: `${cmd} ...`,
  hidden: true,
  async run({ args, sh }) {
    const target = args.filter((a) => !a.startsWith("-")).pop() ?? "";
    const abs = resolvePath(sh.cwd, target);
    if (abs.startsWith("/tmp/")) {
      if (cmd === "touch") {
        const exists = sh.vfs.stat(abs);
        const err = exists ? null : sh.vfs.write(abs, new Uint8Array());
        return err ? fail(`touch: cannot touch '${target}': ${err}`) : {};
      }
      if (cmd === "rm") {
        const errors = args.filter((a) => !a.startsWith("-")).map((t) => [t, sh.vfs.remove(resolvePath(sh.cwd, t))] as const).filter(([, e]) => e);
        return errors.length ? { stderr: errors.map(([t, e]) => `rm: cannot remove '${t}': ${e}`), code: 1 } : {};
      }
    }
    if (!target) return fail(`${cmd}: missing operand`);
    return fail(`${cmd}: cannot ${verb} '${target}': Read-only file system`);
  },
});

const offline = (cmd: string): Command => ({
  summary: "",
  usage: cmd,
  hidden: true,
  async run({ args }) {
    const host = args.filter((a) => !a.startsWith("-")).pop() ?? "host";
    return fail(`${cmd}: ${host}: Network is unreachable (this workstation is air-gapped)`, cmd === "curl" ? 7 : 1);
  },
});

export const COMMANDS: Record<string, Command> = {
  help: {
    summary: "list commands, or show usage for one",
    usage: "help [command]",
    async run({ args }) {
      if (args[0]) {
        const c = COMMANDS[args[0]];
        if (!c || c.hidden) return fail(`help: no help topics match '${args[0]}'`);
        const rich: Span[][] = [[{ t: c.usage, c: "bold" }], [{ t: `    ${c.summary}` }]];
        const examples = examplesFor(args[0]);
        if (examples.length) {
          rich.push([], [{ t: "Examples:", c: "muted" }]);
          const width = Math.max(...examples.map(([e]) => e.length)) + 3;
          for (const [example, what] of examples) rich.push([{ t: `  ${example.padEnd(width)}`, c: "accent" }, { t: what, c: "muted" }]);
        }
        return { rich, stdout: plain(rich) };
      }
      const names = Object.keys(COMMANDS).filter((n) => !COMMANDS[n].hidden).sort();
      const width = Math.max(...names.map((n) => n.length)) + 2;
      const rich: Span[][] = [[{ t: "Commands (help <command> shows its options):", c: "muted" }], []];
      for (const n of names) rich.push([{ t: n.padEnd(width), c: "bold" }, { t: COMMANDS[n].summary }]);
      rich.push([], [{ t: "Pipes (|), ; && ||, redirection to /tmp (> >>), globs (* ? [ ]), Tab completion and history (↑ ↓) work as in bash.", c: "muted" }]);
      return { rich, stdout: plain(rich) };
    },
  },

  ls: {
    summary: "list directory contents",
    usage: "ls [-alhtr1] [path...]",
    async run(ctx) {
      const o = getopt("ls", ctx.args, { flags: "alhtr1AdRS", long: { all: "a", "human-readable": "h", "almost-all": "A" } });
      if ("error" in o) return fail(o.error, 2);
      const { flags } = o;
      const operands = o.operands.length ? o.operands : ["."];
      const stderr: string[] = [];
      const rich: Span[][] = [];
      const showAll = flags.has("a");
      const showHidden = showAll || flags.has("A");
      const sortNodes = (nodes: { name: string; node: Node }[]) => {
        let list = nodes;
        if (flags.has("t")) list = [...list].sort((x, y) => y.node.modified.localeCompare(x.node.modified));
        if (flags.has("S")) list = [...list].sort((x, y) => sizeOf(y.node) - sizeOf(x.node));
        return flags.has("r") ? [...list].reverse() : list;
      };
      const render = (entries: { name: string; node: Node }[], withTotal: boolean) => {
        if (flags.has("l")) {
          if (withTotal) rich.push([{ t: `total ${entries.reduce((n, e) => n + Math.ceil(sizeOf(e.node) / 4096) * 4, 0)}` }]);
          const sizes = entries.map((e) => (flags.has("h") ? humanSize(sizeOf(e.node)) : String(sizeOf(e.node))));
          const sw = Math.max(...sizes.map((s) => s.length), 1);
          const ow = Math.max(...entries.map((e) => owner(ctx.sh, e.node)[0].length));
          const gw = Math.max(...entries.map((e) => owner(ctx.sh, e.node)[1].length));
          entries.forEach((e, i) => {
            const [u, g] = owner(ctx.sh, e.node);
            const links = e.node.type === "dir" ? String(2 + [...e.node.children.values()].filter((c) => c.type === "dir").length) : "1";
            rich.push([
              { t: `${perms(ctx.sh, e.node)} ${links.padStart(2)} ${u.padEnd(ow)} ${g.padEnd(gw)} ${sizes[i].padStart(sw)} ${lsDate(e.node.modified)} ` },
              { t: e.name, c: nodeClass(e.node) },
            ]);
          });
        } else if (ctx.tty && !flags.has("1")) {
          rich.push(...columns(entries.map((e) => ({ t: e.name, c: nodeClass(e.node) })), ctx.cols));
        } else {
          for (const e of entries) rich.push([{ t: e.name, c: ctx.tty ? nodeClass(e.node) : undefined }]);
        }
      };
      const files: { name: string; node: Node }[] = [];
      const dirs: { name: string; node: DirNode }[] = [];
      for (const op of operands) {
        const found = lookup(ctx.sh, "ls", op);
        if ("error" in found) stderr.push(`ls: cannot access '${op}': No such file or directory`);
        else if (found.node.type === "dir" && !flags.has("d")) dirs.push({ name: op, node: found.node });
        else files.push({ name: op, node: found.node });
      }
      if (files.length) render(sortNodes(files), false);
      const listDir = (d: { name: string; node: DirNode }, header: boolean) => {
        if (header) {
          if (rich.length) rich.push([]);
          rich.push([{ t: `${d.name}:` }]);
        }
        const kids = ctx.sh.vfs.list(d.node).filter((c) => showHidden || !c.name.startsWith("."));
        const entries = kids.map((c) => ({ name: c.name, node: c as Node }));
        const parent = ctx.sh.vfs.stat(resolvePath(d.node.abs, "..")) ?? d.node;
        const all = showAll ? [{ name: ".", node: d.node as Node }, { name: "..", node: parent }, ...entries] : entries;
        render(showAll ? [...all.slice(0, 2), ...sortNodes(all.slice(2))] : sortNodes(all), true);
        if (flags.has("R")) for (const k of kids) if (k.type === "dir") listDir({ name: `${d.name === "." ? "." : d.name.replace(/\/$/, "")}/${k.name}`, node: k }, true);
      };
      dirs.forEach((d) => listDir(d, operands.length > 1 || files.length > 0 || flags.has("R")));
      return { rich, stdout: plain(rich), stderr, code: stderr.length ? 2 : 0 };
    },
  },

  cd: {
    summary: "change directory",
    usage: "cd [dir]",
    async run({ args, sh }) {
      if (args.length > 1) return fail("cd: too many arguments");
      const err = sh.cd(args[0]);
      return err ? fail(err) : {};
    },
  },

  pwd: {
    summary: "print working directory",
    usage: "pwd",
    async run({ sh }) {
      return { stdout: `${sh.cwd}\n` };
    },
  },

  cat: {
    summary: "print files",
    usage: "cat [-n] [file...]",
    async run(ctx) {
      const o = getopt("cat", ctx.args, { flags: "nAv", long: { number: "n" } });
      if ("error" in o) return fail(o.error);
      const { inputs, errors } = await readInputs(ctx, "cat", o.operands);
      const parts: Uint8Array[] = [];
      const notes: Out[] = [];
      for (const inp of inputs) {
        if (ctx.tty && isBinary(inp.bytes)) {
          notes.push({ kind: "text", text: `[${inp.name}: binary data, ${inp.bytes.length} bytes not shown]`, cls: "muted" });
          continue;
        }
        if (o.flags.has("n")) {
          const lines = linesOf(textOf(inp.bytes));
          parts.push(encode(joinLines(lines.map((l, i) => `${String(i + 1).padStart(6)}\t${l}`))));
        } else parts.push(inp.bytes);
      }
      const total = parts.reduce((n, p) => n + p.length, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const p of parts) {
        out.set(p, off);
        off += p.length;
      }
      return { stdout: out, stderr: errors, blocks: notes, code: errors.length ? 1 : 0 };
    },
  },

  head: {
    summary: "first lines of files",
    usage: "head [-n N] [-c N] [file...]",
    async run(ctx) {
      const o = getopt("head", ctx.args, { values: "nc", numeric: "n", long: { lines: "n", bytes: "c" } });
      if ("error" in o) return fail(o.error);
      const n = Number(o.values.get("n") ?? 10);
      const c = o.values.has("c") ? Number(o.values.get("c")) : null;
      if (Number.isNaN(n) || (c !== null && Number.isNaN(c))) return fail("head: invalid number of lines");
      const { inputs, errors } = await readInputs(ctx, "head", o.operands);
      const chunks: string[] = [];
      inputs.forEach((inp, i) => {
        if (inputs.length > 1) chunks.push(`${i ? "\n" : ""}==> ${inp.name} <==\n`);
        if (c !== null) chunks.push(latin1(inp.bytes.subarray(0, c)));
        else {
          const lines = linesOf(textOf(inp.bytes));
          chunks.push(joinLines(n < 0 ? lines.slice(0, n) : lines.slice(0, n)));
        }
      });
      return { stdout: chunks.join(""), stderr: errors, code: errors.length ? 1 : 0 };
    },
  },

  tail: {
    summary: "last lines of files",
    usage: "tail [-n N|+N] [file...]",
    async run(ctx) {
      const o = getopt("tail", ctx.args, { values: "nc", numeric: "n", long: { lines: "n", bytes: "c" } });
      if ("error" in o) return fail(o.error);
      const raw = o.values.get("n") ?? "10";
      const fromStart = raw.startsWith("+");
      const n = Number(raw.replace("+", ""));
      if (Number.isNaN(n)) return fail(`tail: invalid number of lines: '${raw}'`);
      const { inputs, errors } = await readInputs(ctx, "tail", o.operands);
      const chunks: string[] = [];
      inputs.forEach((inp, i) => {
        if (inputs.length > 1) chunks.push(`${i ? "\n" : ""}==> ${inp.name} <==\n`);
        if (o.values.has("c")) chunks.push(latin1(inp.bytes.subarray(Math.max(0, inp.bytes.length - Number(o.values.get("c"))))));
        else {
          const lines = linesOf(textOf(inp.bytes));
          chunks.push(joinLines(fromStart ? lines.slice(Math.max(0, n - 1)) : n === 0 ? [] : lines.slice(-n)));
        }
      });
      return { stdout: chunks.join(""), stderr: errors, code: errors.length ? 1 : 0 };
    },
  },

  less: { summary: "", usage: "less file", hidden: true, run: (ctx) => COMMANDS.cat.run(ctx) },
  more: { summary: "", usage: "more file", hidden: true, run: (ctx) => COMMANDS.cat.run(ctx) },

  grep: {
    summary: "search for a pattern",
    usage: "grep [-ivnclorwFEH] [-A N] [-B N] [-C N] pattern [file...]",
    async run(ctx) {
      const o = getopt("grep", ctx.args, {
        flags: "ivnclLorRwxFEHhqs",
        values: "eABCm",
        long: { "ignore-case": "i", "invert-match": "v", "line-number": "n", count: "c", "files-with-matches": "l", recursive: "r", "only-matching": "o", "word-regexp": "w", "fixed-strings": "F", "extended-regexp": "E", "with-filename": "H", "no-filename": "h", quiet: "q", context: "C" },
      });
      if ("error" in o) return fail(o.error, 2);
      const f = o.flags;
      const operands = [...o.operands];
      const pattern = o.values.get("e") ?? operands.shift();
      if (pattern === undefined) return fail("Usage: grep [OPTION]... PATTERNS [FILE]...", 2);
      let source = f.has("F") ? pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : f.has("E") ? pattern : breToJs(pattern);
      if (f.has("w")) source = `(?<![\\w])(?:${source})(?![\\w])`;
      if (f.has("x")) source = `^(?:${source})$`;
      let re: RegExp;
      try {
        re = new RegExp(source, f.has("i") ? "gi" : "g");
      } catch {
        return fail("grep: Invalid regular expression", 2);
      }
      const recursive = f.has("r") || f.has("R");
      const after = Number(o.values.get("A") ?? o.values.get("C") ?? 0);
      const before = Number(o.values.get("B") ?? o.values.get("C") ?? 0);
      const maxCount = o.values.has("m") ? Number(o.values.get("m")) : Infinity;

      const targets: Input[] = [];
      const stderr: string[] = [];
      if (!operands.length && recursive) operands.push(".");
      if (!operands.length) {
        if (ctx.stdin === null) return fail("grep: (standard input): no input", 2);
        targets.push({ name: "(standard input)", bytes: ctx.stdin });
      }
      for (const op of operands) {
        if (op === "-") {
          targets.push({ name: "(standard input)", bytes: ctx.stdin ?? new Uint8Array() });
          continue;
        }
        const found = lookup(ctx.sh, "grep", op);
        if ("error" in found) {
          if (!f.has("s")) stderr.push(found.error);
          continue;
        }
        if (found.node.type === "dir") {
          if (!recursive) {
            stderr.push(`grep: ${op}: Is a directory`);
            continue;
          }
          for (const { node } of ctx.sh.vfs.walk(found.node)) {
            if (node.type !== "file") continue;
            const rel = node.abs.slice(found.node.abs.length + 1);
            const shown = op === "." ? rel : `${op.replace(/\/$/, "")}/${rel}`;
            targets.push({ name: shown, bytes: await bytesOf(ctx, node), node });
          }
        } else targets.push({ name: op, bytes: await bytesOf(ctx, found.node), node: found.node });
      }
      const showName = !f.has("h") && (f.has("H") || targets.length > 1 || recursive);
      const rich: Span[][] = [];
      let matchedAny = false;
      for (const t of targets) {
        const binary = isBinary(t.bytes);
        const text = binary ? latin1(t.bytes) : textOf(t.bytes);
        const lines = binary ? [text] : linesOf(text);
        const hits: number[] = [];
        lines.forEach((l, i) => {
          re.lastIndex = 0;
          const m = re.test(l);
          if (m !== f.has("v") && hits.length < maxCount) hits.push(i);
        });
        if (hits.length) matchedAny = true;
        if (f.has("q")) continue;
        if (f.has("l")) {
          if (hits.length) rich.push([{ t: t.name, c: "accent" }]);
          continue;
        }
        if (f.has("L")) {
          if (!hits.length) rich.push([{ t: t.name, c: "accent" }]);
          continue;
        }
        if (f.has("c")) {
          rich.push([...(showName ? [{ t: t.name, c: "accent" as const }, { t: ":" }] : []), { t: String(hits.length) }]);
          continue;
        }
        if (binary) {
          if (hits.length) rich.push([{ t: `Binary file ${t.name} matches` }]);
          continue;
        }
        const show = new Set<number>();
        for (const h of hits) for (let k = Math.max(0, h - before); k <= Math.min(lines.length - 1, h + after); k++) show.add(k);
        const sorted = [...show].sort((a, b) => a - b);
        const hitSet = new Set(hits);
        sorted.forEach((k, idx) => {
          if ((after || before) && idx > 0 && k !== sorted[idx - 1] + 1) rich.push([{ t: "--", c: "muted" }]);
          const sep = hitSet.has(k) ? ":" : "-";
          const prefix: Span[] = [];
          if (showName) prefix.push({ t: t.name, c: "accent" }, { t: sep, c: "muted" });
          if (f.has("n")) prefix.push({ t: String(k + 1), c: "muted" }, { t: sep, c: "muted" });
          const line = lines[k];
          if (f.has("o") && hitSet.has(k) && !f.has("v")) {
            for (const m of line.matchAll(re)) if (m[0]) rich.push([...prefix, { t: m[0], c: "match" }]);
            return;
          }
          if (!hitSet.has(k) || f.has("v")) {
            rich.push([...prefix, { t: line }]);
            return;
          }
          const spans: Span[] = [...prefix];
          let last = 0;
          for (const m of line.matchAll(re)) {
            if (!m[0]) continue;
            if (m.index! > last) spans.push({ t: line.slice(last, m.index) });
            spans.push({ t: m[0], c: "match" });
            last = m.index! + m[0].length;
          }
          if (last < line.length) spans.push({ t: line.slice(last) });
          rich.push(spans);
        });
      }
      return { rich, stdout: plain(rich), stderr, code: stderr.length && !matchedAny ? 2 : matchedAny ? 0 : 1 };
    },
  },

  wc: {
    summary: "count lines, words and bytes",
    usage: "wc [-lwc] [file...]",
    async run(ctx) {
      const o = getopt("wc", ctx.args, { flags: "lwcm", long: { lines: "l", words: "w", bytes: "c", chars: "m" } });
      if ("error" in o) return fail(o.error);
      const { inputs, errors } = await readInputs(ctx, "wc", o.operands);
      const pick = o.flags.size ? ["l", "w", "c", "m"].filter((k) => o.flags.has(k)) : ["l", "w", "c"];
      const rows = inputs.map((inp) => {
        const text = textOf(inp.bytes);
        const counts: Record<string, number> = { l: (text.match(/\n/g) ?? []).length, w: text.split(/\s+/).filter(Boolean).length, c: inp.bytes.length, m: [...text].length };
        return { name: inp.name === "-" ? "" : inp.name, counts };
      });
      if (rows.length > 1) rows.push({ name: "total", counts: Object.fromEntries(["l", "w", "c", "m"].map((k) => [k, rows.reduce((n, r) => n + r.counts[k], 0)])) });
      const width = pick.length === 1 && rows.length === 1 ? 0 : Math.max(...rows.flatMap((r) => pick.map((k) => String(r.counts[k]).length)));
      return { stdout: joinLines(rows.map((r) => [...pick.map((k) => String(r.counts[k]).padStart(width)), r.name].join(" ").trimEnd())), stderr: errors, code: errors.length ? 1 : 0 };
    },
  },

  sort: {
    summary: "sort lines",
    usage: "sort [-rnuf] [-t SEP] [-k N] [file...]",
    async run(ctx) {
      const o = getopt("sort", ctx.args, { flags: "rnufbV", values: "tk", long: { reverse: "r", "numeric-sort": "n", unique: "u", "ignore-case": "f" } });
      if ("error" in o) return fail(o.error, 2);
      const { inputs, errors } = await readInputs(ctx, "sort", o.operands);
      let lines = inputs.flatMap((i) => linesOf(textOf(i.bytes)));
      const sep = o.values.get("t");
      const keySpec = o.values.get("k");
      const key = (l: string) => {
        let v = l;
        if (keySpec) {
          const [from, to] = keySpec.split(",").map((x) => Number.parseInt(x, 10));
          const fields = sep ? l.split(sep) : l.trim().split(/\s+/);
          v = fields.slice(from - 1, to ? to : undefined).join(sep ?? " ");
        }
        return o.flags.has("f") ? v.toLowerCase() : v;
      };
      const cmp = (a: string, b: string) => {
        if (o.flags.has("n")) {
          const d = (Number.parseFloat(key(a)) || 0) - (Number.parseFloat(key(b)) || 0);
          if (d) return d;
        }
        const ka = key(a);
        const kb = key(b);
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      };
      lines = lines.sort(cmp);
      if (o.flags.has("r")) lines.reverse();
      if (o.flags.has("u")) lines = lines.filter((l, i) => i === 0 || cmp(l, lines[i - 1]) !== 0);
      return { stdout: joinLines(lines), stderr: errors, code: errors.length ? 2 : 0 };
    },
  },

  uniq: {
    summary: "collapse adjacent duplicate lines",
    usage: "uniq [-cdui] [file]",
    async run(ctx) {
      const o = getopt("uniq", ctx.args, { flags: "cdui", long: { count: "c", repeated: "d", unique: "u", "ignore-case": "i" } });
      if ("error" in o) return fail(o.error);
      const { inputs, errors } = await readInputs(ctx, "uniq", o.operands.slice(0, 1));
      const lines = inputs.flatMap((i) => linesOf(textOf(i.bytes)));
      const groups: { line: string; n: number }[] = [];
      const same = (a: string, b: string) => (o.flags.has("i") ? a.toLowerCase() === b.toLowerCase() : a === b);
      for (const l of lines) {
        const g = groups[groups.length - 1];
        if (g && same(g.line, l)) g.n++;
        else groups.push({ line: l, n: 1 });
      }
      const kept = groups.filter((g) => (o.flags.has("d") ? g.n > 1 : o.flags.has("u") ? g.n === 1 : true));
      return { stdout: joinLines(kept.map((g) => (o.flags.has("c") ? `${String(g.n).padStart(7)} ${g.line}` : g.line))), stderr: errors };
    },
  },

  cut: {
    summary: "select fields or characters from each line",
    usage: "cut -d SEP -f LIST [file...]",
    async run(ctx) {
      const o = getopt("cut", ctx.args, { flags: "s", values: "dfc", long: { delimiter: "d", fields: "f", characters: "c" } });
      if ("error" in o) return fail(o.error);
      const list = o.values.get("f") ?? o.values.get("c");
      if (!list) return fail("cut: you must specify a list of bytes, characters, or fields");
      const sep = o.values.get("d") ?? "\t";
      if (sep.length !== 1) return fail("cut: the delimiter must be a single character");
      const ranges = list.split(",").map((part) => {
        const [a, b] = part.split("-");
        const from = a === "" ? 1 : Number(a);
        const to = part.includes("-") ? (b === "" ? Infinity : Number(b)) : from;
        return [from, to] as const;
      });
      if (ranges.some(([a, b]) => Number.isNaN(a) || Number.isNaN(b) || a < 1)) return fail(`cut: invalid field value '${list}'`);
      const want = (i: number) => ranges.some(([a, b]) => i >= a && i <= b);
      const { inputs, errors } = await readInputs(ctx, "cut", o.operands);
      const out: string[] = [];
      for (const l of inputs.flatMap((i) => linesOf(textOf(i.bytes)))) {
        if (o.values.has("c")) out.push([...l].filter((_, i) => want(i + 1)).join(""));
        else if (!l.includes(sep)) {
          if (!o.flags.has("s")) out.push(l);
        } else out.push(l.split(sep).filter((_, i) => want(i + 1)).join(sep));
      }
      return { stdout: joinLines(out), stderr: errors, code: errors.length ? 1 : 0 };
    },
  },

  column: {
    summary: "align delimited text into a table",
    usage: "column -t [-s SEP] [file...]",
    async run(ctx) {
      const o = getopt("column", ctx.args, { flags: "tn", values: "so", long: { table: "t", separator: "s", "output-separator": "o" } });
      if ("error" in o) return fail(o.error);
      const { inputs, errors } = await readInputs(ctx, "column", o.operands);
      const lines = inputs.flatMap((i) => linesOf(textOf(i.bytes)));
      if (!o.flags.has("t")) return { stdout: joinLines(lines), stderr: errors };
      const seps = o.values.get("s");
      const rows = lines.map((l) => (seps ? l.split(new RegExp(`[${seps.replace(/[\]\\^-]/g, "\\$&")}]`)) : l.trim().split(/\s+/)));
      const widths: number[] = [];
      for (const r of rows) r.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, c.length)));
      const gap = o.values.get("o") ?? "  ";
      return { stdout: joinLines(rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join(gap))), stderr: errors };
    },
  },

  diff: {
    summary: "compare two files line by line",
    usage: "diff [-u] [-q] file1 file2",
    async run(ctx) {
      const o = getopt("diff", ctx.args, { flags: "uqsiwy", long: { unified: "u", brief: "q", "ignore-case": "i" } });
      if ("error" in o) return fail(o.error, 2);
      if (o.operands.length !== 2) return fail(o.operands.length < 2 ? `diff: missing operand after '${o.operands[0] ?? "diff"}'` : `diff: extra operand '${o.operands[2]}'`, 2);
      const { inputs, errors } = await readInputs(ctx, "diff", o.operands);
      if (errors.length) return { stderr: errors, code: 2 };
      const [a, b] = inputs;
      const norm = (s: string) => (o.flags.has("i") ? s.toLowerCase() : s);
      const la = linesOf(textOf(a.bytes));
      const lb = linesOf(textOf(b.bytes));
      if (a.bytes.length === b.bytes.length && a.bytes.every((x, i) => x === b.bytes[i])) {
        return o.flags.has("s") ? { stdout: `Files ${a.name} and ${b.name} are identical\n` } : {};
      }
      if (o.flags.has("q")) return { stdout: `Files ${a.name} and ${b.name} differ\n`, code: 1 };
      if (isBinary(a.bytes) || isBinary(b.bytes)) return { stdout: `Binary files ${a.name} and ${b.name} differ\n`, code: 1 };
      const edits = lineDiff(la.map(norm), lb.map(norm)).map((e) => ({ ...e, line: e.op === "+" ? lb[e.b] : la[e.a] }));
      const rich = o.flags.has("u")
        ? unifiedDiff(edits, a.name, b.name, a.node ? exifDate(a.node.modified).replace(/^(\d+):(\d+):/, "$1-$2-") : "", b.node ? exifDate(b.node.modified).replace(/^(\d+):(\d+):/, "$1-$2-") : "")
        : normalDiff(edits);
      return { rich, stdout: plain(rich), code: rich.length ? 1 : 0 };
    },
  },

  cmp: {
    summary: "compare two files byte by byte",
    usage: "cmp file1 file2",
    async run(ctx) {
      const o = getopt("cmp", ctx.args, { flags: "ls" });
      if ("error" in o) return fail(o.error, 2);
      if (o.operands.length < 2) return fail(`cmp: missing operand after '${o.operands[0] ?? "cmp"}'`, 2);
      const { inputs, errors } = await readInputs(ctx, "cmp", o.operands.slice(0, 2));
      if (errors.length) return { stderr: errors, code: 2 };
      const [a, b] = inputs;
      let line = 1;
      for (let i = 0; i < Math.min(a.bytes.length, b.bytes.length); i++) {
        if (a.bytes[i] !== b.bytes[i]) return o.flags.has("s") ? { code: 1 } : { stdout: `${a.name} ${b.name} differ: byte ${i + 1}, line ${line}\n`, code: 1 };
        if (a.bytes[i] === 10) line++;
      }
      if (a.bytes.length !== b.bytes.length) return fail(`cmp: EOF on ${a.bytes.length < b.bytes.length ? a.name : b.name} after byte ${Math.min(a.bytes.length, b.bytes.length)}`);
      return {};
    },
  },

  sha256sum: hashCommand("sha256sum", "SHA-256"),
  sha1sum: hashCommand("sha1sum", "SHA-1"),
  md5sum: hashCommand("md5sum", "MD5"),

  file: {
    summary: "identify file types",
    usage: "file file...",
    async run(ctx) {
      const o = getopt("file", ctx.args, { flags: "bLz" });
      if ("error" in o) return fail(o.error);
      if (!o.operands.length) return fail("Usage: file [-b] file...");
      const width = Math.max(...o.operands.map((x) => x.length)) + 1;
      const out: string[] = [];
      for (const op of o.operands) {
        const found = lookup(ctx.sh, "file", op);
        const label = o.flags.has("b") ? "" : `${`${op}:`.padEnd(width)} `;
        if ("error" in found) out.push(`${label}cannot open \`${op}' (No such file or directory)`);
        else if (found.node.type === "dir") out.push(`${label}directory`);
        else out.push(`${label}${describe(op, await bytesOf(ctx, found.node))}`);
      }
      return { stdout: joinLines(out) };
    },
  },

  exiftool: {
    summary: "read file metadata (EXIF and more)",
    usage: "exiftool [-TagName...] file...",
    async run(ctx) {
      const tagFilters = ctx.args.filter((a) => a.startsWith("-") && a.length > 1).map((a) => a.slice(1).toLowerCase());
      const files = ctx.args.filter((a) => !a.startsWith("-") || a === "-");
      if (!files.length) return fail("Syntax:  exiftool [OPTIONS] FILE\nConsult the exiftool documentation for a full list of options.");
      const known = new Set([...Object.values(EXIF_LABELS), "Software", "Creation Time", "Description", "File Name", "Directory", "File Size", "File Modification Date/Time", "File Type", "MIME Type", "Image Width", "Image Height", "Image Size", "Megapixels"].map(keyOf));
      const aliases: Record<string, string[]> = { alldates: ["datetimeoriginal", "createdate", "modifydate"], createdate: ["createdate"], datetimeoriginal: ["datetimeoriginal"] };
      const filters = tagFilters.flatMap((t) => aliases[t] ?? [t]).filter((t) => known.has(t) || aliases[t]);
      const rich: Span[][] = [];
      const stderr: string[] = [];
      let ok = 0;
      for (const f of files) {
        const found = lookup(ctx.sh, "exiftool", f);
        if ("error" in found) {
          stderr.push(`Error: File not found - ${f}`);
          continue;
        }
        if (found.node.type === "dir") {
          stderr.push(`Error: ${f} is a directory (give exiftool a file)`);
          continue;
        }
        ok++;
        const bytes = await bytesOf(ctx, found.node);
        const dirName = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) || "/" : ".";
        let rows = exiftoolLines(found.node.name, dirName, found.node, bytes);
        if (filters.length) rows = rows.filter(([label]) => filters.includes(keyOf(label)));
        if (files.length > 1) rich.push([{ t: `======== ${f}`, c: "bold" }]);
        for (const [label, value] of rows) rich.push([{ t: `${label.padEnd(32)}: `, c: "muted" }, { t: value }]);
      }
      if (files.length > 1) rich.push([{ t: `${String(ok).padStart(4)} image files read`, c: "muted" }]);
      return { rich, stdout: plain(rich), stderr, code: stderr.length ? 1 : 0 };
    },
  },

  sqlite3: {
    summary: "query a SQLite database (read-only)",
    usage: 'sqlite3 [-header] file.db ".tables" | ".schema" | "SELECT ..."',
    async run(ctx) {
      let headers = false;
      const rest: string[] = [];
      for (const a of ctx.args) {
        if (a === "-header" || a === "-headers") headers = true;
        else if (a === "-noheader" || a === "-list" || a === "-readonly") continue;
        else if (a.startsWith("-") && !rest.length) return fail(`sqlite3: Error: unknown option: ${a}`);
        else rest.push(a);
      }
      const [file, ...sqlWords] = rest;
      if (!file) return fail('Usage: sqlite3 [-header] FILE "SQL"   (this terminal runs one statement per call)');
      const found = lookup(ctx.sh, "sqlite3", file);
      if ("error" in found) return fail(`Error: unable to open database "${file}": unable to open database file`);
      if (found.node.type === "dir") return fail(`Error: unable to open database "${file}": unable to open database file`);
      const sql = sqlWords.length ? sqlWords.join(" ") : ctx.stdin ? utf8.decode(ctx.stdin) : "";
      if (!sql.trim()) return fail('This terminal can\'t open an interactive sqlite3 prompt. Pass the statement too, e.g. sqlite3 file.db ".tables"');
      try {
        const db = new SqliteDb(await bytesOf(ctx, found.node));
        const out = sql
          .split(/;\s*(?:\n|$)|\n/)
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) => runSql(db, x, { headers }))
          .filter((x) => x !== "");
        return { stdout: out.length ? `${out.join("\n")}\n` : "" };
      } catch (e) {
        if (e instanceof SqliteError) return fail(`Error: ${e.message}`);
        throw e;
      }
    },
  },

  strings: {
    summary: "printable strings inside a file",
    usage: "strings [-n MIN] file...",
    async run(ctx) {
      const o = getopt("strings", ctx.args, { values: "n", flags: "a", numeric: "n" });
      if ("error" in o) return fail(o.error);
      const { inputs, errors } = await readInputs(ctx, "strings", o.operands);
      return { stdout: joinLines(inputs.flatMap((i) => strings(i.bytes, Number(o.values.get("n") ?? 4)))), stderr: errors, code: errors.length ? 1 : 0 };
    },
  },

  xxd: {
    summary: "hex dump",
    usage: "xxd [-l LEN] [-s OFFSET] file",
    async run(ctx) {
      const o = getopt("xxd", ctx.args, { values: "lsc", flags: "pu" });
      if ("error" in o) return fail(o.error);
      const { inputs, errors } = await readInputs(ctx, "xxd", o.operands.slice(0, 1));
      if (errors.length) return { stderr: errors, code: 2 };
      const b = inputs[0].bytes;
      if (o.flags.has("p")) return { stdout: `${([...b.subarray(Number(o.values.get("s") ?? 0), o.values.has("l") ? Number(o.values.get("s") ?? 0) + Number(o.values.get("l")) : undefined)].map((x) => x.toString(16).padStart(2, "0")).join("").match(/.{1,60}/g) ?? []).join("\n")}\n` };
      return { stdout: `${hexdump(b, { start: Number(o.values.get("s") ?? 0), length: o.values.has("l") ? Number(o.values.get("l")) : undefined, style: "xxd" })}\n` };
    },
  },

  hexdump: {
    summary: "hex dump (use -C)",
    usage: "hexdump -C [-n LEN] [-s OFFSET] file",
    async run(ctx) {
      const o = getopt("hexdump", ctx.args, { values: "ns", flags: "Cv" });
      if ("error" in o) return fail(o.error);
      const { inputs, errors } = await readInputs(ctx, "hexdump", o.operands.slice(0, 1));
      if (errors.length) return { stderr: errors, code: 1 };
      return { stdout: `${hexdump(inputs[0].bytes, { start: Number(o.values.get("s") ?? 0), length: o.values.has("n") ? Number(o.values.get("n")) : undefined, style: "canonical" })}\n` };
    },
  },

  find: {
    summary: "search for files (-name, -iname, -type, -maxdepth)",
    usage: "find [path...] [-name PATTERN] [-type f|d]",
    async run(ctx) {
      const starts: string[] = [];
      let i = 0;
      while (i < ctx.args.length && !ctx.args[i].startsWith("-")) starts.push(ctx.args[i++]);
      if (!starts.length) starts.push(".");
      const preds: ((n: Node, depth: number, shown: string) => boolean)[] = [];
      let maxDepth = Infinity;
      let minDepth = 0;
      const globRe = (p: string, flags = "") => new RegExp(`^${p.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, flags);
      for (; i < ctx.args.length; i++) {
        const a = ctx.args[i];
        const v = ctx.args[i + 1];
        const needs = () => {
          if (v === undefined) throw new Error(`missing argument to \`${a}'`);
          i++;
          return v;
        };
        if (a === "-name") {
          const re = globRe(needs());
          preds.push((n) => re.test(n.name));
        } else if (a === "-iname") {
          const re = globRe(needs(), "i");
          preds.push((n) => re.test(n.name));
        } else if (a === "-path" || a === "-wholename") {
          const re = globRe(needs());
          preds.push((_n, _d, shown) => re.test(shown));
        } else if (a === "-type") {
          const t = needs();
          if (t !== "f" && t !== "d") return fail(`find: Unknown argument to -type: ${t}`);
          preds.push((n) => (t === "f" ? n.type === "file" : n.type === "dir"));
        } else if (a === "-maxdepth") maxDepth = Number(needs());
        else if (a === "-mindepth") minDepth = Number(needs());
        else if (a === "-newer") {
          const ref = lookup(ctx.sh, "find", needs());
          if ("error" in ref) return fail(ref.error);
          preds.push((n) => n.modified > ref.node.modified);
        } else if (a === "-empty") preds.push((n) => (n.type === "file" ? n.size === 0 : n.children.size === 0));
        else if (a === "-print") continue;
        else return fail(`find: unknown predicate \`${a}'`);
      }
      const out: string[] = [];
      const stderr: string[] = [];
      for (const s of starts) {
        const found = lookup(ctx.sh, "find", s);
        if ("error" in found) {
          stderr.push(`find: '${s}': No such file or directory`);
          continue;
        }
        for (const { node, depth } of ctx.sh.vfs.walk(found.node)) {
          if (depth > maxDepth || depth < minDepth) continue;
          const rel = node.abs.slice(found.node.abs.length).replace(/^\//, "");
          const shown = rel ? (s.endsWith("/") ? s + rel : `${s}/${rel}`) : s;
          if (preds.every((p) => p(node, depth, shown))) out.push(shown);
        }
      }
      return { stdout: joinLines(out), stderr, code: stderr.length ? 1 : 0 };
    },
  },

  tree: {
    summary: "show a directory tree",
    usage: "tree [-a] [-d] [-L LEVEL] [dir]",
    async run(ctx) {
      const o = getopt("tree", ctx.args, { flags: "adf", values: "L" });
      if ("error" in o) return fail(o.error);
      const start = o.operands[0] ?? ".";
      const found = lookup(ctx.sh, "tree", start);
      if ("error" in found) return { stdout: `${start}  [error opening dir]\n\n0 directories, 0 files\n`, code: 2 };
      const max = o.values.has("L") ? Number(o.values.get("L")) : Infinity;
      const rich: Span[][] = [[{ t: start, c: "dir" }]];
      let dirs = 0;
      let files = 0;
      const draw = (node: DirNode, prefix: string, depth: number) => {
        if (depth > max) return;
        const kids = ctx.sh.vfs.list(node).filter((k) => (o.flags.has("a") || !k.name.startsWith(".")) && (!o.flags.has("d") || k.type === "dir"));
        kids.forEach((k, i) => {
          const last = i === kids.length - 1;
          rich.push([{ t: `${prefix}${last ? "└── " : "├── "}`, c: "muted" }, { t: k.name, c: nodeClass(k) }]);
          if (k.type === "dir") {
            dirs++;
            draw(k, `${prefix}${last ? "    " : "│   "}`, depth + 1);
          } else files++;
        });
      };
      if (found.node.type === "dir") draw(found.node, "", 1);
      rich.push([], [{ t: `${dirs} director${dirs === 1 ? "y" : "ies"}${o.flags.has("d") ? "" : `, ${files} file${files === 1 ? "" : "s"}`}` }]);
      return { rich, stdout: plain(rich) };
    },
  },

  jq: {
    summary: "query JSON (paths, [], select, keys, length)",
    usage: "jq [-r] [-c] FILTER [file...]",
    async run(ctx) {
      const o = getopt("jq", ctx.args, { flags: "rcSM", long: { "raw-output": "r", "compact-output": "c" } });
      if ("error" in o) return fail(o.error, 2);
      const [filterSrc, ...files] = o.operands.length ? o.operands : ["."];
      let filter;
      try {
        filter = compileJq(filterSrc);
      } catch (e) {
        return fail(`jq: error: ${(e as Error).message}\njq: 1 compile error`, 3);
      }
      const { inputs, errors } = await readInputs(ctx, "jq", files);
      if (errors.length) return { stderr: errors.map((e) => e.replace(/^jq: /, "jq: error: Could not open ")), code: 2 };
      const out: string[] = [];
      for (const inp of inputs) {
        let data: unknown;
        try {
          data = JSON.parse(textOf(inp.bytes));
        } catch {
          return fail(`jq: error (at ${inp.name}): Cannot parse input as JSON`, 2);
        }
        try {
          for (const v of filter(data)) out.push(formatJson(v, o.flags.has("c"), o.flags.has("r")));
        } catch (e) {
          if (e instanceof JqError) return { stdout: joinLines(out), stderr: [`jq: error (at ${inp.name}): ${e.message}`], code: 5 };
          throw e;
        }
      }
      return { stdout: joinLines(out) };
    },
  },

  awk: {
    summary: "pattern scanning (patterns, print, NR/NF, -F)",
    usage: "awk [-F SEP] 'PROGRAM' [file...]",
    async run(ctx) {
      const o = getopt("awk", ctx.args, { values: "Fv" });
      if ("error" in o) return fail(o.error, 2);
      const [program, ...files] = o.operands;
      if (program === undefined) return fail("usage: awk [-F fs] 'prog' [file ...]", 2);
      const { inputs, errors } = await readInputs(ctx, "awk", files);
      if (errors.length) return { stderr: errors, code: 2 };
      const fsRaw = o.values.get("F");
      const fs = fsRaw === undefined ? null : fsRaw === "\\t" ? "\t" : fsRaw;
      try {
        return { stdout: joinLines(runAwk(program, inputs.map((i) => textOf(i.bytes)).join(""), fs)) };
      } catch (e) {
        if (e instanceof AwkError || e instanceof SyntaxError) return fail(`awk: ${e.message}`, 2);
        throw e;
      }
    },
  },

  tr: {
    summary: "translate or delete characters (reads stdin)",
    usage: "tr [-d] SET1 [SET2]",
    async run(ctx) {
      const o = getopt("tr", ctx.args, { flags: "dsc" });
      if ("error" in o) return fail(o.error);
      if (ctx.stdin === null) return fail("tr: no input: tr reads standard input, e.g. echo text | tr a-z A-Z");
      const [s1, s2] = o.operands;
      if (s1 === undefined) return fail("tr: missing operand");
      const set1 = trSet(s1);
      const text = textOf(ctx.stdin);
      if (o.flags.has("d")) return { stdout: [...text].filter((c) => !set1.includes(c)).join("") };
      if (s2 === undefined) return fail(`tr: missing operand after '${s1}'`);
      const set2 = trSet(s2);
      const map = new Map(set1.map((c, i) => [c, set2[Math.min(i, set2.length - 1)]]));
      let out = [...text].map((c) => map.get(c) ?? c).join("");
      if (o.flags.has("s")) for (const c of new Set(set2)) out = out.replace(new RegExp(`${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}+`, "g"), c);
      return { stdout: out };
    },
  },

  base64: {
    summary: "encode or decode base64",
    usage: "base64 [-d] [file]",
    async run(ctx) {
      const o = getopt("base64", ctx.args, { flags: "di", long: { decode: "d" } });
      if ("error" in o) return fail(o.error);
      const { inputs, errors } = await readInputs(ctx, "base64", o.operands.slice(0, 1));
      if (errors.length) return { stderr: errors, code: 1 };
      const b = inputs[0].bytes;
      if (o.flags.has("d")) {
        try {
          const bin = atob(textOf(b).replace(/\s+/g, ""));
          return { stdout: Uint8Array.from(bin, (c) => c.charCodeAt(0)) };
        } catch {
          return fail("base64: invalid input");
        }
      }
      return { stdout: `${(btoa(latin1(b)).match(/.{1,76}/g) ?? []).join("\n")}\n` };
    },
  },

  pdftotext: {
    summary: "extract the text layer of a PDF",
    usage: "pdftotext [-layout] file.pdf [out.txt|-]",
    async run(ctx) {
      const operands = ctx.args.filter((a) => !/^-(layout|raw|nopgbrk|enc|q)$/.test(a));
      const [src, dest] = operands;
      if (!src) return fail("Usage: pdftotext [options] <PDF-file> [<text-file>]");
      const found = lookup(ctx.sh, "pdftotext", src);
      if ("error" in found) return fail(`I/O Error: Couldn't open file '${src}': No such file or directory.`);
      if (found.node.type === "dir") return fail(`I/O Error: Couldn't open file '${src}': Is a directory.`);
      const bytes = await bytesOf(ctx, found.node);
      if (!isPdf(bytes)) return fail("Syntax Warning: May not be a PDF file (continuing anyway)\nSyntax Error: Couldn't find trailer dictionary\nSyntax Error: Couldn't read xref table", 1);
      const text = await ctx.sh.io.pdfText(found.node);
      if (!dest || dest === "-") return { stdout: text.endsWith("\n") ? text : `${text}\n` };
      const err = ctx.sh.vfs.write(resolvePath(ctx.sh.cwd, dest), encode(text));
      return err ? fail(`I/O Error: Couldn't open text file '${dest}': ${err}`) : {};
    },
  },

  open: {
    summary: "view a file (images inline, PDFs in a new tab)",
    usage: "open file...",
    async run(ctx) {
      if (!ctx.args.length) return fail("open: missing file operand");
      const blocks: Out[] = [];
      const stderr: string[] = [];
      let text = "";
      for (const a of ctx.args) {
        const found = lookup(ctx.sh, "open", a);
        if ("error" in found) {
          stderr.push(found.error);
          continue;
        }
        const node = found.node;
        if (node.type === "dir") {
          stderr.push(`open: ${a}: Is a directory`);
          continue;
        }
        const bytes = await bytesOf(ctx, node);
        if (/^image\//.test(node.mime) || jpegInfo(bytes) || pngInfo(bytes)) {
          blocks.push({ kind: "image", src: await ctx.sh.io.objectUrl(node), alt: node.name, name: node.name });
        } else if (isPdf(bytes)) {
          const url = await ctx.sh.io.objectUrl(node);
          ctx.sh.io.openInNewTab(url);
          blocks.push({ kind: "link", href: url, label: `${node.name} opened in a new tab (select if it was blocked)` });
        } else if (!isBinary(bytes)) {
          text += textOf(bytes);
        } else stderr.push(`open: ${a}: no viewer for this file type`);
      }
      return { stdout: text, blocks, stderr, code: stderr.length ? 1 : 0 };
    },
  },
  "xdg-open": { summary: "", usage: "xdg-open file", hidden: true, run: (ctx) => COMMANDS.open.run(ctx) },

  download: {
    summary: "save a file to your own computer",
    usage: "download file...",
    async run(ctx) {
      if (!ctx.args.length) return fail("download: missing file operand");
      const out: string[] = [];
      const stderr: string[] = [];
      for (const a of ctx.args) {
        const found = lookup(ctx.sh, "download", a);
        if ("error" in found) stderr.push(found.error);
        else if (found.node.type === "dir") stderr.push(`download: ${a}: Is a directory`);
        else {
          await ctx.sh.io.download(found.node);
          out.push(`Downloading ${found.node.name} (${humanSize(found.node.size)})`);
        }
      }
      return { stdout: joinLines(out), stderr, code: stderr.length ? 1 : 0 };
    },
  },

  echo: {
    summary: "print text",
    usage: "echo [-n] [-e] text...",
    async run({ args }) {
      let i = 0;
      let newline = true;
      let escapes = false;
      while (args[i] && /^-[neE]+$/.test(args[i])) {
        if (args[i].includes("n")) newline = false;
        if (args[i].includes("e")) escapes = true;
        i++;
      }
      let text = args.slice(i).join(" ");
      if (escapes) text = text.replace(/\\(n|t|\\)/g, (_, c) => (c === "n" ? "\n" : c === "t" ? "\t" : "\\"));
      return { stdout: newline ? `${text}\n` : text };
    },
  },

  clear: {
    summary: "clear the screen (Ctrl+L)",
    usage: "clear",
    async run() {
      return { blocks: [{ kind: "clear" }] };
    },
  },

  history: {
    summary: "command history",
    usage: "history [-c]",
    async run({ args, sh }) {
      if (args[0] === "-c") {
        sh.history.length = 0;
        return {};
      }
      return { stdout: joinLines(sh.history.map((h, i) => `${String(i + 1).padStart(5)}  ${h}`)) };
    },
  },

  whoami: { summary: "", usage: "whoami", hidden: true, run: async ({ sh }) => ({ stdout: `${sh.user}\n` }) },
  hostname: { summary: "", usage: "hostname", hidden: true, run: async ({ sh }) => ({ stdout: `${sh.host}\n` }) },
  id: { summary: "", usage: "id", hidden: true, run: async () => ({ stdout: "uid=1000(investigator) gid=1000(investigator) groups=1000(investigator),404(evidence)\n" }) },
  uname: {
    summary: "",
    usage: "uname [-a]",
    hidden: true,
    run: async ({ args, sh }) => ({ stdout: args.includes("-a") ? `Linux ${sh.host} 6.6.31-der #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux\n` : "Linux\n" }),
  },
  date: {
    summary: "",
    usage: "date",
    hidden: true,
    async run() {
      const d = new Date(Date.parse(inWorldNow()));
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const local = new Date(d.getTime() + 2 * 3600_000);
      const hh = (n: number) => String(n).padStart(2, "0");
      return { stdout: `${days[local.getUTCDay()]} ${MONTHS[local.getUTCMonth()]} ${String(local.getUTCDate()).padStart(2)} ${hh(local.getUTCHours())}:${hh(local.getUTCMinutes())}:${hh(local.getUTCSeconds())} EET ${local.getUTCFullYear()}\n` };
    },
  },
  man: { summary: "", usage: "man command", hidden: true, run: (ctx) => COMMANDS.help.run(ctx) },
  sudo: { summary: "", usage: "sudo", hidden: true, run: async ({ sh }) => fail(`${sh.user} is not in the sudoers file.  This incident will be reported.`) },
  su: { summary: "", usage: "su", hidden: true, run: async () => fail("su: Authentication failure") },
  exit: { summary: "", usage: "exit", hidden: true, run: async () => ({ stdout: "logout\n", blocks: [{ kind: "text", text: "The case is still open. This terminal stays with you.", cls: "muted" }] }) },
  rm: readOnly("rm", "remove"),
  mv: readOnly("mv", "move"),
  cp: {
    summary: "",
    usage: "cp src dest",
    hidden: true,
    async run(ctx) {
      const ops = ctx.args.filter((a) => !a.startsWith("-"));
      if (ops.length < 2) return fail(`cp: missing destination file operand after '${ops[0] ?? ""}'`);
      const dest = ops.pop()!;
      const destAbs = resolvePath(ctx.sh.cwd, dest);
      const destNode = ctx.sh.vfs.stat(destAbs);
      const stderr: string[] = [];
      for (const src of ops) {
        const found = lookup(ctx.sh, "cp", src);
        if ("error" in found) {
          stderr.push(`cp: cannot stat '${src}': No such file or directory`);
          continue;
        }
        if (found.node.type === "dir") {
          stderr.push(`cp: -r not specified; omitting directory '${src}'`);
          continue;
        }
        const target = destNode?.type === "dir" ? `${destAbs}/${found.node.name}` : destAbs;
        const err = ctx.sh.vfs.write(target, await bytesOf(ctx, found.node));
        if (err) stderr.push(`cp: cannot create regular file '${dest}': ${err}`);
      }
      return { stderr, code: stderr.length ? 1 : 0 };
    },
  },
  mkdir: readOnly("mkdir", "create directory"),
  rmdir: readOnly("rmdir", "remove"),
  touch: readOnly("touch", "touch"),
  chmod: readOnly("chmod", "change permissions of"),
  chown: readOnly("chown", "change ownership of"),
  ln: readOnly("ln", "create link"),
  curl: offline("curl"),
  wget: offline("wget"),
  ping: offline("ping"),
  ssh: offline("ssh"),
  nmap: offline("nmap"),
};

function hashCommand(cmd: string, algo: "SHA-256" | "SHA-1" | "MD5"): Command {
  return {
    summary: `${algo} checksums${cmd === "sha256sum" ? " (-c to verify a list)" : ""}`,
    usage: `${cmd} [-c LIST] [file...]`,
    async run(ctx) {
      const o = getopt(cmd, ctx.args, { flags: "cbt", long: { check: "c" } });
      if ("error" in o) return fail(o.error);
      const hash = async (b: Uint8Array) => (algo === "MD5" ? md5(b) : digest(algo, b));
      if (o.flags.has("c")) {
        const { inputs, errors } = await readInputs(ctx, cmd, o.operands);
        if (errors.length) return { stderr: errors, code: 1 };
        const out: string[] = [];
        let bad = 0;
        for (const line of inputs.flatMap((i) => linesOf(textOf(i.bytes)))) {
          const m = /^([0-9a-fA-F]+)\s+\*?(.+)$/.exec(line.trim());
          if (!m) continue;
          const found = lookup(ctx.sh, cmd, m[2]);
          if ("error" in found || found.node.type === "dir") {
            out.push(`${m[2]}: FAILED open or read`);
            bad++;
            continue;
          }
          const ok = (await hash(await bytesOf(ctx, found.node))) === m[1].toLowerCase();
          if (!ok) bad++;
          out.push(`${m[2]}: ${ok ? "OK" : "FAILED"}`);
        }
        return { stdout: joinLines(out), stderr: bad ? [`${cmd}: WARNING: ${bad} computed checksum${bad === 1 ? "" : "s"} did NOT match`] : [], code: bad ? 1 : 0 };
      }
      const { inputs, errors } = await readInputs(ctx, cmd, o.operands);
      const out: string[] = [];
      for (const inp of inputs) out.push(`${await hash(inp.bytes)}  ${inp.name}`);
      return { stdout: joinLines(out), stderr: errors, code: errors.length ? 1 : 0 };
    },
  };
}
