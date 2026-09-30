# NOISE — Select-O-Matic

A browser phonk workstation styled as a late-night Memphis jukebox. Live at https://noise.patpadgett.com.

Everything is static: `index.html`, `styles.css`, `js/*.js`, two self-hosted fonts. No build step, no backend, no sample files. Every sound is synthesized with the Web Audio API; the demo song's chopped "record" is rendered offline in the browser at first coin drop.

## What is in the cabinet

- BREAKER (drum machine): 8 lanes, 16-step chrome selector per bar (pages for 32/64-step patterns), lane title strips double as pads, per-lane tuning (right-click / wheel), MEMPHIS bit-crush + lowpass.
- HEARSE (808): pitch-snap attack, glide/slide notes (`g: 1`), COFFIN drive, RUMBLE sub-octave.
- COWBELL CATHEDRAL (melody): two-square-wave cowbell, CHOIR detune stack, NAVE convolution hall.
- PREACHER (formant stabs): three-formant vowel morph, SERMON wobble, GRIT drive.
- CAROUSEL (slice player): plays slices of the loaded record; record-magazine + tone-arm visual; reverse slices (`r: 1`), WOBBLE, TAPE lowpass.
- LATHE (chopper): drop audio / record mic / resample the song; transient or even cuts; drag, add, remove cuts; PRESS TO CAROUSEL; EXPORT SLICES.
- SCREWTAPE (master): tape saturation, tone, wow/flutter, hiss (only while playing), compressor + limiter, VU.

Transport: INSERT COIN (audio unlock), play/stop/rewind/loop, BPM/BAR/STEP drum counters, SCREW lever (pitch + tempo on every device, saved with the song), SWING.

Editor (bottom): PATTERN tab is a piano roll (step grid for drums/slices) with a velocity lane; SONG tab lays pattern blocks per device across bars, loop range on the ruler. DETACH opens `editor.html` in its own window, synced over BroadcastChannel (postMessage fallback).

Files: SAVE JSON downloads `<title>.noise.json` (see `format.html`); OPEN or drag-drop loads it; WAV renders an offline mixdown. Unsaved work autosaves to localStorage and is offered back on the next visit.

## Song format

`noise-song` v1, documented at `format.html`. Plain JSON; carousel audio embedded as `data:audio/wav;base64,...` (PCM16). WAV was chosen over MP3 because every browser decodes it and no encoder needs shipping.

## Code layout

- `js/synth.js` — device DSP classes (built against any BaseAudioContext so live and offline render share code), master tape stage, UI sounds
- `js/engine.js` — AudioContext, look-ahead scheduler, screw, offline render (`renderRange`), transient detection, buffer utilities
- `js/song.js` — data model, device type table, demo song, validation, undo history
- `js/ops.js` — the edit reducer shared by main and detached windows
- `js/editor.js` — canvas piano-roll / block editor
- `js/knob.js` — Knob (ARIA slider) and Counter (drum reels)
- `js/app.js` — main window: cabinet DOM, device faces, lathe, files, detach bus
- `js/detached.js` — the popup editor's side of the bus
- `js/wav.js` — WAV encode/decode, base64, slicing helpers

## Design

Product record: `PRODUCT.md`. Visual system: `DESIGN.md` and `.impeccable/design.json`. Direction contract: `.impeccable/surfaces/index-html.md`. Type: League Gothic (display, OFL) and Special Elite (hand-set strips, Apache 2.0), self-hosted in `assets/fonts/`.

## Running locally

Any static server from the repo root, e.g. `python3 -m http.server 8765`. ES modules need http(s), not `file://`.

## QA

`tests/smoke.mjs` and `tests/detach.mjs` are the Playwright scripts used during the build (engine unlock, playback RMS, JSON round-trip, lathe resample + press, editor edits, undo, mixdown render, detached-editor sync, mobile overflow). Run against a local server on port 8765: `NODE_PATH=/path/to/node_modules node tests/smoke.mjs`.
