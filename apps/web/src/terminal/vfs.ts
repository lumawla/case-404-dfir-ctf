import type { FileEntry, FileListing } from "@case404/shared";

export const HOME = "/home/investigator";

export type FileNode = {
  type: "file";
  name: string;
  /** Absolute virtual path. */
  abs: string;
  /** Path relative to the case root for evidence files; null for scratch files in /tmp. */
  casePath: string | null;
  size: number;
  modified: string;
  mime: string;
  /** Scratch files keep their bytes here; evidence is fetched lazily from the API. */
  data?: Uint8Array;
};

export type DirNode = { type: "dir"; name: string; abs: string; children: Map<string, Node>; modified: string; writable: boolean };

export type Node = FileNode | DirNode;

const dir = (abs: string, modified: string, writable = false): DirNode => ({
  type: "dir",
  name: abs === "/" ? "/" : abs.split("/").pop()!,
  abs,
  children: new Map(),
  modified,
  writable,
});

/** Joins and normalizes a POSIX path. `~` expands to the home directory. */
export function resolvePath(cwd: string, input: string): string {
  let p = input;
  if (p === "~" || p.startsWith("~/")) p = HOME + p.slice(1);
  const parts = (p.startsWith("/") ? p : `${cwd}/${p}`).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

/** Shows a path the way a prompt does: home becomes "~". */
export function prettyPath(abs: string): string {
  if (abs === HOME) return "~";
  if (abs.startsWith(`${HOME}/`)) return `~${abs.slice(HOME.length)}`;
  return abs;
}

/**
 * The investigator's machine: a read-only evidence tree mounted at ~/case404 and a writable /tmp.
 * Only the file list lives here; bytes are fetched on demand.
 */
export class Vfs {
  readonly root: DirNode;
  readonly caseRoot: string;

  constructor(listing: FileListing) {
    const latest = listing.files.reduce((m, f) => (f.modified > m ? f.modified : m), listing.files[0]?.modified ?? "2026-11-01T00:00:00+02:00");
    this.root = dir("/", latest);
    this.caseRoot = `${HOME}/${listing.root}`;
    this.mkdirs(HOME, latest);
    this.mkdirs("/tmp", latest).writable = true;
    for (const f of listing.files) this.addEvidence(f);
    this.mkdirs(this.caseRoot, latest);
  }

  /** Mounts files that weren't there before (a new act's evidence). /tmp and everything already mounted stay as they are. Returns the new paths. */
  mount(listing: FileListing): string[] {
    const added = listing.files.filter((f) => !this.stat(`${this.caseRoot}/${f.path}`));
    for (const f of added) this.addEvidence(f);
    return added.map((f) => f.path);
  }

  private mkdirs(abs: string, modified: string): DirNode {
    let node = this.root;
    let path = "";
    for (const part of abs.split("/").filter(Boolean)) {
      path += `/${part}`;
      let next = node.children.get(part);
      if (!next) {
        next = dir(path, modified);
        node.children.set(part, next);
      }
      if (next.type !== "dir") throw new Error(`${path} is a file`);
      if (modified > next.modified) next.modified = modified;
      node = next;
    }
    return node;
  }

  private addEvidence(f: FileEntry) {
    const abs = `${this.caseRoot}/${f.path}`;
    const parent = this.mkdirs(abs.slice(0, abs.lastIndexOf("/")), f.modified);
    parent.children.set(abs.split("/").pop()!, { type: "file", name: abs.split("/").pop()!, abs, casePath: f.path, size: f.size, modified: f.modified, mime: f.mime });
  }

  stat(abs: string): Node | null {
    let node: Node = this.root;
    for (const part of abs.split("/").filter(Boolean)) {
      if (node.type !== "dir") return null;
      const next: Node | undefined = node.children.get(part);
      if (!next) return null;
      node = next;
    }
    return node;
  }

  /** Children sorted the way `ls` sorts them (by name, dotfiles by their name after the dot). */
  list(node: DirNode): Node[] {
    const key = (n: string) => n.replace(/^\./, "").toLowerCase();
    return [...node.children.values()].sort((a, b) => key(a.name).localeCompare(key(b.name)) || a.name.localeCompare(b.name));
  }

  /** Writes a scratch file. Returns an error message for anything outside /tmp. */
  write(abs: string, data: Uint8Array, append = false): string | null {
    const parentPath = abs.slice(0, abs.lastIndexOf("/")) || "/";
    const parent = this.stat(parentPath);
    if (!parent || parent.type !== "dir") return "No such file or directory";
    const existing = parent.children.get(abs.split("/").pop()!);
    if (existing?.type === "dir") return "Is a directory";
    if (!parent.writable) return "Read-only file system";
    const prev = existing?.type === "file" && existing.data ? existing.data : new Uint8Array();
    const bytes = append ? concat(prev, data) : data;
    const modified = inWorldNow();
    parent.children.set(abs.split("/").pop()!, { type: "file", name: abs.split("/").pop()!, abs, casePath: null, size: bytes.length, modified, mime: "text/plain", data: bytes });
    return null;
  }

  remove(abs: string): string | null {
    const parentPath = abs.slice(0, abs.lastIndexOf("/")) || "/";
    const parent = this.stat(parentPath);
    const node = this.stat(abs);
    if (!node || !parent || parent.type !== "dir") return "No such file or directory";
    if (!parent.writable) return "Read-only file system";
    if (node.type === "dir") return "Is a directory";
    parent.children.delete(node.name);
    return null;
  }

  /** Every node under `from`, depth first, `from` included. */
  *walk(from: Node, depth = 0): Generator<{ node: Node; depth: number }> {
    yield { node: from, depth };
    if (from.type === "dir") for (const child of this.list(from)) yield* this.walk(child, depth + 1);
  }
}

export function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

const SHELL_EPOCH = Date.now();
/** The investigator's clock: the case opens at 01:10 on 1 November, local time (+02:00). */
export function inWorldNow(): string {
  const t = new Date(Date.parse("2026-11-01T01:10:00+02:00") + (Date.now() - SHELL_EPOCH) + 2 * 3600_000);
  return `${t.toISOString().slice(0, 19)}+02:00`;
}
