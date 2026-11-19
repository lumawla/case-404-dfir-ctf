/** Flag format rules (brief §15, §35). */
export const FLAG_PATTERN = /^FLAG\{[A-Z0-9_]+\}$/;

/** Trims outer whitespace and normalizes ASCII case only. Never rewrites the meaningful answer. */
export function normalizeFlag(raw: string): string {
  return raw.trim().replace(/[a-z]/g, (c) => c.toUpperCase());
}

export function isWellFormedFlag(normalized: string): boolean {
  return FLAG_PATTERN.test(normalized);
}
