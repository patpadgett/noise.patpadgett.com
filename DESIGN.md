---
name: NOISE — Midnight Countach
description: A browser phonk workstation styled as the dash of a Lamborghini Countach under a synthwave sun.
colors:
  night: '#0a0514'
  night-2: '#120a24'
  panel: '#150c2a'
  panel-2: '#1c1038'
  line: '#2a1d4a'
  white: '#f4f1ff'
  chrome-hi: '#ffffff'
  chrome: '#dbe2f4'
  chrome-lo: '#4a5270'
  ink: '#1a1230'
  mag: '#ff2bd6'
  mag-deep: '#a5127f'
  cyan: '#19e6ff'
  cyan-deep: '#0d7f93'
  sun-a: '#ffd166'
  sun-b: '#ff2bd6'
typography:
  display:
    fontFamily: 'Audiowide, "Arial Black", Impact, sans-serif'
    fontSize: 92px
    fontWeight: 400
    lineHeight: 1
    letterSpacing: .04em
  headline:
    fontFamily: 'Audiowide, "Arial Black", Impact, sans-serif'
    fontSize: 40px
    lineHeight: 1
    letterSpacing: .04em
  title:
    fontFamily: 'Audiowide, "Arial Black", Impact, sans-serif'
    fontSize: 26px
    lineHeight: 1
    letterSpacing: .06em
  readout:
    fontFamily: 'Audiowide, "Arial Black", Impact, sans-serif'
    fontSize: 17px
    lineHeight: 1.1
    letterSpacing: .06em
  body:
    fontFamily: 'Michroma, "Arial Narrow", sans-serif'
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: 'Michroma, "Arial Narrow", sans-serif'
    fontSize: 11px
    letterSpacing: .12em
  micro-label:
    fontFamily: 'Michroma, "Arial Narrow", sans-serif'
    fontSize: 9px
    letterSpacing: .2em
  code:
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'
    fontSize: 12px
rounded:
  key: 4px
  lcd: 4px
  well: 8px
  device: 12px
  round: 50%
spacing:
  key-gap: 6px
  control-gap: 8px
  rack-gap: 14px
  body-gap: 16px
components:
  key:
    textColor: '{colors.ink}'
    rounded: '{rounded.key}'
    height: 30px
    padding: 0 12px
  key-big:
    textColor: '{colors.ink}'
    rounded: '{rounded.key}'
    height: 44px
    width: 54px
  key-hot:
    textColor: '{colors.ink}'
    rounded: '{rounded.key}'
    height: 30px
    padding: 0 12px
  key-ghost:
    textColor: '{colors.white}'
    rounded: '{rounded.key}'
    height: 30px
    padding: 0 12px
  sel:
    textColor: '{colors.night}'
    rounded: '{rounded.key}'
    width: 30px
    height: 30px
  lcd:
    backgroundColor: '#05030c'
    textColor: '{colors.cyan}'
    rounded: '{rounded.lcd}'
    padding: 6px 12px
  lanepad:
    textColor: '{colors.white}'
    rounded: '{rounded.key}'
    width: 132px
    height: 34px
  piano-white:
    textColor: '{colors.ink}'
    rounded: '0 0 4px 4px'
  piano-black:
    textColor: '{colors.white}'
    rounded: '0 0 3px 3px'
  tab:
    rounded: '{rounded.key}'
    height: 30px
    padding: 0 14px
  device:
    rounded: '{rounded.device}'
---

# Design System: NOISE — Midnight Countach

## Overview

**Creative North Star: "The Countach dash at midnight"**

NOISE presents its controls as the dashboard of a 1980s Italian supercar parked under a synthwave sun. The ground is midnight violet; the two lights are laser magenta and electric cyan; everything the hand touches is brushed chrome; everything that reads is a black LCD strip with cyan text. The hero is an in-house rendered Countach, the rack sits beside a pin-up poster, and the sun and laser grid behind the page only rise when the key is turned.

The same vocabulary runs through the rack, the chopper, the master and the canvas editor: chrome keys and pads, recessed black displays, neon arcs on the knobs. This document describes the built stylesheet and JavaScript.

**Key Characteristics:**
- Midnight ground, chrome controls, black LCD readouts.
- Magenta marks the melodic side (808, talkbox, master); cyan marks the mechanical side (drums, bells, tape, chopper).
- Physical metaphors that carry information: ignition barrel = audio unlock, tachometer = tempo, odometer reels = bar/step, gear levers = screw/swing, cassette reels = slice player.
- Light follows state: the sun, lasers and grid animate only while playing; lamps pulse on beats.

Source of truth: `styles.css`, `index.html`, `js/app.js`, `js/editor.js`, `js/knob.js`. Rasters: `assets/art/` with provenance in `PROVENANCE.md` and embedded prompts.

## Colors

### Ground
- **night** / **night-2**: page and hero grounds. **panel** / **panel-2**: device plates and the cluster. **line**: every hairline seam and inset border.

### Light
- **mag** (laser magenta): 808/talkbox/master arcs and values, lit steps on magenta devices, playhead, wordmark glow, lever values, `is-on` keys.
- **cyan** (electric cyan): drum/bell/tape arcs and values, LCD text, tachometer needle, the sun's lower stripes' complement, the `key--hot` primary action (SAVE JSON, LOAD TO DECK), focus outline.
- **sun-a → sun-b**: the striped sun gradient (gold into magenta), the only warm color, and it exists only behind the page.

### Material
- **chrome-hi / chrome / chrome-lo**: the brushed-chrome gradient (`--chrome-grad`) on keys, pads and piano whites. **ink**: dark text on chrome. **white**: light text on the ground.

### Named Rules
**The Two-Light Rule.** A device is magenta or cyan, never both, declared by `.device--magenta` / `.device--cyan`; its knob arcs, values, lit steps and header underline follow. The master (EXHAUST) is magenta. Cyan alone is the reading color for LCD text regardless of device.

## Typography

**Display: Audiowide** (wordmark, device badges, LCD titles, knob values, counter digits, lever values). **Tech: Michroma** (labels, tags, button text, body prose, ruler text in the canvas). Both are single-weight, self-hosted WOFF2 with `font-display: swap` and preloaded.

### Hierarchy
- **Display 92px** for the NOISE wordmark (72px at ≤1180, 54px at ≤820).
- **Headline 40px** for the hero's NOW LOADED title (28px mobile). **Title 26px** for device badges (22px mobile); 30px for the manual title.
- **Readout 17px** for LCD titles; counter reels 20px in 34px cells; knob values 13px (15px on the large V12 knobs).
- **Body 13px / 1.6** Michroma for manual prose (max 46ch on desktop).
- **Label 11px** for keys and tabs; 10px for LCD sublabels and pads; **micro-label 9–9.5px** with wide tracking for knob names, device tags, lever/counter captions and scope labels (decorative captions next to their large values, not primary functional text).
- Tabular numerals on counters, values, tune readouts and the ruler.

## Layout

The centered dash has a maximum width of 1440px and padding `0 18px 60px`. Order: hero card (min 520px, full-bleed art, top bar and bottom tag), cluster (grid `auto auto auto minmax(0,1fr)`: ignition, gauges, levers, file strip), stage (grid `minmax(0,1fr) 320px`: rack + sticky pin-up poster), CHOP SHOP, EXHAUST, editor shell, manual.

Devices are `.device` plates with a header (badge, keys, lamp) separated from the body by a hairline that takes the device's light when lit, and a body grid `minmax(0,1fr) auto` (face + knob bank). Faces stretch to the knob bank's height; the three synth faces are a `2fr 3fr` grid of scope and piano.

At **≤1180px**: bodies become one column, knob banks flow horizontally, the poster drops below the rack (max 420px), the wordmark is 72px, the file strip spans the cluster.

At **≤820px**: dash padding `0 10px 40px`; the hero nav is a 4-up equal grid; the cluster stacks (ignition beside a 2×2 of transport keys, tach centered, three odometers in a row, two levers); keys are 44px high; device knob banks become an `auto-fit minmax(64px,1fr)` grid; the step grid keeps 16 columns and scrolls sideways beside fixed lane pads; pianos span full width; slice pads are a 4×2 grid; the chopper's controls stack; the manual is one column.

The docked editor is 460px high on desktop, auto with a 460px canvas minimum on mobile; detached it fills the viewport. Canvas geometry switches to touch dimensions on coarse pointers or below 700px.

## Elevation & Depth

Depth is structural. Keys and pads protrude via `--key-shadow` (white inner top edge, chrome-lo inner bottom edge, 3px base, short diffuse shadow) and press down 2px. LCDs, scopes, the tape window and the waveform recess with inset hairlines and broad black inset shadows; LCDs carry a faint scanline overlay. Devices and the cluster float on `0 16px 40px -22px #000`. Neon is applied as `--neon-mag` / `--neon-cyan` text and box shadows on the wordmark, badges, values, lit steps and the hero lasers.

## Shapes

Keys, pads, LCDs and tabs use 4px corners; knob banks and wells 8px; devices, the cluster, the hero and the editor 12px. Piano whites are square-topped with 4px bottom corners; blacks float over the seams at 62% width and 58% height. Knobs, lamps, the ignition barrel and reel hubs are circular. The tachometer is a half-disc SVG.

## Components

### Keys
`.key` is the chrome button: 30px high, Michroma 11px with .12em tracking, ink text. `--big` is 44×54 for transport; `--hot` is the cyan primary; `--ghost` is a translucent dark pill for hero navigation; `.is-on` turns magenta with a glow (Play, Mute, Loop). Focus is a 2px cyan outline.

### Ignition
An SVG barrel with OFF / ACC / ON / START positions and a chrome key that rotates from −60° to +60° when `.is-on`. Idle, the barrel pulses a cyan drop-shadow; on, it glows magenta. Clicking it unlocks audio, plays the ignition sound (starter whine, engine catch, sub thump) and starts the song.

### Gauges
The tachometer maps 60–200 BPM onto a 180° needle with a magenta redline above 172. Odometers (`.counter`) are Audiowide digit reels in black drums, rolling with `--roll` speed (BAR .16s, STEP .05s). Levers are native vertical ranges with chrome thumbs in pill wells; values below in magenta.

### LCD strips
`.lcd` is the reading surface: black gradient, inset hairline, scanline overlay, Audiowide cyan title, Michroma dim sublabel. Used for the song title (a rename button), the tape name, the chopper readout and the master info strip.

### V12 step grid
Lane pads (`.lanepad`) are dark inset buttons with the lane name and tune readout; pressing auditions the lane. Step pads (`.sel`) are 30px chrome squares numbered 1–16 in groups of four; `.is-on` lights cyan, `.is-now` (the sounding column) turns white with a cyan inset ring, both together glow. Pages (BAR 1 / BAR 2) switch which bar of a longer pattern is shown.

### Pianos
`.piano` lays white keys in a `repeat(var(--nw), 1fr)` grid and floats black keys absolutely over the seams via `--i`. Pressing lights the key in the device's color. Pianos audition only; notes are written in the editor.

### Tape deck
A canvas cassette window: slice segments across the top (the firing slice lights magenta), two reels whose fill moves as the tape plays, a cyan counter, and a tape path with a head that lights on a hit. Below: the tape LCD and 8 chrome slice pads (shift-click for reverse).

### Chop shop
A waveform well with magenta cut lines and alternating magenta/cyan slice tags; click adds a cut, drag moves one, double-click removes one. Controls: CUT BY transients/4/8/16/32, sensitivity, NORMALIZE, LOAD TO DECK (hot), EXPORT SLICES.

### Exhaust
Five master knobs, a 24-segment LED meter (cyan, magenta above 16, white above 20) and the info LCD.

### Editor canvas
Notes are chrome cells with a velocity mark; the sounding note and the playhead are magenta; the playhead column carries a magenta wash; selection outlines are magenta. Row labels are chrome chips with a cyan mark; the corner chip carries device and pattern name in ink on the device color. Song blocks repeat the chrome treatment.

### Feedback
Toasts are panel-colored strips with a cyan inset border (magenta for warnings). `body.is-lit` raises the sun and lasers; `body.is-playing` runs the grid, sweeps the lasers, pulses the poster frame and arms the lamps; `body.is-recording` turns RECORD MIC red; `body.is-detached` swaps the docked editor for its return placeholder. `prefers-reduced-motion` stops the grid, lasers, frame pulse, ignition pulse, reel transitions and the recording blink.

## Do's and Don'ts

### Do:
- Keep the two-light rule: a device is magenta or cyan, and its arcs, values and lit steps agree.
- Keep chrome for touchable things and black LCD for readable things.
- Keep the physical metaphors informative (the tach shows tempo, the reels move with the tape); no decorative gauges.
- Keep the song-file device ids (`breaker`, `hearse`, `cathedral`, `preacher`, `carousel`) even though the visible names changed.

### Don't:
- Don't add a third accent hue; the sun's gold lives behind the page only.
- Don't put glow on body prose or labels; glow belongs to wordmark, badges, values and lit controls.
- Don't flatten the chrome into solid silver or the LCDs into plain dark cards.
- Don't reintroduce side stripes or eyebrow labels above titles.
