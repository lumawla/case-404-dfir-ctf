// Renders the official venue map SVG (evidence file) from content/public/venue.json.
import { esc } from "../art/common.mjs";

export function venueMapSvg(venue) {
  const W = 1040;
  const H = 850;
  const rooms = venue.floors
    .map((floor) => {
      const f = floor.frame;
      const roomEls = floor.rooms
        .map(
          (r) => `
      <g>
        <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="4" fill="${r.id === "projection" ? "#3a2230" : "#211d2a"}" stroke="#C6A36A" stroke-width="1.5"/>
        <text x="${r.x + r.w / 2}" y="${r.y + r.h / 2 - (r.sub ? 4 : -5)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${r.w < 100 ? 12 : 15}" font-weight="700" fill="#F7F3EE">${esc(r.label)}</text>
        ${r.sub ? `<text x="${r.x + r.w / 2}" y="${r.y + r.h / 2 + 14}" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#c9bfd6">${esc(r.sub)}</text>` : ""}
      </g>`,
        )
        .join("");
      const doors = floor.doors.map((d) => `<circle cx="${d.x}" cy="${d.y}" r="5" fill="#C6A36A"/>`).join("");
      return `
    <g>
      <rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="8" fill="#15131B" stroke="#554668" stroke-width="2"/>
      <text x="${f.x + 12}" y="${f.y - 12}" font-family="Georgia, serif" font-size="20" fill="#C6A36A">${esc(floor.label)}</text>
      ${roomEls}
      ${doors}
    </g>`;
    })
    .join("");
  const rows = venue.routes
    .map(
      (r, i) => `<text x="40" y="${560 + i * 26}" font-family="Arial, sans-serif" font-size="15" fill="#F7F3EE"><tspan font-weight="700">${r.minutes} min</tspan>  ${esc(r.path)}</text>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
<title id="t">${esc(venue.title)}</title>
<desc id="d">${esc(venue.note)} ${venue.routes.map((r) => `${r.path}: at least ${r.minutes} minutes.`).join(" ")}</desc>
<rect width="${W}" height="${H}" fill="#0f0d14"/>
<text x="20" y="30" font-family="Georgia, serif" font-size="22" fill="#F4EBDD">${esc(venue.title)}</text>
<g transform="translate(0 30)">
${rooms}
<path d="M460 436 C500 520 920 520 960 436" stroke="#C6A36A" stroke-width="2" stroke-dasharray="6 6" fill="none"/>
<text x="710" y="522" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#c9bfd6">east stairs connect the two floors</text>
<text x="20" y="535" font-family="Georgia, serif" font-size="18" fill="#C6A36A">Minimum walking times (fast pace, normal routes)</text>
${rows}
</g>
${venue.note
    .split(/(?<=\.) /)
    .map((line, i) => `<text x="20" y="${770 + i * 20}" font-family="Arial, sans-serif" font-size="13" fill="#a79fb3">${esc(line)}</text>`)
    .join("")}
</svg>
`;
}
