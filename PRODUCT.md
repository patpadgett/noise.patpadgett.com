# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Bedroom producers, phonk/drift-video editors and people who just want to hear their favourite song as phonk. They arrive with one song (a file, a YouTube link, or something playing in the room), on a laptop or a phone, with no DAW knowledge and no patience for a rack of plugins. The job: get a phonk version of this song that still sounds like this song, and take the file away (MP3 / WAV / vertical video).

## Product Purpose

NOISE turns any song into phonk, entirely in the browser. It separates the record into stems, reads its melody, re-pitches the tonal stems into a minor key, chops the record back together over a new half-time phonk beat with cowbells and phonk ear-candy, and exports the result. Success: the exported file is recognisably the original song and reads as phonk on first listen.

## Positioning

Every "phonk remix" tool either slaps a drum loop under the untouched song or renders a synth bassline the owner hates. NOISE's mechanism is: neural stem separation (Demucs v4, WASM) + melody reading + minor-key transposition of the song's own instruments + a sampler-style re-chop of the song itself (Recycle / Dr. Octo Rex lineage: slice, re-order, re-pitch the original material). No synthesized bass melody of any kind. The only added voices are drums, bells and chops of the source.

## Operating Context

- Static GitHub Pages site at https://noise.patpadgett.com, no backend; audio never leaves the device.
- Intake: file drop, YouTube link via tab-audio capture (real-time), microphone ("record the room"), Spotify title only. One public-domain demo (Mamie Smith, 1920).
- Separation downloads the ~80 MB Demucs v4 model on first use (cached by the browser) and runs for minutes per song on CPU; the user must see honest progress and be able to carry on with a fast path while waiting.
- Export: MP3 (bundled lamejs), WAV, 1080×1920 video for Reels/TikTok.

## Capabilities and Constraints

- Analysis: tempo, beats, downbeats, key, chroma, per-beat loudness (Web Worker). Melody reading operates on the separated vocal/other stems.
- Separation: Demucs v4 htdemucs 4-stem (drums / bass / other / vocals) via demucs.cpp compiled to WASM (MIT); weights are Meta's Demucs weights (MIT). Single-threaded WASM runs ~13–19× slower than real time per core; work is split across Web Workers (one per core). A 3-minute song takes roughly 3–8 minutes on a 4–8 core laptop.
- Pitch processing: tonal stems re-tuned to the relative/parallel minor using granular/phase-vocoder style pitch shifting in the browser; drums stem is never pitched.
- Owner's hard rule: NO synthesized 808 or bass synth of any kind. The kit is drums (kick/snare/clap/hats/rim/crash), cowbell/bell hook, and the song's own chopped slices. Phonk ear-candy (tape stop, vinyl crackle, stutters, reversed slices) is welcome.
- Original-song presence is a measured gate: the source must lead the 800–3 kHz band by ≥ 3 dB over the kit in the exported mix.
- Half-time phonk tempo band 70–100 BPM after slowing; slowing and pitch-drop move together (tape style).
- Limits: refuse > 12 minutes, refuse silent input, say plainly that Spotify audio cannot be fetched.

## Brand Commitments

- Name: NOISE. Tagline: "Drop a song. Get phonk."
- Owner-pinned art direction carried from v2/v3: synthwave neon, Lamborghini Countach, bikini pin-up; laser magenta + electric cyan on midnight violet; Audiowide + Michroma. Rendered plates live in `assets/art/` with provenance.
- Owner-pinned interface lineage for this version: Propellerhead ReCycle (waveform slicer with slice markers) and Dr. Octo Rex (loop player with slice pads) — as a PHONK-ified homage, not a clone. Music hardware/software that looks like it does something.
- Visible copy is client-facing only: never process notes, never "this design…" meta text.
- No account, no upload, no tracking.

## Evidence on Hand

- Working v3 codebase: `js/analyze.worker.js` (beat/key), `js/phonker.js` (arranger/player/renderer), `js/kit.js` (synth kit), `js/export.js`, `js/input.js`.
- Demucs WASM build evidence: `demucs_free.wasm` (564 KB) from sevagh/free-music-demixer @8229982d (MIT), model `ggml-model-htdemucs-4s-f16.bin` (84.0 MB) from huggingface Retrobear/demucs.cpp. Measured on this machine: 12 s stereo in 160 s (13.3× RT), 30 s chunk in ~570 s at ~2.2 GB RSS per worker.
- Demo record: `assets/demo/fare-thee-honey-blues-1920.mp3` (public domain, SOURCE.md).
- No testimonials, no user counts, no benchmarks beyond the measured ones above; do not invent any.

## Product Principles

1. The song leads. Everything added sits under the record; nothing added replaces it.
2. The genre must read in one listen: slowed, half-time, cowbell hook, minor, chopped.
3. Honest time. Separation is slow; say how long, show real progress, offer a fast path meanwhile.
4. Nothing synthesized that pretends to be music the song didn't have. Drums and bells only; melody comes from the record.
5. Judge by the exported file, measured.
