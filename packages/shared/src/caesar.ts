/**
 * Caesar shift used by the in-game Caesar Lab.
 * Letters A–Z / a–z wrap around and keep their case; every other character is preserved.
 * `decode = true` shifts backward by `shift`.
 */
export function caesar(input: string, shift: number, decode = true): string {
  const k = (((decode ? -shift : shift) % 26) + 26) % 26;
  return [...input]
    .map((ch) => {
      const code = ch.charCodeAt(0);
      const base = code >= 65 && code <= 90 ? 65 : code >= 97 && code <= 122 ? 97 : null;
      if (base === null) return ch;
      return String.fromCharCode(base + ((code - base + k) % 26));
    })
    .join("");
}
