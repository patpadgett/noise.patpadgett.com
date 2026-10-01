# NOISE — turn any song into phonk

Drop a song, get phonk. One screen, no account, nothing uploaded. Live at https://noise.patpadgett.com.

NOISE listens to the song in your browser, finds the tempo, the beats and the key, slows the record down, and lays a phonk kit on top: half-time kick and snare, hats, a sliding distorted 808 that follows the song's key, and a cowbell hook. You get a few presets and five sliders, then save it as MP3, WAV or a vertical video for Reels/TikTok.

Everything is static: `index.html`, `noise.css`, `js/*.js`, one vendored MP3 encoder, two self-hosted fonts, two in-house rendered art plates and one public-domain demo record. No build step, no backend. Audio never leaves the device.

## Ways in

- Drop or browse an audio or video file (MP3, WAV, M4A, FLAC, MP4…). Decoded with `decodeAudioData`.
- Paste a YouTube link. The video is embedded; press PHONK IT and pick this tab with "Share tab audio" — NOISE records the video through once (`getDisplayMedia`), then converts the recording. Browsers do not let a web page download YouTube audio, and NOISE has no server, so recording is the honest path. Chrome and Edge on desktop support tab audio capture; others get a message pointing to RECORD THE ROOM or a file.
- Paste a Spotify link. Spotify only exposes the title and cover through oEmbed, so NOISE shows the song and says plainly that it cannot fetch Spotify audio; play it on a speaker and use RECORD THE ROOM, or drop the file.
- RECORD THE ROOM: microphone capture for anything playing out loud.
- TRY ONE: "Fare Thee Honey Blues", Mamie Smith and her Jazz Hounds, 1920 (public domain, see `assets/demo/SOURCE.md`).

## What it does to the song

1. `js/analyze.worker.js` (Web Worker) — downsample to 22.05 kHz, 6-band log spectral flux onsets, autocorrelation tempo with the octave settled into 70–100 BPM for the half-time feel, Ellis-style dynamic-programming beat tracking, downbeat phase from low-band energy, Krumhansl–Schmuckler key from a chroma profile, per-beat loudness for the drop detection.
2. `js/phonker.js` `arrange()` — turns that analysis plus the slider values into a bar list and an event list in source time: kick/snare/hat pattern per bar (with pattern variations and fills), 808 notes in the song's key (root, fifth, flat-two slides for the drift flavor), cowbell hook, and optional "flips" (reversed/stuttered bars of the source). The same function drives live playback and the offline render, so what you hear is what you save.
3. `js/kit.js` — the kit, synthesized with the Web Audio API against any `BaseAudioContext`: `Drums` (kick, snare, clap, hats, rim, crash with shared per-lane filters so a 4-minute render stays light), `Bass808` (pitch-snap attack, hold-until-release envelope, glide, drive, sub octave), `Cowbell` (two squares + stack detune + grit + hall), `Tape` (saturation, tone, wow/flutter, hiss, compressor, limiter).
4. Export — `js/export.js`: WAV (PCM16), MP3 (bundled `vendor/lamejs.js`, LGPL, licence alongside), vertical 1080×1920 video drawn on a canvas with the Countach plates and a live spectrum, muxed with `MediaRecorder`. Long songs are rendered in 32-second windows and crossfaded so the offline context never carries more than a few hundred events.

Presets: DRIFT (slower, big 808, flat-two slides), MEMPHIS (brighter, bit-crushed drums, more flips), BRAZILIAN (barely slowed, 808 forward, few flips). Sliders: SLOW, 808, COWBELL, GRIT, FLIP. REROLL reseeds the arrangement.

## Code layout

- `js/noise.js` — the one controller: intake → analysis → player → export, toasts, spectrum, seek bar, slider fill.
- `js/input.js` — link parsing (YouTube/Spotify/audio URL), oEmbed metadata, tab and mic recorders, mono mixdown.
- `js/analyze.worker.js`, `js/phonker.js`, `js/kit.js`, `js/export.js` — as above.
- `vendor/lamejs.js` + `vendor/LAMEJS-LICENSE` — `@breezystack/lamejs` 1.2.7 (LGPL-3.0).
- `assets/art/` — Countach hero and pin-up poster, generated locally with ComfyUI + Flux Schnell; prompts, seeds and post-processing in `assets/art/PROVENANCE.md`.
- `assets/fonts/` — Audiowide and Michroma (OFL).
- `assets/demo/` — the demo record and its provenance.

## Running locally

Any static server from the repo root, e.g. `python3 -m http.server 8765`. ES modules and workers need http(s), not `file://`. Tab-audio capture needs a secure context (localhost counts).

## QA

`tests/smoke.mjs` (Playwright): loads the demo through the UI, checks analysis (BPM, beat count, key), live playback state, slider and preset changes, pause/resume, offline render + WAV + MP3 encode, mobile overflow. Run against a local server on port 8765: `NODE_PATH=/path/to/node_modules node tests/smoke.mjs`. Headless Chromium has no audio device, so the live AudioContext logs one device error there; the offline render is the real check.
