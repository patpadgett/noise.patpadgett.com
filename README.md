# CUE

Drop a song, paste its lyrics, say in a line where the video lives, get a music video. CUE listens to the music (tempo, bars, key, loudness per bar), reads the lyrics (aligned to where the singer sings them; they are never shown on screen), writes a cue sheet a director would call, and plays it on a broadcast-gallery screen: a PGM monitor with every light cue exact to the beat, four PVW monitors showing the next scenes, a clock with timecode, bar:beat and a NEXT CUE countdown, and the running order on paper. RENDER generates every scene's footage on the owner's own GPU for nothing; RETAKE renders one scene again on its own; EXPORT writes the finished video, 16:9 or 9:16.

Live: https://noise.patpadgett.com (the demo needs no keys).

## How the video is made

Everything runs in the browser except three calls, all behind `js/engines.js`:

| Step | Service | What it does | Cost (demo song, 3 min) |
|---|---|---|---|
| Hear the singer | **Azure AI Speech — fast transcription** (`/speechtotext/transcriptions:transcribe?api-version=2025-10-15`, `wordLevelTimestampsEnabled`) | Word timestamps for the vocal; `js/align.js` pins each pasted lyric line to its second (banded DP alignment, forgiving of sung-vocal errors; lines it cannot pin are interpolated and flagged *estimated*) | ≈ $0.02 |
| Write the treatment | **Azure OpenAI — `gpt-6-astra` via the Responses API** with a strict JSON schema (`js/treatment.js`) | From tempo, bar starts, per-bar loudness, key, lyrics, line timings and the artist's one-line DIRECTION (place, time of day, look — "Jakarta at night, monsoon rain"): sections, a palette, and as many cues as the music asks for, of two kinds: **scene** (a footage prompt in the song's style that honours the direction) and **light** (strobe / pulse / flash / wash / blackout / flicker with a rate in hits per beat and a colour). Scenes are capped in length (12 s — `MAX SCENE` is stated in bars at the song's tempo), never in number; a 3-minute song is typically 25–45 scenes. Every cue names its anchor: *Bar 44 loudness rise from 0.45 to 0.63*, *Bar 22 landing of "I'm leaving here today"*. The lyrics are read for mood and anchors; no text is ever put on the picture | ≈ $0.05 |
| Footage | **The owner's render box** — `render/cue_render.py`, Wan 2.2 TI2V-5B (Apache-2.0, open weights) through ComfyUI on a Tesla T4, behind nginx + Let's Encrypt at `render.patpadgett.com` | One job per scene, 1–5 s at the scene's exact length (a scene over 5 s plays its clip slowed; `normalizeTreatment` caps scenes at 12 s), native 1280×704 at 24 fps, landscape or portrait, the 4-step Turbo distillation by default (`CUE_RENDER_MODE=quality` for the slower, steadier base model). The whole sheet is queued at once with idempotent keys and the queue is persisted on the box, so the browser can close and the render carries on. The session (song, analysis, words, direction, sheet, open desk) is saved in the browser too: the load screen offers **RESUME**, and loading the same file again does the same — the desk comes back and re-attaches to the same jobs by key, nothing is rendered twice. If a clip stalls on the box (3× its expected time), the box interrupts it and retries, three times, then shows the reason on the desk; nobody touches the ComfyUI queue. Clips are cached in IndexedDB per song + scene + size + model + prompt. RETAKE re-renders one scene alone | **$0** · about 6 minutes of GPU per 5-second clip (the demo's 26 scenes ≈ 2½ hours; ~10 h on the base model) |

The lights cost nothing: `js/switcher.js` draws them on a canvas from the beat grid (`lightLevel()` is a pure function of song time and the cue), so a 14-second strobe after the bass drop is exactly 14 seconds and exactly on the hats. The same `drawFrame()` renders the live PGM monitor, the PVW thumbnails, and every frame of the export.

### Why this engine, measured

Sora 2 (the original footage engine) was retired by Microsoft on 2026-10-15. Everything below was measured on this project's own box — an Azure VM with a Tesla T4 (16 GB, fp16 only) — on 2026-10-02; the frames were assessed blind, not eyeballed:

| Candidate | Result on the T4 |
|---|---|
| **Wan 2.2 TI2V-5B Turbo** (4-step DMD distillation, fp16 repack) on its trained t=1000/750/500/250 schedule, LCM, no CFG, **shift 8** | Native 1280×704/24 fps, **~6 min per 5 s clip**. Sharper and brighter than the base model; busier — objects drift between frames, a figure or face can wander in, prompt restraint is weaker — so more RETAKEs. **This is the engine** (owner's choice: speed; a 26-scene sheet is ~2 h instead of ~10). Shift 5, the training value, came out as unresolved noise on this card; the LoRA-on-base and euler variants too. |
| Wan 2.2 TI2V-5B base, fp16, 20 steps, CFG 5 | ~25 min per 5 s clip. Softer and darker, temporally steadier, period mood closer. `CUE_RENDER_MODE=quality` on the box. Text still wrong ("COPEN"). |
| Wan 2.1 1.3B at 832×480 then Real-ESRGAN ×2 + RIFE ×2 | 2–4 min per second. Upscaling a blur-limited 480p frame does not produce HD: waxy surfaces, halos, no texture. RIFE's 16→32 fps did give fluid motion. Native 720p from the 5B model beat it clearly. |
| MiniMax H3 (33B + 32B text encoder), LTX-2.5 (22B + 12B encoder) | Better models, but no official file fits 16 GB; community Q3/Q4 GGUFs would run slowly with the text encoder on CPU and likely below the 5B model at full precision. |
| Kling 3.0 / Seedance via Higgsfield, a rented A100 | Faster and (Kling, Seedance) better, for money. The engine layer still carries them (`MODELS` in `js/engines.js`, mocked in `tests/render.mjs`) so they are a key away; the owner chose to run free. |

### Running the render box

```
# the GPU worker and the job server, as user services (survive reboots; loginctl enable-linger); render/restart-box.sh restarts both cleanly
cp render/comfyui.service render/cue-render.service ~/.config/systemd/user/ && systemctl --user daemon-reload
printf 'CUE_RENDER_TOKEN=%s\n' "$(head -c 24 /dev/urandom | base64 | tr -d /+=)" > ~/.config/cue-render/env && chmod 600 ~/.config/cue-render/env
systemctl --user enable --now comfyui cue-render
# TLS in front of it, so a GitHub-Pages (https) site may call it: DNS A record render.patpadgett.com → this VM, then
sudo cp render/nginx-render.conf /etc/nginx/sites-available/render.patpadgett.com && sudo ln -s /etc/nginx/sites-available/render.patpadgett.com /etc/nginx/sites-enabled/ && sudo certbot --nginx -d render.patpadgett.com
```

Models in ComfyUI: `diffusion_models/Wan2_2-TI2V-5B-Turbo_fp16.safetensors` (Kijai/WanVideo_comfy, from quanhaol/Wan2.2-TI2V-5B-Turbo) and `wan2.2_ti2v_5B_fp16.safetensors` (Comfy-Org/Wan_2.2_ComfyUI_Repackaged), `text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors`, `vae/wan2.2_vae.safetensors`, plus `render/comfy_custom_nodes/cue_dmd_sigmas.py` copied into `custom_nodes/` (the Turbo schedule). The job API (`POST /jobs`, `GET /jobs/{id}`, `GET /jobs/{id}/video`, `GET /health`; `Authorization: Bearer`) answers CORS for the site's origin. One job renders at a time; the queue lives in `~/.cache/cue-render/jobs.json`, finished clips are kept 24 h.

In the site: SETUP → engine *This GPU* → the box URL and token. The RENDER key reads FREE; the desk line gives the queue time. Visitors without the token get the demo (its cue sheet is checked in); the owner's Azure keys for the cue sheet live in `localStorage` only.

### What a render costs

Nothing in money; time on the GPU. The RENDER key shows the clip count; the desk line says how long the sheet is (from the rate the box itself reports) and the tiles show their place in the queue and an ETA. Clips are cached per scene, size, model and prompt, so re-rendering after editing one cue only renders that scene, and switching 16:9 → 9:16 renders a second set. RETAKE (on a scene's tile or its running-order row) renders that one scene again and touches nothing else; STOP submits nothing new; RENDER on an open desk resumes it and retries failures. If a clip fails, the FOOTAGE line names the reason in full.

## Files

- `index.html`, `cue.css` — the gallery: monitor wall, clock strip, running order, render desk, SETUP dialog with the engine picker.
- `js/cue.js` — controller (load → analyse → lyrics → cues → play → render → export).
- `js/analyze.worker.js` — tempo (autocorrelation + prior), beats (Ellis DP), downbeats, key (Krumhansl–Schmuckler), loudness per beat.
- `js/align.js` — lyric line ↔ transcript word alignment.
- `js/treatment.js` — the system prompt and JSON schema the treatment model fills; `tools/build-demo-cues.mjs` runs it to produce `assets/demo/cues.json`.
- `js/switcher.js` — timeline, light envelopes, clip rate (a clip shorter than its scene plays slowed), `normalizeTreatment()` (splits any scene over 12 s into consecutive scenes; the count is never capped), `drawFrame()`.
- `js/engines.js` — the footage engines behind one interface (`plan / create / status / fetch / probe`): the GPU render box (this box, or a second one), Higgsfield (Kling 3.0, Wan 2.6, Seedance 2.5), Sora until it retired; the Azure Speech + Responses client; `MODELS` with each engine's lengths, resolutions and per-second price; `planClip()` (exact whole-second clips) and `estimateCost()`. `js/azure.js` re-exports it for older imports.
- `js/footage.js` — the render job (RENDER / STOP / resume / per-scene RETAKE; whole-sheet submission with idempotent keys on the GPU engine), IndexedDB clip cache and session store (RESUME), export (WebCodecs MP4 when `vendor/mp4-muxer.mjs` is present, else MediaRecorder WebM).
- `render/` — `cue_render.py` (the job server; ComfyUI backend here, a diffusers backend for any other CUDA box; stall watchdog + retries), `comfyui.service`, `cue-render.service`, `nginx-render.conf`, `install-tls.sh`, `restart-box.sh` (clean restart of both services), `restart-between-jobs.sh` (restart the job server without losing a running clip).
- `api/` — Static Web Apps Functions proxy (Azure, Higgsfield, render boxes) with daily caps, for a public deployment that pays for visitors; unused on GitHub Pages.
- `assets/demo/` — "Fare Thee Honey Blues", Mamie Smith & Her Jazz Hounds (1920, public domain) and its generated cue sheet (written to the demo's own direction line, "a rented room and a small-town railway station, 1920…"); `js/demo-lyrics.js` the transcribed lyrics.
- `tests/unit.mjs` — no browser: the scene cap at five tempos, the splitter, every engine's clip planner and price, the prompt's numbers. `tests/smoke.mjs` — Playwright: demo loads, clock runs, tally hands off, strobe envelope toggles and softens under NO STROBE, an injected clip plays through the switcher, export writes a file, no overflow at 390. `tests/render.mjs` — the render desk against mocked engines: exact-length clips, direction and idempotency key on every create, a failure's full reason on the desk, retry only the failures, RETAKE one scene, an nsfw refund not counted as spent, STOP/resume, engine switch rebuilds the desk from that engine's cache, the GPU engine submits the whole sheet, Sora's 4/8/12. `tests/resume.mjs` — the desk survives the tab: a song is loaded, rendered on a mocked box, the tab is closed mid-render; a new tab's RESUME brings back song, sheet, direction and desk with the same job ids and no new creates, finishes the set; the same file loaded again comes back from the cache; a rewritten sheet drops the old desk; the demo is never saved. `tests/live-gpu.mjs` — the real site against the real render box: three scenes rendered on the T4 and drawn through the switcher. `tests/live.mjs` — the deployed origin. `tests/overflow.mjs` lists anything wider than the phone viewport.
- `PRODUCT.md`, `DESIGN.md`, `.impeccable/` — product truth, the design system, the surface brief.

## Running locally

Any static server: `python3 -m http.server 8766` then `node tests/unit.mjs && NODE_PATH=/data/pat/node_modules node tests/smoke.mjs && NODE_PATH=/data/pat/node_modules node tests/render.mjs`. The demo cue sheet is checked in, so the demo plays without keys; RENDER needs the render box. `tools/build-demo-cues.mjs` regenerates the demo sheet (needs the owner's Azure CLI login).

## Accessibility

Strobes are a photosensitivity risk. Any treatment with strobes shows the amber STROBE EFFECTS flag on the PGM; the NO STROBE switch swaps every strobe for a pulse at or under one hit per beat, in the live view and the export. `prefers-reduced-motion` removes the UI transitions. The running order is a real table, every cue sentence is editable text, the clock values have labels. The video carries no burned-in text; add the lyrics as a caption track where you publish.
