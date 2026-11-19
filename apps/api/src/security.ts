import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "c404_sid";
export const ADMIN_COOKIE = "c404_admin";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I

export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export const keyedHash = (secret: string, value: string) => createHmac("sha256", secret).update(value).digest("hex");

export const newToken = () => randomBytes(32).toString("base64url");

export const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString("base64url")}`;

/** 12 characters from a 32-symbol alphabet (60 bits), shown as XXXX-XXXX-XXXX. */
export function newJoinCode(): string {
  let raw = "";
  for (let i = 0; i < 12; i++) raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

export function normalizeJoinCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function safeEqual(a: string, b: string): boolean {
  const ha = Buffer.from(sha256(a));
  const hb = Buffer.from(sha256(b));
  return timingSafeEqual(ha, hb);
}

/** Small in-memory fixed-window limiter for join/login attempts (single-process deployment). */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  hit(key: string, limit: number, windowMs: number, nowMs: number): { ok: boolean; retryAfterSeconds: number } {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= nowMs) {
      this.hits.set(key, { count: 1, resetAt: nowMs + windowMs });
      if (this.hits.size > 10_000) this.prune(nowMs);
      return { ok: true, retryAfterSeconds: 0 };
    }
    entry.count++;
    if (entry.count > limit) return { ok: false, retryAfterSeconds: Math.ceil((entry.resetAt - nowMs) / 1000) };
    return { ok: true, retryAfterSeconds: 0 };
  }

  private prune(nowMs: number) {
    for (const [key, entry] of this.hits) if (entry.resetAt <= nowMs) this.hits.delete(key);
  }
}

/** Display names: trimmed, single-spaced, printable, bounded length. */
export function cleanName(input: unknown, min: number, max: number): string | null {
  if (typeof input !== "string") return null;
  const value = input.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (value.length < min || value.length > max) return null;
  return value;
}
