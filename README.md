# NOISE — turn any song into phonk

Drop a song, get phonk. One screen, no account, nothing uploaded. Live at https://noise.patpadgett.com.

NOISE listens to the song in your browser, finds the tempo, the beats and the key, splits the record into stems, reads its melody, re-tunes the music into the minor key, slows it down and lays a phonk kit under it: half-time kick and snare, hats, a cowbell that plays the song's own melody, and the song re-chopped from its own beats. **No synthesized bass. Ever.** The only melodic sound is the record. You get three presets and five sliders, then save it as MP3, WAV or a vertical video for Reels/TikTok.

Everything is static: `index.html`, `noise.css`, `js/*.js`, two vendored libraries (an MP3 encoder and the Demucs WASM module), two self-hosted fonts, two in-house rendered art plates and one public-domain demo record. No build step, no backend. Audio never leaves the device; the only network request after page load is the one-time download of the separation model (84 MB, cached by the browser), and only after you say yes to it: the first press of GET THE REAL STEMS shows the size and the expected wait on the LCD, the second press fetches, and the download can be cancelled.

## Ways in

- Drop or browse an audio or video file (MP3, WAV, M4A, FLAC, MP4…). Decoded with `decodeAudioData`.
- Paste a YouTube link. The video is embedded; press PHONK IT and pick this tab with "Share tab audio" — NOISE records the video through once (`getDisplayMedia`), then converts the recording. Browsers do not let a web page download YouTube audio, and NOISE has no server, so recording is the honest path. Chrome and Edge on desktop support tab audio capture; others get a message pointing to RECORD THE ROOM or a file.
- Paste a Spotify link. Spotify only exposes the title and cover through oEmbed, so NOISE shows the song and says plainly that it cannot fetch Spotify audio; play it on a speaker and use RECORD THE ROOM, or drop the file.
- RECORD THE ROOM: microphone capture for anything playing out loud.
- TRY ONE: "Fare Thee Honey Blues", Mamie Smith and her Jazz Hounds, 1920 (public domain, see `assets/demo/SOURCE.md`).

## What it does to the song

1. **Analysis** — `js/analyze.worker.js` (Web Worker): downsample to 22.05 kHz, 6-band log spectral flux onsets, autocorrelation tempo with the octave settled so the half-time feel lands at 70–100 BPM, Ellis-style dynamic-programming beat tracking, downbeat phase from low-band energy, Krumhansl–Schmuckler key from a chroma profile, per-beat loudness for the drop detection.
2. **Quick split** — `js/pitch.worker.js`, seconds after the drop: a harmonic/percussive separation of the mix (median filtering across time and frequency, Fitzgerald 2010), so the song's own drums stay as drums; the music goes through a **selective phase-locked pitch shifter** that moves only the partials sitting on the major 3rd, 6th and 7th of the key down a semitone (identity phase locking, Laroche & Dolson), so a major song becomes its parallel minor while every in-scale note keeps its original phase and timbre; and a **melody reader** (harmonic-sum salience over G2–C6 per frame) that becomes the cowbell line. The deck starts playing from this material.
3. **Neural stems** — `js/stems.js` + `js/separate.worker.js`: Demucs v4 hybrid transformer (`htdemucs`, four stems) running as `demucs.cpp` compiled to WebAssembly, one single-threaded WASM instance per Web Worker, the song cut into ~12 s chunks with 0.75 s overlaps and crossfaded back together. As each region lands it is re-tuned by the pitch worker (bass + other + vocals as the music, drums passed through, melody read from the vocals) and the deck switches over at the next bar. A 3-minute song takes about 6–10 minutes on a 4-core laptop; the LCD shows minutes left, the stem lamps light when the stems are in, and the quick split keeps playing meanwhile. Each worker needs ~2 GB of memory, so phones are told plainly that real stems need a computer.
4. **Arrangement** — `js/phonker.js` `arrange()`: a bar list and an event list in source time. Half-time drums (kick on 1, snare+clap on 3, hats, fills every 8th bar, crash every 8), the song's melody on the bells (section A outlines it on quarters, section B rides it on 8ths; a minor motif where the record has no readable melody), and the REX plans: bars re-chopped from their own beats, reversed slices, octave-down chops, a tape stop every 16th bar. The same function drives live playback and the offline render, so what you hear is what you save. A look-ahead scheduler lets new material or a new pattern take over at the next bar without a restart.
5. **Kit** — `js/kit.js`, synthesized with the Web Audio API against any `BaseAudioContext`: `Drums` (kick, snare, clap, hats, rim, crash with shared per-lane filters), `Cowbell` (two detuned squares at the 808 bell ratio, pitch snap, per-note bandpass, tuned with the tape speed), `Tape` (saturation, tone, wow/flutter, hiss, bus compressor, limiter, ceiling). No 808, no bass synth.
6. **Export** — `js/export.js`: WAV (PCM16), MP3 (bundled `vendor/lamejs.js`, LGPL), vertical 1080×1920 video drawn on a canvas with the Countach plates and a live spectrum, muxed with `MediaRecorder`. Long songs are rendered in 32-second windows and crossfaded so the offline context never carries more than a few hundred events.

Presets: DRIFT (slower, chops rare), MEMPHIS (brighter, bit-crushed drums, more chops), BRAZILIAN (barely slowed, kit forward). Sliders: SLOW (shown as the resulting BPM), KIT, BELLS, GRIT, CHOP. The CHOP SHOP's own knob is SENSITIVITY (ReCycle's): it sets the attack a point of the record must clear to become a slice point (read from the analysis worker's onset envelope), so low chops only at the hard hits and high treats every 8th as a slice; the flag rail shows the points it found and CHOP decides how often a bar is re-chopped from them. The REX DECK's eight pattern keys reseed the chop plan; its sixteen pads are the sixteen 8th-notes of the two bars under the playhead — press one to hear that slice.

## Mix gates (measured, demo record, DRIFT preset)

Three renders of the same 20 s (song only, kit only, both): the song leads the kit in the 800–3 kHz band by **+4.7 dB** (gate ≥ 3 dB); the kit owns everything under 200 Hz. Key: the 1920 record reads as major; the export reads as the parallel minor (Krumhansl r = 0.92) and the minor-3rd/major-3rd energy ratio rises from 0.6 to 4.8. Melody reader on a synthetic C-E-G-C arpeggio: 6/6 notes correct, the E moved to 311 Hz (Eb), C and G untouched, clicks landed in the percussive stem at 20 dB above the floor. Demucs WASM: 12 s of stereo in 160 s on one core (13×RT); three workers on a 4-core box do a 40 s song in 6 minutes.

## Code layout

- `js/noise.js` — the one controller: intake → analysis → quick split → deck; neural stems in the background; CHOP SHOP (stem waveform + slice flags) and REX DECK (pattern keys, pads, LCD); export.
- `js/input.js` — link parsing (YouTube/Spotify/audio URL), oEmbed metadata, tab and mic recorders, mono mixdown.
- `js/analyze.worker.js`, `js/pitch.worker.js` (+ `js/fft.js`), `js/stems.js`, `js/separate.worker.js`, `js/phonker.js`, `js/kit.js`, `js/export.js` — as above.
- `vendor/lamejs.js` + `vendor/LAMEJS-LICENSE` — `@breezystack/lamejs` 1.2.7 (LGPL-3.0).
- `vendor/demucs_free.js` + `vendor/demucs_free.wasm` + `vendor/DEMUCS-WASM-LICENSE` — demucs.cpp WASM build by Sevag Hanssian (MIT), from free-music-demixer @8229982d. Model weights: Meta's `htdemucs` (MIT) as ggml f16, fetched from `huggingface.co/datasets/Retrobear/demucs.cpp` on first use.
- `assets/art/` — Countach hero and pin-up, generated locally with ComfyUI + Flux Schnell; the pin-up is rendered on a chroma-green plate and keyed to a true alpha cut-out (`pinup-cut.webp`/`.png`, matte = rembg vote + relative green key, spill-suppressed). Prompts, seeds and post-processing in `assets/art/PROVENANCE.md` and the `*.json` sidecars.
- `assets/fonts/` — Audiowide and Michroma (OFL).
- `assets/demo/` — the demo record and its provenance.
- `PRODUCT.md`, `DESIGN.md`, `.impeccable/` — product truth, the design system, and the surface brief.

## Running locally

Any static server from the repo root, e.g. `python3 -m http.server 8765`. ES modules and workers need http(s), not `file://`. Tab-audio capture and Cache Storage need a secure context (localhost counts).

## QA

- `tests/smoke.mjs` (Playwright): loads the demo through the UI, checks analysis (BPM, beat count, key), the quick split and melody, live playback state, sliders, presets, pattern keys, pads, pause/resume, offline render + WAV + MP3, mobile overflow, zero page errors. `NODE_PATH=/path/to/node_modules node tests/smoke.mjs` against a local server on port 8765; `PULL_WAV=/tmp/mix.wav` writes the rendered mix out for analysis.
- `tests/stems.mjs`: the mix gate — renders song-only / kit-only / both for 20 s and writes the three WAVs.
- `tests/neural.mjs`: the real Demucs path on a 40 s clip with the model served from a local copy (symlink it to `.impeccable/build/model.bin`, gitignored); takes ~6 minutes on 4 cores.
- Headless Chromium has no audio device, so the live AudioContext logs one device error there; the offline render is the real check.
