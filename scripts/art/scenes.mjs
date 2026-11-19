import { esc, svg } from "./common.mjs";

/** EV03 — the leaked, cropped screenshot as it was forwarded to staff. */
export function leakedChat() {
  const W = 760;
  const H = 520;
  return svg(
    W,
    H,
    `<rect width="${W}" height="${H}" fill="#0f1115"/>
    <rect x="0" y="0" width="${W}" height="96" fill="#b5454d"/>
    <text x="30" y="44" font-family="Arial, sans-serif" font-weight="800" font-size="26" fill="#fff">LUCIEN THREATENED NADIA.</text>
    <text x="30" y="78" font-family="Arial, sans-serif" font-weight="800" font-size="26" fill="#fff">HE WAS HIDING THE PHOTOS.</text>
    <path d="M${W - 230} 96 L${W - 40} 96 Q${W - 24} 96 ${W - 24} 104 L${W - 24} 118 L${W - 230} 118 Z" fill="#2563a8" opacity="0.9"/>
    <text x="40" y="190" font-family="Arial, sans-serif" font-size="20" fill="#9aa3b2">Lucien M.</text>
    <rect x="34" y="204" width="560" height="120" rx="22" fill="#262a33"/>
    <text x="62" y="252" font-family="Arial, sans-serif" font-size="27" fill="#eef1f6">Delete them before anyone sees.</text>
    <text x="62" y="292" font-family="Arial, sans-serif" font-size="27" fill="#eef1f6">I can't explain it.</text>
    <text x="580" y="314" text-anchor="end" font-family="Arial, sans-serif" font-size="17" fill="#8a93a3">23:41</text>
    <path d="M${W - 470} ${H - 22} L${W - 470} ${H} M${W - 470} ${H - 22} Q${W - 470} ${H - 40} ${W - 450} ${H - 40} L${W - 44} ${H - 40} Q${W - 24} ${H - 40} ${W - 24} ${H - 22} L${W - 24} ${H}" fill="#2563a8" stroke="none"/>
    <rect x="${W - 470}" y="${H - 40}" width="446" height="40" rx="18" fill="#2563a8"/>
    <rect x="${W - 470}" y="${H - 20}" width="446" height="20" fill="#2563a8"/>`,
  );
}

/** EV06 — fictional vendor invoice rendered to PDF (also shown as an in-app transcript). */
export function invoiceHtml(transcript) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: Georgia, serif; color: #1f1a17; margin: 48px; }
    h1 { font-size: 28px; margin: 0; letter-spacing: 4px; }
    .muted { color: #6b625a; font-size: 13px; }
    pre { font-family: "Courier New", monospace; font-size: 13px; line-height: 1.5; white-space: pre-wrap; border-top: 2px solid #1f1a17; padding-top: 16px; }
    .stamp { display: inline-block; border: 3px solid #2C805E; color: #2C805E; padding: 4px 14px; font-weight: 700; transform: rotate(-4deg); margin-top: 8px; }
  </style></head><body>
  <h1>BLACK CAT AV</h1>
  <div class="muted">Sound · Light · Projection — fictional vendor created for CASE 404</div>
  <pre>${esc(transcript)}</pre>
  <div class="stamp">PAID 2026-10-26</div>
  </body></html>`;
}
