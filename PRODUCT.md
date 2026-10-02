# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

static HTML/CSS/JS on GitHub Pages for v1 (user's choice), with the Azure calls behind one small client module that has two modes: `direct` (the owner's Azure endpoint + key, entered once, kept in the browser) and `proxy` (the same calls through `/api/*`). The proxy (Azure Static Web Apps + Functions, per-visitor and global usage caps) is written into the repo under `api/` so the switch to public is a deploy, not a rewrite. No build step, no framework.

## Users

Primary: a musician, band or bedroom producer with a finished song and its lyrics who needs a music video for a release, to post to Reels/TikTok (9:16) and YouTube (16:9). They are not video editors; they know their song bar by bar and can say in words what should happen where ("strobes for 14 seconds after the bass drop into the second chorus"). They are at a laptop with the mix bounced and the lyrics in a text file.

Stated goal: public from day one, the owner's Azure paying, so a stranger with a song must get a result without a tutorial.

## Product Purpose

CUE turns a song plus its pasted lyrics into a finished music video. It listens to the music (tempo, beats, bars, sections, key, energy, drops), reads the lyrics (aligned to the singing, stanzas, which lines repeat), writes a treatment in plain English cues tied to musical moments, generates the footage for every scene with AI, and plays and exports the finished video with every effect exact to the beat. Success: a first-time visitor drops a song and lyrics, reads a treatment they recognise as their song, presses render, and leaves with a video they would actually post.

## Positioning

The cue is the unit. Other tools give a prompt box and a timeline; CUE writes and executes a cue sheet in the language of a lighting director and a video director, every cue anchored to a musical event the app found (a bar, a drop, the start of the second chorus, the word a line lands on), and every cue is a sentence a musician can read, edit and approve before any money is spent on footage.

## Operating Context

- Input: one audio file (MP3/WAV/M4A/FLAC), the lyrics pasted as text with blank lines between stanzas, and an optional DIRECTION: a few words from the artist on where and when the video lives and its look ("Jakarta at night, monsoon rain"), which every shot honours. A demo song, lyrics and direction are built in.
- Analysis runs in the browser (Web Audio + a worker): tempo, beat grid, downbeats, key/mode, per-band energy, section boundaries, drop detection. Lyrics are aligned to the vocal with Azure AI Speech fast transcription (word timestamps) plus text alignment of the pasted lyrics; repeated stanzas identify the chorus. The lyrics inform the treatment (mood, story, which line a cue lands on); they are never shown on screen — the video carries no text (owner decision, 2026-10-01).
- The treatment is written by an Azure OpenAI chat model (gpt-6-astra deployment) from the analysis, lyrics and direction, as structured JSON rendered as readable cues of two kinds: scene (footage) and light (an effect on the beat). Scenes are capped in LENGTH (12 s, stated to the model in bars at the song's tempo) and never in NUMBER: the model cuts wherever the music asks (owner decision, 2026-10-01), and `normalizeTreatment()` splits any scene it still writes too long. A 3-minute song is typically 25–45 scenes.
- Footage is generated on the owner's own GPU for nothing (owner decision, 2026-10-02: "cheapest; local GPU so we don't create a huge mess of needs"). `render/cue_render.py` runs Wan 2.2 TI2V-5B (open weights, Apache-2.0) through ComfyUI on the project's Tesla T4, behind nginx + Let's Encrypt at render.patpadgett.com; the static site calls it directly with a bearer token kept in the owner's browser. One job per scene, clips of 1–5 s at the scene's exact length (a longer scene plays its clip slowed), native 1280×704 at 24 fps, landscape or portrait, one clip rendering at a time, about 5 minutes of GPU per second of footage (a 3-minute song is an overnight render). The whole sheet is queued at once with idempotent keys and the queue is persisted on the box, so the browser may close. Any single scene can be re-rendered on its own (RETAKE); clips are cached per song, scene, size, model and prompt so nothing finished is rendered twice. Sora 2, the original engine, was retired by Microsoft on 2026-10-15. Paid engines (Kling 3.0 / Seedance via Higgsfield, a second render box) remain in the engine layer behind a SETUP picker, unused.
- Effects (strobes, flashes, colour washes, cuts) are drawn live in the browser against the beat grid; they are free and exact.
- Export: 9:16 or 16:9, chosen at export, MP4 via WebCodecs where available, WebM via MediaRecorder otherwise, rendered in the browser from the clips, effects and the original audio.

## Capabilities and Constraints

- Static hosting: the site is files on GitHub Pages; the only server is the owner's render box, which keeps the job queue and finished clips for 24 h. All other state is in the browser (IndexedDB for clips, localStorage for settings). A render survives a reload — or the laptop closing — because the sheet is queued on the box under idempotent keys and re-attaches on reopen.
- The render box binds the product: 1280×704 only, clips of 1–5 s, one clip at a time, about 5 min of GPU per second of footage on the T4; the model (Wan 2.2 5B) still misspells on-screen text, so prompts ask for none. The distilled 4-step variant was measured and rejected on this card (noise); see README.
- Azure Speech transcription is imperfect on sung vocals; alignment must degrade gracefully (stanza-level timing when word-level fails) and the user can nudge a stanza's time.
- Owner mode holds the owner's Azure key in the browser; it must never be written into the repo or any exported file. Public mode routes through the proxy with caps.
- Undecided: pricing or caps for public use; account/login; whether finished videos are stored anywhere but the user's device.

## Brand Commitments

- Name: CUE (working title, owner may rename).
- Voice: plain, confident, spoken like a director calling cues; no AI hype, no process commentary on the page.
- The treatment must be real sentences with real timecodes, e.g. "1:12 — bass drop into the second chorus — strobes pulse with the hats for 14 seconds."
- Owner's standing preference (from prior projects): bespoke, art-directed imagery; never generic stock-style AI art; nothing that reads as a generic template.

## Evidence on Hand

- Demo record: "Fare Thee Honey Blues" — Mamie Smith & Her Jazz Hounds (1920), public domain, 2:45 (git history of this repo at 6a8594a, `assets/demo/`). Lyrics to be transcribed/verified for the demo.
- Owner's Azure: AI Foundry resource in eastus2 with gpt-6-astra, gpt-image-2, FLUX.2 deployments (Sora 2 was retired 2026-10-15); Speech resource in eastus. Owner's VM: Tesla T4 16 GB, ComfyUI 0.20.1, nginx + certbot, serving impetus.patpadgett.com; render.patpadgett.com to be pointed at it.
- No testimonials, customers, benchmarks or pricing exist; none may be invented.

## Product Principles

1. Every cue is anchored to a musical fact the app found and names (bar, drop, chorus, word), never to a bare timestamp.
2. Read before you pay: the whole treatment is legible and editable before any footage is generated, with the cost in dollars beside the render button.
3. The song's own structure is the interface: sections, stanzas and drops are the navigation.
4. Exact beats are free; spend the money on pictures. Effects are always beat-locked and local; AI footage is the paid layer, and it is paid for one scene at a time.
5. A render is a job that can be left and resumed; nothing a visitor made is lost to a reload.

## Accessibility & Inclusion

Strobe effects are a photosensitivity risk: every treatment that uses strobes shows a visible warning in the app and offers a one-switch "no strobe" variant that swaps strobes for pulses under 3 Hz; exports made with strobes carry the warning in the first frames' metadata text. Keyboard operation of the cue list and controls. The video carries no burned-in text, so captions are the publishing platform's job (upload the lyrics as a caption track).
