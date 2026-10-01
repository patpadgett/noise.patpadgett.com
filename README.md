# CUE

Drop a song, paste its lyrics, get a music video. CUE listens to the music (tempo, bars, key, loudness per bar), reads the lyrics (aligned to where the singer sings them), writes a cue sheet a director would call, and plays it on a broadcast-gallery screen: a PGM monitor with every light cue and lyric exact to the beat, four PVW monitors showing the next scenes, a clock with timecode, bar:beat and a NEXT CUE countdown, and the running order on paper. RENDER generates every scene's footage with Sora 2 on Azure; EXPORT writes the finished video, 16:9 or 9:16.

Live: https://noise.patpadgett.com (the demo needs no keys).

## How the video is wired up with Azure

Everything runs in the browser except three Azure calls, all behind `js/azure.js`:

| Step | Azure service | What it does | Cost (demo song, 3 min) |
|---|---|---|---|
| Hear the singer | **Azure AI Speech — fast transcription** (`/speechtotext/transcriptions:transcribe?api-version=2025-10-15`, `wordLevelTimestampsEnabled`) | Word timestamps for the vocal; `js/align.js` pins each pasted lyric line to its second (banded DP alignment, forgiving of sung-vocal errors; lines it cannot pin are interpolated and flagged *estimated*) | ≈ $0.02 |
| Write the treatment | **Azure OpenAI — `gpt-6-astra` via the Responses API** with a strict JSON schema (`js/treatment.js`) | From tempo, bar starts, per-bar loudness, key, lyrics and line timings: sections, a palette, and 30-ish cues of three kinds: **scene** (a Sora prompt in the song's style), **light** (strobe / pulse / flash / wash / blackout / flicker with a rate in hits per beat and a colour), **lyric** (which lines, how). Every cue names its anchor: *Bar 44 loudness rise from 0.45 to 0.63*, *Bar 22 landing of "I'm leaving here today"* | ≈ $0.05 |
| Footage | **Azure OpenAI — Sora 2** (`POST /openai/v1/videos` → `GET /videos/{id}` → `GET /videos/{id}/content`), deployment `sora-2`, GlobalStandard, eastus2 | One job per scene, 4–20 s, 720p landscape or portrait, two in flight (preview limit), polled every 4 s, cached in IndexedDB per song+scene+size | ≈ $0.10 per generated second → **$18.90** for 12 scenes / 189 s |

The lights and lyrics cost nothing: `js/switcher.js` draws them on a canvas from the beat grid (`lightLevel()` is a pure function of song time and the cue), so a 14-second strobe after the bass drop is exactly 14 seconds and exactly on the hats. The same `drawFrame()` renders the live PGM monitor, the PVW thumbnails, and every frame of the export.

### Setting it up on your own Azure

1. **Azure OpenAI / AI Foundry resource** in a Sora region (eastus2 or swedencentral today). Deploy `sora-2` (GlobalStandard; idle cost zero) and a chat model (the app defaults to a deployment named `gpt-6-astra`; any Responses-API model with structured outputs works, set the name in SETUP). The v1 endpoint is `https://<resource>.openai.azure.com/openai/v1`. Sora 2 preview rules the prompts obey: no real people or faces, no copyrighted characters or music, no on-screen text; 720p only; 1–20 s; two concurrent jobs; jobs expire after 24 h.
2. **Azure AI Speech resource** (any region; the app needs the region name and a key).
3. Open the site → SETUP → *My Azure keys*: paste the OpenAI endpoint + key, the deployment names, the Speech region + key. TEST makes a `GET /videos?limit=1` and a one-second silent transcription. Keys live in `localStorage` only. CORS is open (`*`) on both services, which is why a static page can call them directly.
4. **Going public** (the owner's Azure pays): deploy the same tree to Azure Static Web Apps; `api/` is the managed Functions proxy (`/api/openai/*`, `/api/speech/transcribe`) with the keys in app settings and daily caps (`CUE_DAILY_SECONDS`, `CUE_VISITOR_SECONDS`). Visitors pick *Site proxy* in SETUP (or make it the default by shipping `cue.azure.v1 = {"mode":"proxy"}`). Move the in-memory caps to Table Storage before real traffic.

### What a render costs

The RENDER key shows it before you press it: scenes × their lengths × $0.10/s. A 3-minute song with 8-bar scenes is 12–14 clips, $15–20. Clips are cached per scene and size, so re-rendering after editing one cue only pays for that scene, and switching 16:9 → 9:16 renders a second set.

## Files

- `index.html`, `cue.css` — the gallery: monitor wall, clock strip, running order, render desk, SETUP dialog.
- `js/cue.js` — controller (load → analyse → lyrics → cues → play → render → export).
- `js/analyze.worker.js` — tempo (autocorrelation + prior), beats (Ellis DP), downbeats, key (Krumhansl–Schmuckler), loudness per beat.
- `js/align.js` — lyric line ↔ transcript word alignment.
- `js/treatment.js` — the system prompt and JSON schema the treatment model fills; `tools/build-demo-cues.mjs` runs it to produce `assets/demo/cues.json`.
- `js/switcher.js` — timeline, light envelopes, kinetic lyrics, `drawFrame()`.
- `js/footage.js` — Sora job pool, IndexedDB clip cache, export (WebCodecs MP4 when `vendor/mp4-muxer.mjs` is present, else MediaRecorder WebM).
- `js/azure.js` — the only module that talks to Azure; direct and proxy modes.
- `api/` — Static Web Apps Functions proxy with usage caps. `staticwebapp.config.json`.
- `assets/demo/` — "Fare Thee Honey Blues", Mamie Smith & Her Jazz Hounds (1920, public domain) and its generated cue sheet; `js/demo-lyrics.js` the transcribed lyrics.
- `tests/smoke.mjs` — Playwright: demo loads, clock runs, tally hands off at the bar-14 cues, strobe envelope toggles and softens under NO STROBE, an injected clip plays through the switcher, export writes a file, no overflow at 390. `tests/overflow.mjs` lists anything wider than the phone viewport.
- `PRODUCT.md`, `DESIGN.md`, `.impeccable/` — product truth, the design system, the surface brief.

## Running locally

Any static server: `python3 -m http.server 8766` then `NODE_PATH=/data/pat/node_modules node tests/smoke.mjs`. The demo cue sheet is checked in, so the demo plays without Azure; RENDER needs keys.

## Accessibility

Strobes are a photosensitivity risk. Any treatment with strobes shows the amber STROBE EFFECTS flag on the PGM; the NO STROBE switch swaps every strobe for a pulse at or under one hit per beat, in the live view and the export. `prefers-reduced-motion` removes the UI transitions. The running order is a real table, every cue sentence is editable text, the clock values have labels.
