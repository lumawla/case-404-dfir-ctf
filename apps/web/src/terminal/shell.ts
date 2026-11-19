import { COMMANDS, type CommandContext, type CommandResult } from "./commands";
import { encode, utf8 } from "./media";
import { HOME, type FileNode, type Node, Vfs, prettyPath, resolvePath } from "./vfs";

export type SpanClass = "dir" | "hidden" | "media" | "err" | "muted" | "match" | "bold" | "accent" | "warn";
export type Span = { t: string; c?: SpanClass };

/** One thing printed to the terminal. */
export type Out =
  | { kind: "text"; text: string; cls?: SpanClass }
  | { kind: "rich"; lines: Span[][] }
  | { kind: "image"; src: string; alt: string; name: string }
  | { kind: "link"; href: string; label: string }
  | { kind: "clear" };

/** Where file bytes come from. The browser fetches evidence from the API; tests read from disk. */
export interface FileIO {
  read(node: FileNode): Promise<Uint8Array>;
  pdfText(node: FileNode): Promise<string>;
  objectUrl(node: FileNode): Promise<string>;
  download(node: FileNode): Promise<void>;
  openInNewTab(url: string): void;
}

type Segment = { text: string; quote: "none" | "single" | "double" };
type Word = { segments: Segment[] };
type Token = { type: "word"; word: Word } | { type: "op"; op: "|" | "||" | "&&" | ";" | ">" | ">>" | "2>" | "2>>" | "&>" };
type Stage = { words: Word[]; out?: { word: Word; append: boolean }; err?: { word: Word; append: boolean } };
type Chain = { stages: Stage[]; next: ";" | "&&" | "||" | null };

export class ShellSyntaxError extends Error {}

export function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let word: Word | null = null;
  const pushChar = (ch: string, quote: Segment["quote"]) => {
    word ??= { segments: [] };
    const last = word.segments[word.segments.length - 1];
    if (last && last.quote === quote) last.text += ch;
    else word.segments.push({ text: ch, quote });
  };
  const endWord = () => {
    if (word) tokens.push({ type: "word", word });
    word = null;
  };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'") {
      const end = line.indexOf("'", i + 1);
      if (end === -1) throw new ShellSyntaxError("unexpected EOF while looking for matching `''");
      word ??= { segments: [] };
      word.segments.push({ text: line.slice(i + 1, end), quote: "single" });
      i = end;
    } else if (ch === '"') {
      let j = i + 1;
      let text = "";
      for (; j < line.length && line[j] !== '"'; j++) {
        if (line[j] === "\\" && j + 1 < line.length && '"\\$`'.includes(line[j + 1])) text += line[++j];
        else text += line[j];
      }
      if (j >= line.length) throw new ShellSyntaxError('unexpected EOF while looking for matching `"\'');
      word ??= { segments: [] };
      word.segments.push({ text, quote: "double" });
      i = j;
    } else if (ch === "\\") {
      if (i + 1 < line.length) pushChar(line[++i], "single");
    } else if (ch === " " || ch === "\t") {
      endWord();
    } else if (ch === "#" && !word) {
      break;
    } else if ("|;&>".includes(ch) || (ch === "2" && !word && line[i + 1] === ">")) {
      const rest = line.slice(i);
      const op = (["2>>", "2>", "&>", ">>", "||", "&&", "|", ";", ">"] as const).find((o) => rest.startsWith(o));
      if (!op) {
        pushChar(ch, "none");
        continue;
      }
      endWord();
      tokens.push({ type: "op", op });
      i += op.length - 1;
    } else {
      pushChar(ch, "none");
    }
  }
  endWord();
  return tokens;
}

function parse(tokens: Token[]): Chain[] {
  const chains: Chain[] = [];
  let stages: Stage[] = [];
  let stage: Stage = { words: [] };
  const word = (i: number): Word => {
    const t = tokens[i];
    if (!t || t.type !== "word") throw new ShellSyntaxError(`syntax error near unexpected token \`${t && t.type === "op" ? t.op : "newline"}'`);
    return t.word;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "word") {
      stage.words.push(t.word);
      continue;
    }
    if (t.op === ">" || t.op === ">>" || t.op === "&>") stage.out = { word: word(++i), append: t.op === ">>" };
    else if (t.op === "2>" || t.op === "2>>") stage.err = { word: word(++i), append: t.op === "2>>" };
    if (t.op === "&>") stage.err = { word: stage.out!.word, append: false };
    if (t.op === "|") {
      if (!stage.words.length) throw new ShellSyntaxError("syntax error near unexpected token `|'");
      stages.push(stage);
      stage = { words: [] };
    }
    if (t.op === ";" || t.op === "&&" || t.op === "||") {
      if (!stage.words.length && !stages.length) {
        if (t.op === ";" && !chains.length) continue;
        throw new ShellSyntaxError(`syntax error near unexpected token \`${t.op}'`);
      }
      stages.push(stage);
      chains.push({ stages, next: t.op });
      stages = [];
      stage = { words: [] };
    }
  }
  if (stage.words.length || stages.length) {
    if (!stage.words.length) throw new ShellSyntaxError("syntax error: unexpected end of file");
    stages.push(stage);
    chains.push({ stages, next: null });
  }
  return chains;
}

const GLOB = /[*?[]/;

function globToRegExp(component: string): RegExp {
  let re = "";
  for (let i = 0; i < component.length; i++) {
    const ch = component[i];
    if (ch === "\\" && i + 1 < component.length) re += component[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else if (ch === "[") {
      const end = component.indexOf("]", i + 2);
      if (end === -1) re += "\\[";
      else {
        let set = component.slice(i + 1, end);
        if (set.startsWith("!")) set = `^${set.slice(1)}`;
        re += `[${set.replace(/\\/g, "\\\\")}]`;
        i = end;
      }
    } else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export class Shell {
  cwd = HOME;
  private prevCwd = HOME;
  history: string[] = [];
  /** Approximate terminal width in characters, set by the UI. */
  cols = 100;
  readonly user = "investigator";
  readonly host = "der-forensics";

  constructor(
    readonly vfs: Vfs,
    readonly io: FileIO,
  ) {}

  get prompt() {
    return { user: `${this.user}@${this.host}`, path: prettyPath(this.cwd) };
  }

  cd(target: string | undefined): string | null {
    const dest = target === undefined ? HOME : target === "-" ? this.prevCwd : resolvePath(this.cwd, target);
    const node = this.vfs.stat(dest);
    if (!node) return `cd: ${target}: No such file or directory`;
    if (node.type !== "dir") return `cd: ${target}: Not a directory`;
    this.prevCwd = this.cwd;
    this.cwd = dest;
    return null;
  }

  env(name: string): string {
    return ({ HOME, PWD: this.cwd, OLDPWD: this.prevCwd, USER: this.user, HOSTNAME: this.host, SHELL: "/bin/bash" } as Record<string, string>)[name] ?? "";
  }

  /** Expands variables, a leading ~ and globs. One word can become several arguments. */
  expand(word: Word): string[] {
    let text = "";
    let globSource = "";
    let hasGlob = false;
    word.segments.forEach((seg, idx) => {
      let t = seg.text;
      if (seg.quote !== "single") t = t.replace(/\$(\w+)|\$\{(\w+)\}/g, (_, a, b) => this.env(a ?? b));
      if (seg.quote === "none" && idx === 0 && (t === "~" || t.startsWith("~/"))) t = HOME + t.slice(1);
      text += t;
      if (seg.quote === "none" && GLOB.test(t)) {
        hasGlob = true;
        globSource += t;
      } else globSource += t.replace(/[*?[\]\\]/g, "\\$&");
    });
    if (!hasGlob) return [text];
    const matches = this.glob(globSource);
    return matches.length ? matches : [text];
  }

  private glob(pattern: string): string[] {
    const absolute = pattern.startsWith("/");
    const parts = pattern.split("/").filter(Boolean);
    let current: { node: Node; shown: string }[] = [{ node: this.vfs.stat(absolute ? "/" : this.cwd)!, shown: absolute ? "/" : "" }];
    for (const part of parts) {
      const next: { node: Node; shown: string }[] = [];
      const join = (shown: string, name: string) => (shown === "" ? name : shown.endsWith("/") ? shown + name : `${shown}/${name}`);
      if (!GLOB.test(part.replace(/\\./g, ""))) {
        const literal = part.replace(/\\(.)/g, "$1");
        for (const c of current) {
          const abs = resolvePath(absolute ? "/" : this.cwd, join(c.shown, literal));
          const node = this.vfs.stat(abs);
          if (node) next.push({ node, shown: join(c.shown, literal) });
        }
      } else {
        const re = globToRegExp(part);
        for (const c of current) {
          if (c.node.type !== "dir") continue;
          for (const child of this.vfs.list(c.node)) {
            if (child.name.startsWith(".") && !part.startsWith(".")) continue;
            if (re.test(child.name)) next.push({ node: child, shown: join(c.shown, child.name) });
          }
        }
      }
      current = next;
    }
    return current.map((c) => c.shown).sort();
  }

  /** Runs one line and returns everything it printed. Never throws. */
  async run(line: string): Promise<Out[]> {
    const trimmed = line.trim();
    if (trimmed) {
      if (this.history[this.history.length - 1] !== trimmed) this.history.push(trimmed);
      if (this.history.length > 500) this.history.splice(0, this.history.length - 500);
    }
    let chains: Chain[];
    try {
      chains = parse(tokenize(line));
    } catch (e) {
      return [{ kind: "text", text: `bash: ${(e as Error).message}`, cls: "err" }];
    }
    const out: Out[] = [];
    let lastCode = 0;
    for (let i = 0; i < chains.length; i++) {
      const prev = chains[i - 1]?.next;
      if (prev === "&&" && lastCode !== 0) continue;
      if (prev === "||" && lastCode === 0) continue;
      lastCode = await this.runPipeline(chains[i].stages, out);
    }
    return out;
  }

  private async runPipeline(stages: Stage[], out: Out[]): Promise<number> {
    let stdin: Uint8Array | null = null;
    let code = 0;
    for (let s = 0; s < stages.length; s++) {
      const stage = stages[s];
      const argv = stage.words.flatMap((w) => this.expand(w));
      const name = argv[0];
      const last = s === stages.length - 1;
      const outPath = stage.out ? this.expand(stage.out.word)[0] : null;
      const errPath = stage.err ? this.expand(stage.err.word)[0] : null;
      const tty = last && !outPath;
      let result: CommandResult;
      const command = COMMANDS[name];
      if (!command) {
        result = { stderr: [`${name}: command not found`], code: 127 };
      } else {
        const ctx: CommandContext = { argv, args: argv.slice(1), stdin, tty, sh: this, cols: this.cols };
        try {
          result = await command.run(ctx);
        } catch (e) {
          result = { stderr: [`${name}: ${(e as Error).message}`], code: 1 };
        }
      }
      code = result.code ?? 0;
      const stdoutBytes = typeof result.stdout === "string" ? encode(result.stdout) : (result.stdout ?? new Uint8Array());

      if (errPath && result.stderr?.length) {
        if (errPath !== "/dev/null") this.redirect(errPath, encode(`${result.stderr.join("\n")}\n`), !!stage.err?.append, out);
      } else for (const e of result.stderr ?? []) out.push({ kind: "text", text: e, cls: "err" });

      if (outPath) {
        if (outPath !== "/dev/null") this.redirect(outPath, stdoutBytes, !!stage.out?.append, out);
        stdin = null;
      } else if (last) {
        if (result.rich) out.push({ kind: "rich", lines: result.rich });
        else if (stdoutBytes.length) out.push({ kind: "text", text: utf8.decode(stdoutBytes).replace(/\n$/, "") });
        for (const b of result.blocks ?? []) out.push(b);
      } else {
        stdin = stdoutBytes;
      }
    }
    return code;
  }

  private redirect(path: string, data: Uint8Array, append: boolean, out: Out[]) {
    const err = this.vfs.write(resolvePath(this.cwd, path), data, append);
    if (err) out.push({ kind: "text", text: `bash: ${path}: ${err}`, cls: "err" });
  }

  /** Tab completion for the word under the cursor. */
  complete(line: string): { line: string; options: string[] } {
    const m = /(^|[\s|;&><]+)([^\s|;&><]*)$/.exec(line)!;
    const before = line.slice(0, line.length - m[2].length);
    const partial = m[2];
    const isCommand = !before.trim() || /[|;&]\s*$/.test(before);
    let options: string[];
    if (isCommand && !partial.includes("/")) {
      options = Object.keys(COMMANDS)
        .filter((c) => c.startsWith(partial) && !COMMANDS[c].hidden)
        .sort();
      if (options.length === 1) return { line: `${before}${options[0]} `, options: [] };
    } else {
      const unquoted = partial.replace(/\\(.)/g, "$1");
      const slash = unquoted.lastIndexOf("/");
      const dirPart = slash === -1 ? "" : unquoted.slice(0, slash + 1);
      const namePart = unquoted.slice(slash + 1);
      const dirAbs = resolvePath(this.cwd, dirPart === "" ? "." : dirPart.startsWith("~") ? HOME + dirPart.slice(1) : dirPart);
      const node = this.vfs.stat(dirAbs);
      if (!node || node.type !== "dir") return { line, options: [] };
      const children = this.vfs.list(node).filter((c) => c.name.startsWith(namePart) && (namePart.startsWith(".") || !c.name.startsWith(".")));
      const names = children.map((c) => c.name + (c.type === "dir" ? "/" : ""));
      if (names.length === 1) {
        const done = names[0].endsWith("/") ? "" : " ";
        return { line: `${before}${escapeWord(dirPart + names[0])}${done}`, options: [] };
      }
      options = names;
      if (names.length > 1) {
        let common = names[0];
        for (const n of names) while (!n.startsWith(common)) common = common.slice(0, -1);
        if (common.length > namePart.length) return { line: `${before}${escapeWord(dirPart + common)}`, options: [] };
      }
    }
    return { line, options };
  }
}

const escapeWord = (s: string) => s.replace(/([\s'"\\|;&<>()$`*?[\]])/g, "\\$1");
