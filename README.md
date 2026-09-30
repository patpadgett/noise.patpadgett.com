# NOISE — Midnight Countach

A browser phonk workstation styled as the dash of a Lamborghini Countach under a synthwave sun. Live at https://noise.patpadgett.com.

Everything is static: `index.html`, `styles.css`, `js/*.js`, two self-hosted fonts, two in-house rendered art plates. No build step, no backend, no sample files. Every sound is synthesized with the Web Audio API; the demo song's chopped "tape" is rendered offline in the browser when the key is first turned.

## The demo: COUNTACH DRIFT

140 BPM drift phonk in E minor with the phrygian F. Four-bar intro (hats, talkbox chants, chopped tape rise), drop at bar 5 (half-time kick pattern, distorted 808 riding the kicks and sliding into the b2 and the 5th, constant-eighth cowbell hook, "HEY" chants on the and-of-2 and and-of-4, cassette stabs), B section at bar 13 (busier kicks, 16th hats, tom fill, higher bell line). Fully editable; DEMO reloads it.

## What is on the dash

- V12 (drum machine, type `breaker`): 8 lanes, 16-step chrome grid per bar (BAR 1 / BAR 2 pages), lane name pads audition, per-lane tuning (right-click / wheel / TUNE keys), MEMPHIS bit-crush + lowpass.
- TRUNK (808, type `hearse`): pitch-snap attack, decay-to-sustain envelope that holds for the note length, glide/slide notes (`g: 1`), DRIVE = pre-gain → tanh → hard clip, SUB octave.
- LAZERBELL (cowbell lead, type `cathedral`): two-square-wave cowbell, STACK detune pile, GRIT drive, HALL convolution.
- TALKBOX (formant chants, type `preacher`): three-formant vowel morph, WOBBLE, GRIT, TAIL.
- TAPE DECK (slice player, type `carousel`): plays slices of the loaded tape; cassette-reel canvas with slice segments and counter; reverse slices (`r: 1`), WOBBLE, TAPE lowpass.
- CHOP SHOP (chopper): drop audio / record mic / resample the song; transient or even cuts; drag, add, remove cuts; LOAD TO DECK; EXPORT SLICES (`noise-slices` v1).
- EXHAUST (master): tape saturation, tone, wow/flutter, hiss (only while playing), compressor (slow attack so kicks punch) + limiter, 24-segment LED meter.

Transport: TURN KEY (ignition barrel = audio unlock + play), play/stop/rewind/loop, tachometer (tempo), BPM/BAR/STEP odometer reels, SCREW lever (pitch + tempo on every device, saved with the song), SWING.

Editor (bottom): PATTERN tab is a piano roll (step grid for drums/slices) with a velocity lane; SONG tab lays pattern blocks per device across bars, loop range on the ruler. DETACH opens `editor.html` in its own window, synced over BroadcastChannel (postMessage fallback).

Files: SAVE JSON downloads `<title>.noise.json` (see `format.html`); OPEN or drag-drop loads it; WAV renders an offline mixdown. Unsaved work autosaves to localStorage and is offered back on the next visit. Song-file device type ids are unchanged from the first release, so earlier files still load.

## Song format

`noise-song` v1, documented at `format.html`. Plain JSON; tape-deck audio embedded as `data:audio/wav;base64,...` (PCM16). WAV was chosen over MP3 because every browser decodes it and no encoder needs shipping.

## Code layout

- `js/synth.js` — device DSP classes (built against any BaseAudioContext so live and offline render share code), master tape stage, UI sounds (ignition)
- `js/engine.js` — AudioContext, look-ahead scheduler, screw, offline render, demo tape bake, transient detection, buffer utilities
- `js/song.js` — data model, device type table, demo song, validation, undo history
- `js/ops.js` — the edit reducer shared by main and detached windows
- `js/editor.js` — canvas piano-roll / block editor
- `js/knob.js` — Knob (ARIA slider) and Counter (odometer reels)
- `js/app.js` — main window: dash DOM, device faces, pianos, tape deck canvas, chop shop, files, detach bus, hero plate placement
- `js/detached.js` — the popup editor's side of the bus
- `js/wav.js` — WAV encode/decode, base64, slicing helpers

## Design

Product record: `PRODUCT.md`. Visual system: `DESIGN.md`. Direction contract: `.impeccable/surfaces/index-html.md`. Type: Audiowide (display, OFL) and Michroma (tech, OFL), self-hosted in `assets/fonts/`. Art: `assets/art/` — Countach hero and pin-up poster generated locally with ComfyUI + Flux Schnell; prompts, seeds and post-processing in `assets/art/PROVENANCE.md` and embedded in each file.

## Running locally

Any static server from the repo root, e.g. `python3 -m http.server 8765`. ES modules need http(s), not `file://`.

## QA

`tests/smoke.mjs` and `tests/detach.mjs` are the Playwright scripts used during the build (engine unlock, playback RMS, JSON round-trip, resample + load to deck, editor edits, undo, mixdown render, detached-editor sync, mobile overflow). Run against a local server on port 8765: `NODE_PATH=/path/to/node_modules node tests/smoke.mjs`.
