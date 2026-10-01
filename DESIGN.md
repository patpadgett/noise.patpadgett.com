---
name: NOISE — Chop Shop & Rex Deck
description: A one-screen browser phonk converter whose result is two neon rack devices on a Countach dash under a synthwave sun.
colors:
  night: '#0a0514'
  panel: 'rgba(16, 9, 34, .78)'
  device: '#1a0f33'
  device-deep: '#0e0820'
  lcd: '#05030c'
  line: 'rgba(219, 226, 244, .14)'
  white: '#f4f1ff'
  dim: 'rgba(244, 241, 255, .72)'
  lavender: '#b8b0d0'
  chrome-hi: '#ffffff'
  chrome: '#dbe2f4'
  chrome-lo: '#4a5270'
  pad-hi: '#f6f8ff'
  pad: '#d4dbec'
  pad-lo: '#6b7593'
  ink: '#0a0514'
  mag: '#ff2bd6'
  mag-deep: '#a5127f'
  cyan: '#19e6ff'
  cyan-deep: '#0d7f93'
  sun-a: '#ffd166'
  sun-b: '#ff7a3d'
typography:
  wordmark:
    fontFamily: 'Audiowide, "Arial Black", Impact, sans-serif'
    fontSize: clamp(64px, 12vw, 120px)
    letterSpacing: .04em
    lineHeight: 1
  device-name:
    fontFamily: 'Audiowide, "Arial Black", Impact, sans-serif'
    fontSize: 18px
    letterSpacing: .08em
  now-title:
    fontFamily: 'Audiowide, "Arial Black", Impact, sans-serif'
    fontSize: clamp(16px, 2.4vw, 20px)
    lineHeight: 1.2
  lcd-main:
    fontFamily: 'Audiowide, "Arial Black", Impact, sans-serif'
    fontSize: 15px
    letterSpacing: .06em
  lcd-sub:
    fontFamily: 'Michroma, "Arial Narrow", sans-serif'
    fontSize: 11px
    letterSpacing: .08em
  label:
    fontFamily: 'Michroma, "Arial Narrow", sans-serif'
    fontSize: 11px
    letterSpacing: .14em
  button:
    fontFamily: 'Michroma, "Arial Narrow", sans-serif'
    fontSize: 12px
    letterSpacing: .12em
  body:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: 15px
    lineHeight: 1.5
  pad-number:
    fontFamily: 'Audiowide, "Arial Black", Impact, sans-serif'
    fontSize: 12px
  pad-origin:
    fontFamily: 'Michroma, "Arial Narrow", sans-serif'
    fontSize: 11px
rounded:
  key: 4px
  pad: 5px
  lcd: 4px
  strip: 6px
  device: 12px
  card: 18px
  pill: 22px
  round: 50%
spacing:
  pad-gap: 6px
  device-gap: 10px
  deck-gap: 16px
  page-gap: 18px
  card-pad: 24px
  device-pad: 14px
components:
  card:
    backgroundColor: '{colors.panel}'
    rounded: '{rounded.card}'
    padding: '{spacing.card-pad}'
  device:
    backgroundColor: '{colors.device}'
    rounded: '{rounded.device}'
    padding: '{spacing.device-pad}'
  lcd:
    backgroundColor: '{colors.lcd}'
    textColor: '{colors.cyan}'
    rounded: '{rounded.lcd}'
    padding: 8px 12px
  pad:
    textColor: '{colors.ink}'
    rounded: '{rounded.pad}'
    height: 48px
  pad-chop:
    textColor: '{colors.ink}'
    rounded: '{rounded.pad}'
    height: 48px
  slotkey:
    textColor: '{colors.ink}'
    rounded: '{rounded.key}'
    width: 32px
    height: 32px
  btn:
    textColor: '{colors.ink}'
    rounded: '{rounded.pill}'
    height: 44px
    padding: 0 18px
  btn-hot:
    textColor: '{colors.ink}'
    rounded: '{rounded.pill}'
    height: 44px
  btn-ghost:
    textColor: '{colors.white}'
    rounded: '{rounded.pill}'
    height: 44px
  chip:
    textColor: '{colors.white}'
    rounded: 20px
    height: 40px
  play:
    textColor: '{colors.ink}'
    rounded: '{rounded.round}'
    width: 64px
    height: 64px
---

# Design System: NOISE — Chop Shop & Rex Deck

## Overview

**Creative North Star: "Two phonk devices on the Countach dash"**

NOISE is a drop zone on a dark glass card in front of a rendered Countach under a synthwave sun; the result replaces the card with a matte-black chassis that two rack devices are bolted into: the **CHOP SHOP**, a ReCycle-style slicer that shows the record cut at its own beats across its separated stems, and the **REX DECK**, a Dr. Octo Rex-style loop player with eight pattern keys and sixteen chrome pads that light as the beat plays them. Below the devices: three preset chips, five sliders, one SAVE whose label names the format.

The devices are the result, not a workstation: nothing on them has to be learned before the song plays. The ground is midnight violet; the two lights are laser magenta (the melodic side: the re-tuned music, the pattern key in use, the playhead ring on a pad, the bells readout) and electric cyan (the mechanical side: drums, LCD text, chopped slices, the primary action). Everything the hand touches is brushed chrome; everything that reads is a black LCD strip.

Source of truth: `noise.css`, `index.html`, `js/noise.js`. Rasters in `assets/art/` with provenance in `PROVENANCE.md` and embedded prompts.

## Colors

### Ground
- **night**: page and LCD ground. **panel**: the intake's glass card (`backdrop-filter: blur(14px)` over the art); the deck has no card, it is a matte chassis (`#0c0617 → #070310`, no inset ring) so the devices are the only framed things on screen. **device / device-deep**: the vertical gradient of a device plate, topped by a one-pixel white highlight (`.dev::before`) that reads as a machined edge.
- **line**: every hairline seam, the card inset ring, the slicer frame.

### Light
- **mag**: the re-tuned music in the slicer waveform, the lit pattern key, the live-pad ring, the CHOP slider, the bells LCD line, the play button, bass/vocals lamps when lit.
- **cyan**: the record's drums in the waveform, every LCD main and sub line, chopped-bar flags and chopped pads, the active preset chip, the primary SAVE, drums/other lamps when lit, focus outline.
- **sun-a → sun-b → mag**: the striped sun behind the card; it exists only behind the page and only in the deck stage.

### Material
- **chrome-hi / chrome / chrome-lo**: the brushed chrome gradient on buttons and pattern keys. **pad-hi / pad / pad-lo**: a lighter, flatter chrome for the sixteen pads so their labels keep contrast; the pad's bottom lip (`inset 0 -3px 0 pad-lo`) is its travel. **ink**: text on chrome. **white / dim / lavender**: text on the ground.

### Contrast rules
Dark ink on every lit chrome or cyan surface (white fails on cyan). LCD text is cyan on `#05030c` (≥ 10:1). Lamp labels are lavender at 11 px minimum. Pad origin labels are 9 px only because they sit beside a 12 px number on the same pad.

## Typography

- **Audiowide** is the voice of anything that is a readout or a name: the wordmark, device names, the NOW PLAYING title, LCD main lines, pad numbers, slider values, the key readout. Never below 12 px.
- **Michroma** is the technical label face: lamps, slot sub-labels, LCD sub lines, slider names, button labels, flag numbers, pad origins. Tracking .02–.14em; 11 px floor everywhere, including pad origins and flag numbers.
- On the deck the wordmark steps back to a 28 px badge (22 px on phones, tagline hidden) in a single row with the tagline, so the first viewport is the play strip and the CHOP SHOP, not the brand.
- The system sans carries sentence-case body copy: the intake fine print, metadata under the title, toasts.

## Layout

- One centred column: 760 px for intake, **860 px in the deck stage** so the pads and the REX LCD sit side by side. Phones get the full width with 12 px gutters.
- Deck order, top to bottom: play + NOW PLAYING (title, "112 BPM slowed to 97 · E major → E minor · 3:31") → CHOP SHOP → REX DECK → presets → sliders → SAVE → ANOTHER SONG.
- Inside a device: header grid (name · sub · right-hand cluster), then the device's working surface, then its readout row. Device gap 10 px; deck gap 16 px.

## Components

### CHOP SHOP
- **Waveform strip**: 120 px high, LCD ground, a 22 px flag rail across the top. A legend in the lower right (QUICK SPLIT / NEURAL STEMS swatches) appears only once real stems are being computed, so the two region treatments are named, not just different. The re-tuned music draws as a filled magenta band, the record's own drums as cyan spikes over it (`screen` blend so overlaps go light). Quick-split regions draw at 40 % with a bright hairline edge; neural regions draw solid, so the strip itself shows which bars have landed. Bar ticks along the bottom edge.
- **Slice flags**: one numbered flag per bar, decimated so a flag never has less than 52 px (`drawFlags` picks the step from the strip width; the last flag stays 30 px clear of the right edge). Grey = straight bar, cyan = chopped bar, magenta = tape-stop bar. The number sits at the top, a small triangular flag under it: ReCycle's marker, not a ruler. Between the numbered flags hang short ticks for the inner slice points SENSITIVITY found (8 px on beats, 5 px on half-beats), thinned to 5 px apart.
- **SENSITIVITY**: the slicer's one knob, in the CHOP SHOP readout row (a 112 px panel: name, horizontal fader, percentage). It is ReCycle's sensitivity: it sets the attack threshold a point of the record must clear to become a slice point, so low finds only the hard hits and high finds every 8th. It is not a sixth mix slider; it lives on the device whose behaviour it changes.
- **Playhead**: a 2 px white line with a cyan halo; the whole strip is the seek slider (keyboard arrows move 5 s).
- **Stem lamps**: four 10 px lamps (DRUMS BASS OTHER VOCALS). Dim on the quick split, pulsing while a stem is being computed, lit while the playhead is inside a region whose stems have landed (drums/other cyan, bass/vocals magenta), lit steadily when the whole song is done. So the lamps answer "is what I hear right now the real stems?", bar by bar.
- **Readout row**: QUICK SPLIT / STEMS 48% / NEURAL STEMS LCD with the honest sub line ("2 min left · keep listening"), the key LCD ("Em / was E major"), and the one ghost button (GET THE REAL STEMS → STOP → hidden when done).

### REX DECK
- **Pattern keys**: eight 32 px chrome keys, the chosen one magenta; they reseed the chop plan (same RNG, same slot = same pattern).
- **Pads**: a fixed 8×2 grid (4×4 on phones), 52 px high, light chrome with a 3 px bottom lip. Each shows its number and its origin as `bar.beat` in 11 px Michroma (`1.3` is bar 1 beat 3, `1.3+` the "and" after it); chopped slices are cyan pads; reversed slices carry an authored 9 px SVG left-pointing triangle, octave-down a down-pointing one (no Unicode glyphs). The pad under the playhead wears a magenta ring; a press travels 3 px and flashes.
- **LCD**: BAR 005 · DROP A · HALF-TIME · CHOPPED / BELLS · E5 · from the song. The values change in place; the grid never reflows while playing.

### Controls
- **btn** (chrome), **btn--hot** (cyan, the one primary action per stage), **btn--ghost** (dark with a hairline). 44 px tall; `--big` 56 px.
- **chip**: preset pills, cyan when active. **slider**: 6 px track with a two-stop gradient fill (`--p`), 20 px chrome thumb ringed in the slider's colour; CHOP is magenta, the rest cyan; SLOW reads as BPM.
- **play**: 72 px magenta disc, left of the title so a long title never collides with it.
- **toast**: dark pill bottom-centre, cyan ring (magenta when warning), sentence case.

## Motion
- One authored moment: when the key is turned (deck stage) the sun and laser grid fade up behind the chassis over 1.2 s and the pin-up slides in from the right. The pin-up is a true alpha cut-out (`assets/art/pinup-cut.webp`, keyed from a chroma plate), standing on the scene with a magenta drop-shadow glow; there is no mask gradient and no rectangular plate edge. The grid runs while in the deck stage; `prefers-reduced-motion` stops it.
- Functional motion only otherwise: the playhead, the live-pad ring, lamp pulses while stems compute, the pad press. The waveform re-renders region by region as stems land; nothing else animates.

## Copy
- Client-facing only. Readouts say what is happening and how long: "STEMS 48% · 2 min left · keep listening", "FETCHING MODEL · 41 / 80 MB · once, then cached", "real stems need a computer".
- The one hard rule shows up once, in the intake fine print: "No synth bass. Ever."

## Responsive
- ≤ 560 px: the brand is a 22 px badge; SAVE sits full-width directly under the play strip (one thumb from the top, nothing to scroll past); devices lose their sub line; lamps and pattern keys span the full device width (keys 40 px, flex); the readout row becomes a 2-column grid with the state LCD across the top, key LCD and SENSITIVITY side by side, the stems button full width; pads 4×4 at 52 px; the REX LCD drops under the pads; preset chips stretch to thirds; the format control and ANOTHER SONG stack.
- The pin-up hides below 1180 px; the Countach stays as the room at every width.
