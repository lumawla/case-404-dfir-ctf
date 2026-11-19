# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/case-404/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** CASE 404 — The Last Photograph (revamp)
**Generated with:** UI UX Pro Max skill v2.15.0 (`--domain typography|google-fonts|color|style|ux`, `--stack react`), synthesized with the organizers' palette
**Category:** Hack The Box–style CTF workspace with a gothic murder-mystery skin (dark, cinematic, not graphic horror)
**Design dials:** Variance 4/10 (calm, centred) · Motion 3/10 (one celebratory moment, otherwise subtle) · Density 7/10 (workspace)
**Implemented in:** `apps/web/src/styles/tokens.css` (single source of truth for tokens)

### How the skill output was used

| Skill query | Result | Decision |
|---|---|---|
| `"gothic blackletter medieval" --domain typography` | Art Deco pairings | Rejected (off-target); retried with font names per the skill's retry rule |
| `"UnifrakturMaguntia fraktur" --domain google-fonts` | UnifrakturMaguntia (display, OFL) | **Title font**: display sizes only |
| `"dark academia gothic serif" --domain typography` | Crimson Pro in the editorial pairings | **Body font**: a book serif that reads well at 18px and suits blackletter |
| `"terminal monospace hacker cyberpunk" --domain style` | Cyberpunk UI (neon, scanlines, monospace) | Took the terminal conventions and the faint scanline; rejected neon and glitch (palette and mood) |
| `"dark mode contrast text"`, `"keyboard focus visible"` `--domain ux` | 4.5:1 text, visible focus everywhere | Contrast measured per token; 2px focus ring in a light crimson |

---

## Palette

The organizers supplied five colours. Everything else is a tint or shade of them.

| Role | Hex | Token | Notes |
|------|-----|-------|-------|
| Ink (page) | `#100E11` | `--ink`, `--bg` | |
| Oxblood | `#2C0001` | `--oxblood` | Owned/selected backgrounds (as `--danger-bg`) |
| Crimson | `#490206` | `--crimson`, `--primary` | Primary buttons (bone text 8.1:1), rules, match highlight |
| Bone | `#C0B5B3` | `--bone`, `--text` | Body text, 9.6:1 on ink |
| Stone | `#706B68` | `--stone` | Borders, placeholders, large text only (3.7:1) |
| Pale bone | `#E6DEDC` | `--text-strong` | Headings, values |
| Ash | `#9C9491` | `--text-muted` | Secondary text, 6.5:1 |
| Blood | `#D65C64` | `--accent` | Links, icons, prompt, directories, focus family, 5.1:1 |
| Surfaces | `#160F12` / `#1D1215` / `#0B090C` | `--surface`, `--surface-2`, `--surface-sunken` | Ink lifted toward oxblood |

**Rules:** body text ≥ 4.5:1. Colour is never the only signal: owned challenges have an "Owned" stamp and screen-reader text, difficulty has pips **and** a word, errors have words. Raw hex values are not used in components (art excepted).

## Typography

- **Titles:** UnifrakturMaguntia, 400. Only at ≥ 1.4rem: page titles, the logo, "Challenges", "Caesar Lab", the "Owned" stamp and overlay. Never running text, buttons or labels. Keep titles to a few words; blackletter sentences are hard to read.
- **Body / UI:** Crimson Pro Variable, 18px base, line height 1.55, weight 420 (600–650 for emphasis). Lining numerals.
- **Terminal, labels, data:** JetBrains Mono. Uppercase mono with letter spacing for small labels (category, eyebrow, progress).
- Self-hosted via `@fontsource` (no external font requests on venue Wi-Fi). Text scale 18 / 20 / 22px from Settings.

## Layout

- **Workspace (≥ 1001px):** top bar (logo, Workspace / Case file / Accuse / Scores, points, timer, team, settings) · challenge board column 320–400px, grouped by act · tools panel with tabs Terminal / Caesar Lab / Timeline / Cheat sheet / Notes. The terminal has an optional file tree.
- **≤ 1000px:** one segmented switch, a 3×2 grid (Challenges / Terminal / Caesar / Timeline / Cheat sheet / Notes), picks what fills the screen; the top nav wraps to a full-width row. No horizontal page scroll.
- **Practice room:** the same workspace layout with tasks on the left and Terminal / Caesar Lab / Cheat sheet on the right; the top bar says "Unscored · clock not running".
- Touch targets ≥ 44px for primary controls.

## Components

- **Challenge card:** category badge, difficulty pips + word, title, points, solves, first-blood team. Expands in place to the description, the flag format and the flag field. Owned cards get a crimson left rule and a tilted blackletter "Owned" stamp.
- **Act group:** mono "ACT II" eyebrow in blood + the act title in pale bone, a collapsible "Briefing", then its cards. A sealed act shows "Sealed", its unlock rule with a lock icon, and dashed, sunken cards with only category, difficulty and points.
- **Act dialog:** when an act opens, a standard dialog with the act's title and briefing, shown once per device and only after the Owned overlay is gone. The terminal prints a "[DER] New evidence mounted" notice listing the folders that received files.
- **Timeline:** day headings in mono blood; each entry a time column and text on a crimson left rule, with its source ("From “Moth”"). Struck entries use `<del>` and a grey rule.
- **Cheat sheet:** sections per task, command in mono blood, examples as small code chips with a muted explanation; a search box filters by command or task.
- **Owned overlay:** the HTB "pwned" moment. Full screen, blackletter "Owned", challenge title, points, "First blood" badge when earned. Dismisses on click, Enter, Escape or after ~3 s; focus returns to where it was.
- **Terminal:** prompt `investigator@der-forensics:~/case404$` (user in blood, path in pale bone), directories in bold blood, media files in a pale rose, grep matches on crimson, errors in a lighter blood. Faint scanlines only.
- **Caesar Lab:** input, shift dial (−/+, slider, number), direction, an in/out alphabet strip, output. Starts empty; no brute-force table.

## Motion

140ms press/hover, 240ms panels and toasts, a short stamp-in for the Owned overlay, a shake on a wrong flag. Only transform/opacity animate. `prefers-reduced-motion` and the in-app "Reduce motion" setting remove all of it.

## Accessibility (non-negotiable)

1. Skip link first on every page.
2. Visible focus ring on everything.
3. Dialogs, drawers, the lightbox and the Owned overlay take focus and give it back.
4. One polite live region announces teammates' solves and organizer announcements; focus never moves for them.
5. Countdown is `role="timer"` with `aria-live="off"`; milestones and an on-demand button announce time.
6. The terminal output is a `role="log"`; the input has a label; everything in it is text, so screen readers read it.
7. Sound is optional, off by default, and never carries information.

## Anti-patterns (avoid)

- Visual spoilers: no suspect gets special lighting, colour or placement. All portraits share one oxblood backdrop and rim light. The one exception is story-driven: Lucien has no portrait ("No photo on file. Camera shy."), shown as a striped empty frame with a camera-off icon.
- Neon, glitch effects, jump scares, flashing, gore.
- Guidance in the UI: no hint buttons, no "try this tool", no file descriptions, no brute-force views.
- Blackletter below display size.

## Pre-delivery checklist

- [x] No emojis as icons (Lucide only)
- [x] Contrast measured per token
- [x] Focus visible; keyboard path through every task
- [x] `prefers-reduced-motion` respected
- [x] Responsive at 412px and 1440px (screenshots and the e2e mobile project)
- [x] Image dimensions declared; route-level code splitting
