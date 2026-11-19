import { grainOverlay, svg, vignette } from "./common.mjs";

/** COVER_HALL — atmospheric Halloween party in an ordinary university hall. No supernatural creatures. */
export function coverHall() {
  const W = 1600;
  const H = 900;
  const xs = [180, 520, 860, 1200];
  const arch = (x) => `M${x} 560 L${x} 260 Q${x + 110} 120 ${x + 220} 260 L${x + 220} 560 Z`;
  const windows = `
    ${xs.map((x) => `<path d="${arch(x)}" fill="url(#win)"/>`).join("")}
    <clipPath id="moonclip"><path d="${arch(1200)}"/></clipPath>
    <circle cx="1268" cy="300" r="56" fill="#C0B5B3" opacity="0.85" clip-path="url(#moonclip)"/>
    ${xs
      .map(
        (x) => `<path d="M${x + 110} 160 L${x + 110} 560 M${x} 380 L${x + 220} 380" stroke="#0b090c" stroke-width="10"/>
      <path d="${arch(x)}" fill="none" stroke="#0b090c" stroke-width="14"/>`,
      )
      .join("")}`;
  const lights = Array.from({ length: 40 }, (_, i) => {
    const x = 20 + i * 40;
    const y = 120 + Math.sin(i / 3) * 26 + (i % 2) * 6;
    return `<circle cx="${x}" cy="${y}" r="5" fill="#d9a6aa"/><circle cx="${x}" cy="${y}" r="16" fill="#d65c64" opacity="0.14"/>`;
  }).join("");
  const dancers = [
    [140, 0.9, "hat"], [300, 1.05, "wings"], [470, 0.95, "ears"], [640, 1.1, ""], [820, 1.0, ""], [980, 1.08, ""],
    [1150, 0.92, "hat"], [1310, 1.04, "cape"], [1470, 0.96, ""],
  ]
    .map(([x, s, kind]) => {
      const y = 900;
      const head = `<circle cx="0" cy="-250" r="34"/>`;
      const body = `<path d="M-60 0 Q-58 -160 -30 -205 Q0 -222 30 -205 Q58 -160 60 0 Z"/>`;
      const arm = (x % 3 === 0) ? `<path d="M30 -190 Q80 -260 70 -320" stroke="#07060a" stroke-width="18" fill="none" stroke-linecap="round"/>` : "";
      let extra = "";
      if (kind === "hat") extra = `<path d="M-46 -268 L46 -268 L0 -360 Z"/>`;
      if (kind === "ears") extra = `<path d="M-30 -270 L-24 -306 L-8 -282 Z M30 -270 L24 -306 L8 -282 Z"/>`;
      if (kind === "wings") extra = `<path d="M-20 -200 Q-120 -280 -110 -150 Q-70 -170 -30 -150 Z M20 -200 Q120 -280 110 -150 Q70 -170 30 -150 Z" opacity="0.9"/><ellipse cx="0" cy="-300" rx="30" ry="7" fill="none" stroke="#07060a" stroke-width="5"/>`;
      if (kind === "cape") extra = `<path d="M-40 -215 L-90 0 L90 0 L40 -215 Z"/><path d="M-36 -236 L-50 -280 L-10 -240 Z M36 -236 L50 -280 L10 -240 Z"/>`;
      return `<g transform="translate(${x} ${y}) scale(${s})" fill="#07060a">${extra}${head}${body}${arm}</g>`;
    })
    .join("");
  return svg(
    W,
    H,
    `<rect width="${W}" height="${H}" fill="#100E11"/>
    <rect width="${W}" height="${H}" fill="url(#hallglow)"/>
    ${windows}
    <path d="M0 0 L${W} 0 L${W} 70 Q800 140 0 70 Z" fill="#0b090c"/>
    ${lights}
    <ellipse cx="800" cy="900" rx="900" ry="240" fill="url(#floorglow)"/>
    ${dancers}
    <rect width="${W}" height="${H}" fill="url(#cvig)"/>
    ${grainOverlay(W, H)}`,
    `<radialGradient id="hallglow" cx="50%" cy="70%" r="80%">
      <stop offset="0" stop-color="#490206" stop-opacity="0.8"/><stop offset="1" stop-color="#100E11" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="win" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a0a10"/><stop offset="1" stop-color="#1a0508"/>
    </linearGradient>
    <radialGradient id="floorglow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#C0B5B3" stop-opacity="0.22"/><stop offset="1" stop-color="#C0B5B3" stop-opacity="0"/>
    </radialGradient>
    ${vignette(W, H, "cvig", 0.85)}`,
  );
}

/** RESULT_SOLVED — closed dossier with the last photograph clipped to it (no suspect-specific motif). */
export function resultSolved() {
  return svg(
    800,
    500,
    `<rect width="800" height="500" fill="#100E11"/>
    <rect width="800" height="500" fill="url(#rsglow)"/>
    <g transform="rotate(6 560 150)">
      <rect x="470" y="70" width="170" height="190" rx="4" fill="#C0B5B3"/>
      <rect x="484" y="84" width="142" height="130" fill="#100E11"/>
      <circle cx="555" cy="149" r="26" fill="none" stroke="#706B68" stroke-width="4" opacity="0.8"/>
      <rect x="532" y="60" width="46" height="22" rx="3" fill="#706B68"/>
    </g>
    <path d="M180 170 L360 170 L390 200 L620 200 L620 430 L180 430 Z" fill="#2C0001"/>
    <path d="M170 210 L630 210 L610 440 L190 440 Z" fill="#490206"/>
    <text x="400" y="300" text-anchor="middle" font-family="Georgia, serif" font-size="34" letter-spacing="6" fill="#C0B5B3">CASE 404</text>
    <g transform="rotate(-8 400 360)">
      <rect x="290" y="330" width="220" height="64" rx="6" fill="none" stroke="#e6dedc" stroke-width="6"/>
      <text x="400" y="374" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="32" letter-spacing="6" fill="#e6dedc">CLOSED</text>
    </g>
    ${grainOverlay(800, 500)}`,
    `<radialGradient id="rsglow" cx="50%" cy="60%" r="60%"><stop offset="0" stop-color="#490206" stop-opacity="0.45"/><stop offset="1" stop-color="#100E11" stop-opacity="0"/></radialGradient>`,
  );
}

/** RESULT_UNSOLVED — sealed, unresolved case file. */
export function resultUnsolved() {
  return svg(
    800,
    500,
    `<rect width="800" height="500" fill="#100E11"/>
    <path d="M180 170 L360 170 L390 200 L620 200 L620 430 L180 430 Z" fill="#1d1215"/>
    <path d="M170 210 L630 210 L610 440 L190 440 Z" fill="#2C0001"/>
    <text x="400" y="290" text-anchor="middle" font-family="Georgia, serif" font-size="34" letter-spacing="6" fill="#C0B5B3">CASE 404</text>
    <circle cx="400" cy="360" r="42" fill="#490206"/>
    <circle cx="400" cy="360" r="30" fill="none" stroke="#706B68" stroke-width="5"/>
    <text x="400" y="368" text-anchor="middle" font-family="Georgia, serif" font-size="22" fill="#C0B5B3">?</text>
    <text x="400" y="460" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="20" letter-spacing="8" fill="#9C9491">UNRESOLVED</text>
    ${grainOverlay(800, 500)}`,
  );
}
