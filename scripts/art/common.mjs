// Shared SVG building blocks for the generated CASE 404 artwork.
// All artwork is original, stylized, and non-graphic.

/** The revamp palette (ink, oxblood, crimson, bone, stone). */
export const palette = {
  ink: "#100E11",
  oxblood: "#2C0001",
  crimson: "#490206",
  bone: "#C0B5B3",
  stone: "#706B68",
};

export function svg(width, height, body, extraDefs = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<defs>
${grainFilter()}
${extraDefs}
</defs>
${body}
</svg>`;
}

export function grainFilter(id = "grain", amount = 0.22) {
  return `<filter id="${id}" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" seed="7"/>
  <feColorMatrix type="saturate" values="0"/>
  <feComponentTransfer><feFuncA type="table" tableValues="0 ${amount}"/></feComponentTransfer>
</filter>`;
}

export function grainOverlay(w, h, id = "grain") {
  return `<rect width="${w}" height="${h}" filter="url(#${id})" style="mix-blend-mode:overlay"/>`;
}

export function vignette(w, h, id = "vig", strength = 0.75) {
  return `<radialGradient id="${id}" cx="50%" cy="48%" r="72%">
    <stop offset="55%" stop-color="#000" stop-opacity="0"/>
    <stop offset="100%" stop-color="#000" stop-opacity="${strength}"/>
  </radialGradient>`;
}

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A stylized head-and-shoulders figure drawn in a 600×800 box.
 * Options pick skin, hair, and costume layers so all portraits share one framing and light.
 */
export function bust(o) {
  const skin = o.skin;
  const skinShade = o.skinShade;
  const back = o.back ?? ""; // layers behind the body (wings, collars, capes)
  const torso = o.torso; // clothing fill for the shoulders
  const hairBack = o.hairBack ?? "";
  const hairFront = o.hairFront ?? "";
  const face = o.face ?? defaultFace(o);
  const overHead = o.overHead ?? ""; // halos, hats, goggles
  const front = o.front ?? ""; // props in front of the body
  return `
  <g>
    ${back}
    ${hairBack}
    <!-- neck -->
    <path d="M262 470 L262 560 Q300 590 338 560 L338 470 Z" fill="${skin}"/>
    <path d="M262 500 Q300 540 338 500 L338 470 L262 470 Z" fill="${skinShade}" opacity="0.55"/>
    <!-- shoulders and torso -->
    <path d="M70 800 Q78 640 170 590 Q228 560 262 548 Q300 600 338 548 Q372 560 430 590 Q522 640 530 800 Z" fill="${torso}"/>
    ${o.torsoDetail ?? ""}
    <!-- head -->
    <ellipse cx="300" cy="372" rx="102" ry="128" fill="${skin}"/>
    <path d="M300 244 Q402 250 402 372 Q402 470 330 496 Q372 430 360 360 Q350 290 300 244 Z" fill="${skinShade}" opacity="0.35"/>
    <ellipse cx="198" cy="388" rx="14" ry="26" fill="${skin}"/>
    <ellipse cx="402" cy="388" rx="14" ry="26" fill="${skinShade}"/>
    ${face}
    ${hairFront}
    ${overHead}
    ${front}
  </g>`;
}

export function defaultFace(o) {
  const brow = o.brow ?? "#2a1d18";
  const lips = o.lips ?? "#9c4a4a";
  return `
    <path d="M232 340 Q252 330 272 338" stroke="${brow}" stroke-width="6" fill="none" stroke-linecap="round"/>
    <path d="M328 338 Q348 330 368 340" stroke="${brow}" stroke-width="6" fill="none" stroke-linecap="round"/>
    <ellipse cx="253" cy="368" rx="13" ry="8" fill="#1d1418"/>
    <ellipse cx="347" cy="368" rx="13" ry="8" fill="#1d1418"/>
    <circle cx="257" cy="366" r="3" fill="#fff" opacity="0.8"/>
    <circle cx="351" cy="366" r="3" fill="#fff" opacity="0.8"/>
    <path d="M300 372 Q292 410 300 424 Q308 426 314 420" stroke="${o.skinShade}" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M272 452 Q300 ${o.smile ? 470 : 460} 328 452" stroke="${lips}" stroke-width="7" fill="none" stroke-linecap="round"/>
    ${o.faceExtra ?? ""}`;
}

/** Background shared by every portrait so lighting and framing are comparable. */
export function portraitBackground() {
  return `
  <rect width="600" height="800" fill="${palette.ink}"/>
  <rect width="600" height="800" fill="url(#pbg)"/>
  <ellipse cx="300" cy="420" rx="300" ry="360" fill="url(#prim)" opacity="0.55"/>
  <path d="M0 640 Q300 600 600 640 L600 800 L0 800 Z" fill="#000" opacity="0.25"/>`;
}

/** Every portrait gets the same oxblood backdrop and crimson rim light, so none of them stands out. */
const RIM = "#6a0a12";

export function portraitDefs() {
  const rim = RIM;
  return `
  <radialGradient id="pbg" cx="30%" cy="22%" r="85%">
    <stop offset="0%" stop-color="#3a0a10"/>
    <stop offset="60%" stop-color="#1a0b0e"/>
    <stop offset="100%" stop-color="${palette.ink}"/>
  </radialGradient>
  <radialGradient id="prim" cx="50%" cy="45%" r="50%">
    <stop offset="0%" stop-color="${rim}" stop-opacity="0.55"/>
    <stop offset="100%" stop-color="${rim}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="keylight" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#e6dedc" stop-opacity="0.2"/>
    <stop offset="55%" stop-color="#e6dedc" stop-opacity="0"/>
  </linearGradient>
  ${vignette(600, 800, "pvig", 0.7)}`;
}

export function portrait(_rim, figure) {
  return svg(
    600,
    800,
    `${portraitBackground()}
    ${figure}
    <rect width="600" height="800" fill="url(#keylight)"/>
    <rect width="600" height="800" fill="url(#pvig)"/>
    ${grainOverlay(600, 800)}`,
    portraitDefs(),
  );
}
