/**
 * A small jq: paths (.a.b, .[0], .[], .a[]), pipes, keys, length, select(), test(), and string/number
 * comparisons. Enough to slice the JSON evidence; anything else reports a clear error.
 */

type Json = unknown;

export class JqError extends Error {}

type Filter = (input: Json) => Json[];

export function compileJq(src: string): Filter {
  const p = new Parser(src.trim() || ".");
  const f = p.pipe();
  p.skip();
  if (p.i < p.s.length) throw new JqError(`syntax error, unexpected '${p.s.slice(p.i, p.i + 12)}'`);
  return f;
}

class Parser {
  i = 0;
  constructor(readonly s: string) {}

  skip() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }

  peek(t: string) {
    this.skip();
    return this.s.startsWith(t, this.i);
  }

  eat(t: string) {
    if (!this.peek(t)) throw new JqError(`syntax error, expected '${t}' at ${this.i + 1}`);
    this.i += t.length;
  }

  pipe(): Filter {
    let left = this.comma();
    while (this.peek("|")) {
      this.eat("|");
      const l = left;
      const r = this.comma();
      left = (x) => l(x).flatMap(r);
    }
    return left;
  }

  comma(): Filter {
    const parts = [this.or()];
    while (this.peek(",")) {
      this.eat(",");
      parts.push(this.or());
    }
    return parts.length === 1 ? parts[0] : (x) => parts.flatMap((p) => p(x));
  }

  or(): Filter {
    let left = this.and();
    while (this.peekWord("or")) {
      this.i += 2;
      const l = left;
      const r = this.and();
      left = (x) => l(x).flatMap((a) => r(x).map((b) => truthy(a) || truthy(b)));
    }
    return left;
  }

  and(): Filter {
    let left = this.compare();
    while (this.peekWord("and")) {
      this.i += 3;
      const l = left;
      const r = this.compare();
      left = (x) => l(x).flatMap((a) => r(x).map((b) => truthy(a) && truthy(b)));
    }
    return left;
  }

  compare(): Filter {
    const left = this.postfix();
    for (const op of ["==", "!=", ">=", "<=", ">", "<"]) {
      if (this.peek(op)) {
        this.eat(op);
        const right = this.postfix();
        return (x) =>
          left(x).flatMap((a) =>
            right(x).map((b) => {
              if (op === "==") return JSON.stringify(a) === JSON.stringify(b);
              if (op === "!=") return JSON.stringify(a) !== JSON.stringify(b);
              const [l, r] = [a as number | string, b as number | string];
              return op === ">" ? l > r : op === "<" ? l < r : op === ">=" ? l >= r : l <= r;
            }),
          );
      }
    }
    return left;
  }

  peekWord(w: string) {
    this.skip();
    return this.s.startsWith(w, this.i) && !/\w/.test(this.s[this.i + w.length] ?? "");
  }

  postfix(): Filter {
    let f = this.primary();
    for (;;) {
      this.skip();
      if (this.s[this.i] === "[" || (this.s[this.i] === "." && /[\w"[]/.test(this.s[this.i + 1] ?? ""))) {
        const base = f;
        const access = this.access();
        f = (x) => base(x).flatMap(access);
      } else return f;
    }
  }

  /** `.name`, `."name"`, `[n]`, `[]`, `["name"]` applied to the current value. */
  access(): Filter {
    this.skip();
    if (this.s[this.i] === ".") this.i++;
    if (this.s[this.i] === "[") {
      this.i++;
      this.skip();
      if (this.s[this.i] === "]") {
        this.i++;
        return (x) => {
          if (Array.isArray(x)) return x;
          if (x && typeof x === "object") return Object.values(x);
          throw new JqError(`Cannot iterate over ${typeName(x)}`);
        };
      }
      const key = this.literal();
      this.eat("]");
      return (x) => [index(x, key)];
    }
    if (this.s[this.i] === '"') {
      const key = this.literal();
      return (x) => [index(x, key)];
    }
    const m = /^[A-Za-z_]\w*/.exec(this.s.slice(this.i));
    if (!m) throw new JqError(`syntax error at ${this.i + 1}`);
    this.i += m[0].length;
    return (x) => [index(x, m[0])];
  }

  literal(): string | number | boolean | null {
    this.skip();
    const rest = this.s.slice(this.i);
    const str = /^"((?:[^"\\]|\\.)*)"/.exec(rest);
    if (str) {
      this.i += str[0].length;
      return JSON.parse(`"${str[1]}"`);
    }
    const num = /^-?\d+(\.\d+)?/.exec(rest);
    if (num) {
      this.i += num[0].length;
      return Number(num[0]);
    }
    for (const [w, v] of [["true", true], ["false", false], ["null", null]] as const) {
      if (this.peekWord(w)) {
        this.i += w.length;
        return v;
      }
    }
    throw new JqError(`syntax error at ${this.i + 1}`);
  }

  primary(): Filter {
    this.skip();
    const c = this.s[this.i];
    if (c === "(") {
      this.i++;
      const f = this.pipe();
      this.eat(")");
      return f;
    }
    if (c === ".") {
      if (this.s[this.i + 1] === ".") {
        this.i += 2;
        return (x) => recurse(x);
      }
      if (/[\w"[]/.test(this.s[this.i + 1] ?? "")) return this.access();
      this.i++;
      return (x) => [x];
    }
    if (c === '"' || c === "-" || /\d/.test(c ?? "") || this.peekWord("true") || this.peekWord("false") || this.peekWord("null")) {
      const v = this.literal();
      return () => [v];
    }
    const name = /^[A-Za-z_]\w*/.exec(this.s.slice(this.i))?.[0];
    if (!name) throw new JqError(`syntax error, unexpected '${this.s.slice(this.i, this.i + 8) || "end of input"}'`);
    this.i += name.length;
    const arg = () => {
      this.eat("(");
      const f = this.pipe();
      this.eat(")");
      return f;
    };
    switch (name) {
      case "keys":
        return (x) => [x && typeof x === "object" ? (Array.isArray(x) ? x.map((_, i) => i) : Object.keys(x).sort()) : err(`${typeName(x)} has no keys`)];
      case "length":
        return (x) => [Array.isArray(x) || typeof x === "string" ? x.length : x && typeof x === "object" ? Object.keys(x).length : x === null ? 0 : Math.abs(x as number)];
      case "not":
        return (x) => [!truthy(x)];
      case "select": {
        const cond = arg();
        return (x) => (cond(x).some(truthy) ? [x] : []);
      }
      case "test":
      case "contains":
      case "startswith":
      case "endswith": {
        const a = arg();
        return (x) =>
          a(x).map((needle) => {
            if (typeof x !== "string" || typeof needle !== "string") return err(`${name} requires strings`);
            if (name === "test") return new RegExp(needle).test(x);
            if (name === "contains") return x.includes(needle);
            return name === "startswith" ? x.startsWith(needle) : x.endsWith(needle);
          });
      }
      case "ascii_downcase":
        return (x) => [String(x).toLowerCase()];
      case "ascii_upcase":
        return (x) => [String(x).toUpperCase()];
      case "to_entries":
        return (x) => [Object.entries(x as object).map(([key, value]) => ({ key, value }))];
      case "map": {
        const f = arg();
        return (x) => [(x as Json[]).flatMap(f)];
      }
      case "tostring":
        return (x) => [typeof x === "string" ? x : JSON.stringify(x)];
      default:
        throw new JqError(`${name}/0 is not defined (this jq supports: keys, length, select, test, contains, startswith, endswith, map, to_entries, ascii_downcase)`);
    }
  }
}

function recurse(x: Json): Json[] {
  if (Array.isArray(x)) return [x, ...x.flatMap(recurse)];
  if (x && typeof x === "object") return [x, ...Object.values(x).flatMap(recurse)];
  return [x];
}

const truthy = (v: Json) => v !== false && v !== null;
const typeName = (v: Json) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
const err = (m: string): never => {
  throw new JqError(m);
};

function index(x: Json, key: string | number | boolean | null): Json {
  if (x === null) return null;
  if (typeof key === "number") {
    if (!Array.isArray(x)) throw new JqError(`Cannot index ${typeName(x)} with number`);
    return x[key < 0 ? x.length + key : key] ?? null;
  }
  if (typeof x !== "object" || Array.isArray(x)) throw new JqError(`Cannot index ${typeName(x)} with "${key}"`);
  return (x as Record<string, Json>)[String(key)] ?? null;
}

export function formatJson(v: Json, compact: boolean, raw: boolean): string {
  if (raw && typeof v === "string") return v;
  return compact ? JSON.stringify(v) : JSON.stringify(v, null, 2);
}
