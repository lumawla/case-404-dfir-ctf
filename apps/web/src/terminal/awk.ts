/**
 * A small awk: BEGIN/END blocks, /regex/ and comparison patterns (&&, ||, !), print with fields,
 * NR/NF, string concatenation, variables, = += -= ++ and arithmetic. No functions, arrays or printf.
 */

export class AwkError extends Error {}

type Tok = { t: "num" | "str" | "re" | "id" | "field" | "op" | "punct"; v: string };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const prevAllowsRegex = () => {
    const p = out[out.length - 1];
    return !p || (p.t === "op" && !["++", "--"].includes(p.v)) || (p.t === "punct" && p.v !== ")");
  };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      if (c === "\n") out.push({ t: "punct", v: ";" });
      i++;
      continue;
    }
    const rest = src.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^\d+(\.\d+)?/.exec(rest))) out.push({ t: "num", v: m[0] });
    else if ((m = /^"((?:[^"\\]|\\.)*)"/.exec(rest))) out.push({ t: "str", v: m[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\(.)/g, "$1") });
    else if (c === "/" && prevAllowsRegex() && (m = /^\/((?:[^/\\]|\\.)*)\//.exec(rest))) out.push({ t: "re", v: m[1] });
    else if ((m = /^\$/.exec(rest))) out.push({ t: "field", v: "$" });
    else if ((m = /^[A-Za-z_]\w*/.exec(rest))) out.push({ t: "id", v: m[0] });
    else if ((m = /^(==|!=|>=|<=|&&|\|\||\+\+|--|\+=|-=|\*=|\/=|!~|[~<>!=+\-*/%])/.exec(rest))) out.push({ t: "op", v: m[0] });
    else if ("{}();,".includes(c)) out.push({ t: "punct", v: c });
    else throw new AwkError(`syntax error at source line 1, near "${rest.slice(0, 10)}"`);
    i += m ? m[0].length : 1;
  }
  return out;
}

type Env = { fields: string[]; NR: number; vars: Map<string, string | number>; out: string[]; ofs: string };
type Expr = (e: Env) => string | number;
type Stmt = (e: Env) => void;
type Rule = { kind: "begin" | "end" | "main"; pattern: Expr | null; action: Stmt[] | null };

class Parser {
  i = 0;
  constructor(readonly toks: Tok[]) {}
  peek(v?: string) {
    const t = this.toks[this.i];
    return v === undefined ? t : t && t.v === v && (t.t === "op" || t.t === "punct" || t.t === "id") ? t : undefined;
  }
  eat(v: string) {
    if (!this.peek(v)) throw new AwkError(`syntax error: expected '${v}'`);
    this.i++;
  }
  skipSemis() {
    while (this.peek(";")) this.i++;
  }

  program(): Rule[] {
    const rules: Rule[] = [];
    this.skipSemis();
    while (this.i < this.toks.length) {
      let kind: Rule["kind"] = "main";
      let pattern: Expr | null = null;
      if (this.peek("BEGIN")) {
        this.i++;
        kind = "begin";
      } else if (this.peek("END")) {
        this.i++;
        kind = "end";
      } else if (!this.peek("{")) pattern = this.expr();
      const action = this.peek("{") ? this.block() : null;
      rules.push({ kind, pattern, action });
      this.skipSemis();
    }
    return rules;
  }

  block(): Stmt[] {
    this.eat("{");
    const stmts: Stmt[] = [];
    this.skipSemis();
    while (!this.peek("}")) {
      if (this.i >= this.toks.length) throw new AwkError("syntax error: missing '}'");
      stmts.push(this.stmt());
      this.skipSemis();
    }
    this.eat("}");
    return stmts;
  }

  stmt(): Stmt {
    if (this.peek("print")) {
      this.i++;
      const items: Expr[] = [];
      if (!this.peek(";") && !this.peek("}")) {
        items.push(this.expr());
        while (this.peek(",")) {
          this.i++;
          items.push(this.expr());
        }
      }
      return (e) => e.out.push(items.length ? items.map((x) => fmt(x(e))).join(e.ofs) : e.fields[0]);
    }
    const t = this.peek();
    if (t?.t === "id" && ["+=", "-=", "*=", "/=", "=", "++", "--"].includes(this.toks[this.i + 1]?.v ?? "")) {
      const name = t.v;
      const op = this.toks[this.i + 1].v;
      this.i += 2;
      if (op === "++" || op === "--") return (e) => void e.vars.set(name, num(e.vars.get(name) ?? 0) + (op === "++" ? 1 : -1));
      const rhs = this.expr();
      return (e) => {
        const cur = num(e.vars.get(name) ?? 0);
        const v = rhs(e);
        e.vars.set(name, op === "=" ? v : op === "+=" ? cur + num(v) : op === "-=" ? cur - num(v) : op === "*=" ? cur * num(v) : cur / num(v));
      };
    }
    throw new AwkError(`unsupported statement near "${t?.v ?? "end"}" (this awk supports print and simple assignments)`);
  }

  expr(): Expr {
    return this.orExpr();
  }
  orExpr(): Expr {
    let l = this.andExpr();
    while (this.peek("||")) {
      this.i++;
      const a = l;
      const b = this.andExpr();
      l = (e) => (truthy(a(e)) || truthy(b(e)) ? 1 : 0);
    }
    return l;
  }
  andExpr(): Expr {
    let l = this.match();
    while (this.peek("&&")) {
      this.i++;
      const a = l;
      const b = this.match();
      l = (e) => (truthy(a(e)) && truthy(b(e)) ? 1 : 0);
    }
    return l;
  }
  match(): Expr {
    const l = this.compare();
    if (this.peek("~") || this.peek("!~")) {
      const neg = this.toks[this.i++].v === "!~";
      const r = this.toks[this.i];
      let re: (e: Env) => RegExp;
      if (r?.t === "re") {
        this.i++;
        const compiled = new RegExp(r.v);
        re = () => compiled;
      } else {
        const x = this.compare();
        re = (e) => new RegExp(fmt(x(e)));
      }
      return (e) => (re(e).test(fmt(l(e))) !== neg ? 1 : 0);
    }
    return l;
  }
  compare(): Expr {
    const l = this.concat();
    const op = this.peek()?.v;
    if (op && ["==", "!=", "<", ">", "<=", ">="].includes(op) && this.peek()?.t === "op") {
      this.i++;
      const r = this.concat();
      return (e) => {
        const [a, b] = [l(e), r(e)];
        const numeric = isNum(a) && isNum(b);
        const [x, y] = numeric ? [num(a), num(b)] : [fmt(a), fmt(b)];
        return (op === "==" ? x === y : op === "!=" ? x !== y : op === "<" ? x < y : op === ">" ? x > y : op === "<=" ? x <= y : x >= y) ? 1 : 0;
      };
    }
    return l;
  }
  concat(): Expr {
    const parts = [this.additive()];
    for (;;) {
      const t = this.peek();
      const startsOperand = !!t && (t.t === "num" || t.t === "str" || t.t === "field" || (t.t === "id" && t.v !== "print") || (t.t === "punct" && t.v === "("));
      if (!startsOperand) break;
      parts.push(this.additive());
    }
    return parts.length === 1 ? parts[0] : (e) => parts.map((p) => fmt(p(e))).join("");
  }
  additive(): Expr {
    let l = this.term();
    while (this.peek("+") || this.peek("-")) {
      const op = this.toks[this.i++].v;
      const a = l;
      const b = this.term();
      l = (e) => (op === "+" ? num(a(e)) + num(b(e)) : num(a(e)) - num(b(e)));
    }
    return l;
  }
  term(): Expr {
    let l = this.unary();
    while (this.peek("*") || this.peek("/") || this.peek("%")) {
      const op = this.toks[this.i++].v;
      const a = l;
      const b = this.unary();
      l = (e) => (op === "*" ? num(a(e)) * num(b(e)) : op === "/" ? num(a(e)) / num(b(e)) : num(a(e)) % num(b(e)));
    }
    return l;
  }
  unary(): Expr {
    if (this.peek("!")) {
      this.i++;
      const x = this.unary();
      return (e) => (truthy(x(e)) ? 0 : 1);
    }
    if (this.peek("-")) {
      this.i++;
      const x = this.unary();
      return (e) => -num(x(e));
    }
    return this.primary();
  }
  primary(): Expr {
    const t = this.toks[this.i++];
    if (!t) throw new AwkError("syntax error: unexpected end of program");
    if (t.t === "num") return () => Number(t.v);
    if (t.t === "str") return () => t.v;
    if (t.t === "re") {
      const re = new RegExp(t.v);
      return (e) => (re.test(e.fields[0]) ? 1 : 0);
    }
    if (t.t === "field") {
      const idx = this.primary();
      return (e) => e.fields[num(idx(e))] ?? "";
    }
    if (t.v === "(") {
      const x = this.expr();
      this.eat(")");
      return x;
    }
    if (t.t === "id") {
      if (t.v === "NR") return (e) => e.NR;
      if (t.v === "NF") return (e) => e.fields.length - 1;
      return (e) => e.vars.get(t.v) ?? "";
    }
    throw new AwkError(`syntax error near "${t.v}"`);
  }
}

const isNum = (v: string | number) => typeof v === "number" || /^\s*-?\d+(\.\d+)?\s*$/.test(v);
const num = (v: string | number) => (typeof v === "number" ? v : Number.parseFloat(v) || 0);
const truthy = (v: string | number) => (typeof v === "number" ? v !== 0 : v !== "" && v !== "0");
const fmt = (v: string | number) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(6)))) : v);

export function runAwk(program: string, input: string, fs: string | null): string[] {
  const rules = new Parser(lex(program)).program();
  const env: Env = { fields: [], NR: 0, vars: new Map(), out: [], ofs: " " };
  const split = (line: string) => {
    const parts = fs === null ? line.trim().split(/\s+/).filter(Boolean) : fs.length === 1 ? line.split(fs) : line.split(new RegExp(fs));
    return [line, ...parts];
  };
  const runRule = (r: Rule) => {
    if (r.pattern && !truthy(r.pattern(env))) return;
    if (r.action) for (const s of r.action) s(env);
    else env.out.push(env.fields[0]);
  };
  for (const r of rules) if (r.kind === "begin") runRule(r);
  const lines = input.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  for (const line of lines) {
    env.NR++;
    env.fields = split(line);
    for (const r of rules) if (r.kind === "main") runRule(r);
  }
  for (const r of rules) if (r.kind === "end") runRule(r);
  return env.out;
}
