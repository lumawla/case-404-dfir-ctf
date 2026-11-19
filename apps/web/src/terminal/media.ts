/** Byte-level helpers for `file`, `exiftool`, `strings`, `xxd` and the hash commands. Everything reads the real file bytes. */

export const utf8 = new TextDecoder("utf-8");
export const encode = (s: string) => new TextEncoder().encode(s);

export function isBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 4096);
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0 || (b < 0x20 && ![9, 10, 11, 12, 13, 27].includes(b))) return true;
  }
  return isJpeg(bytes) || isPng(bytes) || isPdf(bytes);
}

export const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
export const isPng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
export const isPdf = (b: Uint8Array) => b.length > 5 && utf8.decode(b.subarray(0, 5)) === "%PDF-";
export const isSqlite = (b: Uint8Array) => b.length >= 100 && utf8.decode(b.subarray(0, 16)) === "SQLite format 3\0";

/** The fields `file` reports from a SQLite database header. */
export function sqliteInfo(b: Uint8Array) {
  if (!isSqlite(b)) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return {
    counter: v.getUint32(24),
    pages: v.getUint32(28),
    cookie: v.getUint32(40),
    schema: v.getUint32(44),
    encoding: ({ 1: "UTF-8", 2: "UTF-16 little endian", 3: "UTF-16 big endian" } as Record<number, string>)[v.getUint32(56)] ?? "UTF-8",
    validFor: v.getUint32(92),
    version: v.getUint32(96),
  };
}

/** tEXt chunks of a PNG (keyword, text), in file order. */
export function pngText(b: Uint8Array): [string, string][] {
  if (!isPng(b)) return [];
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: [string, string][] = [];
  for (let i = 8; i + 8 <= b.length; ) {
    const len = v.getUint32(i);
    const type = latin1(b.subarray(i + 4, i + 8));
    if (type === "IDAT" || type === "IEND") break;
    if (type === "tEXt") {
      const data = latin1(b.subarray(i + 8, i + 8 + len));
      const nul = data.indexOf("\0");
      if (nul > 0) out.push([data.slice(0, nul), data.slice(nul + 1)]);
    }
    i += 12 + len;
  }
  return out;
}

export type JpegInfo = { width: number; height: number; components: number; progressive: boolean; jfif: string | null; exif: boolean };

export function jpegInfo(b: Uint8Array): JpegInfo | null {
  if (!isJpeg(b)) return null;
  let o = 2;
  let jfif: string | null = null;
  let exif = false;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) return null;
    const marker = b[o + 1];
    const len = (b[o + 2] << 8) | b[o + 3];
    if (marker === 0xe0 && utf8.decode(b.subarray(o + 4, o + 9)) === "JFIF\0") jfif = `${b[o + 11]}.${String(b[o + 12]).padStart(2, "0")}`;
    if (marker === 0xe1 && utf8.decode(b.subarray(o + 4, o + 10)) === "Exif\0\0") exif = true;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (b[o + 5] << 8) | b[o + 6], width: (b[o + 7] << 8) | b[o + 8], components: b[o + 9], progressive: marker === 0xc2, jfif, exif };
    }
    o += 2 + len;
  }
  return null;
}

export type PngInfo = { width: number; height: number; bitDepth: number; colorType: string; interlaced: boolean };

export function pngInfo(b: Uint8Array): PngInfo | null {
  if (!isPng(b) || b.length < 29) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const colorTypes: Record<number, string> = { 0: "grayscale", 2: "RGB", 3: "colormap", 4: "gray+alpha", 6: "RGBA" };
  return { width: v.getUint32(16), height: v.getUint32(20), bitDepth: b[24], colorType: colorTypes[b[25]] ?? "unknown", interlaced: b[28] === 1 };
}

export function pdfInfo(b: Uint8Array): { version: string; producer: string | null; creator: string | null } | null {
  if (!isPdf(b)) return null;
  const head = utf8.decode(b.subarray(0, 16));
  const latin = latin1(b);
  return {
    version: /%PDF-(\d\.\d)/.exec(head)?.[1] ?? "1.4",
    producer: /\/Producer\s*\(([^)]*)\)/.exec(latin)?.[1] ?? null,
    creator: /\/Creator\s*\(([^)]*)\)/.exec(latin)?.[1] ?? null,
  };
}

export function latin1(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
}

/** What `file` prints after "name: ". */
export function describe(name: string, b: Uint8Array): string {
  const j = jpegInfo(b);
  if (j) {
    const std = [j.jfif ? `JFIF standard ${j.jfif}` : null, j.exif ? "Exif standard: [TIFF image data]" : null].filter(Boolean).join(", ");
    return `JPEG image data${std ? `, ${std}` : ""}, ${j.progressive ? "progressive" : "baseline"}, precision 8, ${j.width}x${j.height}, components ${j.components}`;
  }
  const p = pngInfo(b);
  if (p) return `PNG image data, ${p.width} x ${p.height}, ${p.bitDepth}-bit/color ${p.colorType}, ${p.interlaced ? "interlaced" : "non-interlaced"}`;
  const pdf = pdfInfo(b);
  if (pdf) return `PDF document, version ${pdf.version}`;
  const db = sqliteInfo(b);
  if (db) {
    return `SQLite 3.x database, last written using SQLite version ${db.version}, file counter ${db.counter}, database pages ${db.pages}, cookie 0x${db.cookie.toString(16)}, schema ${db.schema}, ${db.encoding}, version-valid-for ${db.validFor}`;
  }
  if (b.length === 0) return "empty";
  if (isBinary(b)) return "data";
  const text = utf8.decode(b);
  const ascii = /^[\x00-\x7f]*$/.test(text);
  const enc = ascii ? "ASCII text" : "Unicode text, UTF-8 text";
  const crlf = text.includes("\r\n") ? ", with CRLF line terminators" : "";
  const long = text.split("\n").some((l) => l.length > 300) ? ", with very long lines" : "";
  if (/^\s*<svg[\s>]/.test(text) || /^\s*<\?xml[^>]*>\s*<svg/.test(text)) return "SVG Scalable Vector Graphics image";
  if (/^\s*[[{]/.test(text)) {
    try {
      JSON.parse(text);
      return "JSON text data";
    } catch {
      /* fall through */
    }
  }
  if (/\.csv$/i.test(name) && text.split("\n")[0].includes(",")) return `CSV ${enc}${long}${crlf}`;
  return `${enc}${long}${crlf}`;
}

export function hexdump(b: Uint8Array, opts: { start?: number; length?: number; style: "xxd" | "canonical" }): string {
  const start = Math.max(0, opts.start ?? 0);
  const end = Math.min(b.length, opts.length === undefined ? b.length : start + opts.length);
  const lines: string[] = [];
  const printable = (c: number) => (c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : ".");
  for (let o = start; o < end; o += 16) {
    const row = b.subarray(o, Math.min(o + 16, end));
    const hex = [...row].map((c) => c.toString(16).padStart(2, "0"));
    if (opts.style === "xxd") {
      const groups: string[] = [];
      for (let i = 0; i < 16; i += 2) groups.push((hex[i] ?? "  ") + (hex[i + 1] ?? "  "));
      lines.push(`${o.toString(16).padStart(8, "0")}: ${groups.join(" ")}  ${[...row].map(printable).join("")}`);
    } else {
      const left = hex.slice(0, 8).join(" ").padEnd(23);
      const right = hex.slice(8).join(" ").padEnd(23);
      lines.push(`${o.toString(16).padStart(8, "0")}  ${left}  ${right}  |${[...row].map(printable).join("")}|`);
    }
  }
  if (opts.style === "canonical") lines.push(end.toString(16).padStart(8, "0"));
  return lines.join("\n");
}

export function strings(b: Uint8Array, min = 4): string[] {
  const out: string[] = [];
  let cur = "";
  for (const c of b) {
    if (c >= 0x20 && c < 0x7f) cur += String.fromCharCode(c);
    else {
      if (cur.length >= min) out.push(cur);
      cur = "";
    }
  }
  if (cur.length >= min) out.push(cur);
  return out;
}

export async function digest(algo: "SHA-256" | "SHA-1", b: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest(algo, b.slice().buffer);
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** MD5 (RFC 1321). Web Crypto doesn't offer it, and investigators still reach for md5sum. */
export function md5(bytes: Uint8Array): string {
  const s = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  const len = bytes.length;
  const padded = new Uint8Array(((len + 72) >>> 6) << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  const bits = len * 8;
  const v = new DataView(padded.buffer);
  v.setUint32(padded.length - 8, bits >>> 0, true);
  v.setUint32(padded.length - 4, Math.floor(bits / 2 ** 32), true);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  for (let off = 0; off < padded.length; off += 64) {
    const M = Array.from({ length: 16 }, (_, i) => v.getUint32(off + i * 4, true));
    let [A, B, C, D] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) [F, g] = [(B & C) | (~B & D), i];
      else if (i < 32) [F, g] = [(D & B) | (~D & C), (5 * i + 1) % 16];
      else if (i < 48) [F, g] = [B ^ C ^ D, (3 * i + 5) % 16];
      else [F, g] = [C ^ (B | ~D), (7 * i) % 16];
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((F << s[i]) | (F >>> (32 - s[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }
  return [a0, b0, c0, d0].map((w) => [0, 8, 16, 24].map((sh) => ((w >>> sh) & 0xff).toString(16).padStart(2, "0")).join("")).join("");
}
