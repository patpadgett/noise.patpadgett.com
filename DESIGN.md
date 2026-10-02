# DESIGN.md — CUE

<!-- impeccable:design-schema 1 · surface: index.html · mode: Operate · direction seed 162a59d2 (#5 "The Gallery") -->

## World

Your song goes on air. The interface is a television gallery: a monitor wall above, a clock strip, and the running order on paper under the desk lamp. Everything the visitor reads is anchored to a musical fact the app found (bar, drop, chorus start, the word a line lands on) and written as a sentence a director would call. Lineage: broadcast gallery, vision mixer, rundown printout. Refused: the dark AI video editor (preview centre, timeline strip, prompt box, purple Generate) and the pitch-deck of pretty stills.

## Colour

| Token | Value | Use |
|---|---|---|
| `--wall` | `#1c1f24` | page ground (the gallery wall) |
| `--desk` | `#2a2e35` | desk header, clock strip, monitor tally/caption strips, footer, dialogs |
| `--desk-hi` | `#343943` | raised keys, toast |
| `--seam` | `#0e1013` | 1px seams between panels, inputs, progress troughs |
| `--paper` / `--paper-rule` | `#f4f1ea` / `#d9d3c4` | the running order and its rules |
| `--ink` / `--ink-2` | `#141414` / `#5a564d` | text on paper; secondary text on paper |
| `--chalk` / `--chalk-2` / `--chalk-3` | `#e9e6df` / `#a9adb6` / `#6b7079` | text on the wall: primary, secondary, idle dots and hairlines |
| `--red` | `#e3262b` | **on air now**, nothing else: PGM outline + dot while playing, the on-air rows' dots and 1px left edge |
| `--green` | `#22b35a` | **next**, nothing else: the first PVW outline + dot, the next row's dot |
| `--amber` | `#f0b429` | timecode, NEXT CUE count, RENDER key, LOAD progress, warnings and failed states (attention without being on air) |

Three saturated colours in the interface, each with one meaning. Picture inside a monitor (colour bars in NO SOURCE, generated footage, light cues) is content and exempt.

## Type

Two sizes. Clock values (TC, BAR, NEXT CUE, SECTION, the CUE wordmark, the drop prompt) in **Barlow Condensed 700** at `--fs-clock` (34px desktop, 28px mobile), tabular numerals. Everything else **Archivo** (variable) at 14px. Rank is weight (700/600/500), case (labels and headings are letterspaced caps at .12em; sentences are sentence case) and tally colour. No third size anywhere: section headings on the paper are 14px 700 caps with a 1px ink rule; `RUNNING ORDER` is the same.

Fonts self-hosted in `assets/fonts/` (`barlow-condensed-normal-{500,700}.woff2`, `archivo-var.woff2`, OFL).

## Surfaces and components

- **Monitor** (`.mon`): tally strip (28px, `--desk`, dot + PGM/PVW + label), screen (`#000`, `aspect-ratio` 16/9 or 9/16 from `--mon-ratio`), caption strip (28px). 1px `--chalk-3` outline that turns red (on air) or green (next). Instant: no transition on a tally. The PGM is the one large monitor; the four PVWs are identical to each other.
- **Slate** (drawn on canvas when a scene has no footage): scene number at 19% of frame height, the cue sentence, an amber FOOTAGE PENDING line; the treatment palette as a tonal ground. Never prompt text.
- **Clock strip** (`.clock`): PLAY key (becomes a red ON AIR key while playing), TC `mm:ss.d`, BAR `bbb.b`, NEXT CUE as a beat count ticking on the grid (`−12`, `−3 BARS`, `GO`), SECTION name, NO STROBE switch, RENDER key with the dollar figure.
- **Keys** (`.key`): 40px (44px in the desk header), 3px radius, 1px outline, caps at .08em; `--hot` is amber with ink text (one per view); `--ghost` is outline only. No hover transitions.
- **Running order** (`.ro`): a real table on paper. Columns # / IN (time + bar) / CUE (editable sentence + anchor line) / SRC chip (VT = footage, filled; LX = lighting, outlined; a small RETAKE key under VT once a render desk is open) / DUR (seconds + bars as numbers) / tally dot. Section divider rows span the table. On-air row: white, red dot, 1px red left edge, red number. Click a row to seek.
- **Render desk** (`.renderdesk`): one job tile per scene (thumbnail, SCENE nn, state, seconds, 3px progress bar, and once done or failed a RETAKE · $ key that renders that scene alone), format segmented control, STOP / EXPORT. The FOOTAGE line carries the whole failure reason; tiles never truncate one.
- **Words & direction** (`.lyrics`): the lyrics textarea and one DIRECTION line (place, time of day, look) on paper; shown after LOAD and on the WORDS & DIRECTION key. Lyrics are read, never shown on the picture.
- **Segmented control** (`.fmt`): 40px cells inside one 1px outline; the selected cell is chalk with ink text.
- **Toast**: bottom right, 1px outline, no motion, hidden the moment the song plays.

## Layout

1440: `.wall` is `2fr 1fr` (PGM left, PVW 2×2 right filling the PGM's height); clock strip; running order; render desk when open. 22px horizontal padding, 1px `--seam` gaps between sections. ≤1100: wall stacks, PVWs become a strip of four. ≤760: 14px padding, clock strip wraps (SECTION on its own row, NO STROBE + RENDER on the last), PVW strip shows the scene number above and IN time below each tile, running order rows become a 3-column grid (number, content, dot).

## Motion

Cuts are instant. The countdown ticks on the beat. Nothing in the interface eases except the LOAD progress bar (`width .25s linear`). The authored picture (strobes, pulses, washes) is video, not interface motion: it is drawn by `js/switcher.js` from the beat grid. No text is ever drawn over the picture (owner decision: lyrics are read for the treatment, never shown). `prefers-reduced-motion` holds each light cue at a steady level on the live monitor (the export is unchanged); NO STROBE turns strobes into pulses and caps every repeating effect below 3 Hz.

## Copy

Director's voice: plain, confident, present tense, calling cues. Labels are caps nouns (PGM, PVW, TC, BAR, NEXT CUE, SECTION, RENDER). The treatment's cue sentences are the model's; they are editable in place. Costs are stated in dollars before any spend. No AI hype on the page; the footer states plainly what is sent to Azure.

## Provenance

- `assets/demo/fare-thee-honey-blues-1920.mp3`: Mamie Smith & Her Jazz Hounds, Okeh 4194 (1920), public domain.
- `assets/demo/cues.json`: generated by `tools/build-demo-cues.mjs` (Azure Speech fast transcription + gpt-6-astra on the owner's Foundry resource) with the demo's own DIRECTION line, 2026-10-01.
- `favicon.svg`: authored (a monitor with a tally dot).
- Fonts: Barlow Condensed (Jeremy Tribby, OFL), Archivo (Omnibus-Type, OFL).
