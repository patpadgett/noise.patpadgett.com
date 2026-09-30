# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

static HTML/CSS/JS, no build step, Web Audio API; deployed to GitHub Pages at https://noise.patpadgett.com (CNAME). All instrument sounds are synthesized in-browser; no downloaded sample libraries. Confirmed by Patrick.

## Users

Primary: producers and beatmakers who want to make phonk in the browser. They arrive to make a beat, not to read about one. They know what a rack, a sequencer, a piano roll, an 808, a cowbell line, and a chopped sample are. Confirmed: a working instrument first, showcase second.

Secondary (unconfirmed): curious visitors who press play on the demo song and tweak it.

## Product Purpose

NOISE is a browser music workstation modeled loosely on Propellerhead Reason's rack metaphor, tuned for phonk: drum machines, step sequencers, a sampler that chops audio into slices (the Recycle/REX2 idea, feeding a Dr. Octo Rex–style slice player), and brand-new invented rack devices. It ships with a complete demo phonk song the user can manipulate, and it saves/loads whole songs as an open, readable file.

Success: a producer opens the page, hears the demo phonk track within one click, changes it, and downloads their own song file that reloads intact.

## Positioning

The only browser rack where the devices are invented for phonk rather than emulations of hardware, and where the whole song, including chopped audio, leaves as one readable open file.

## Operating Context

- Desktop browsers primarily (Chrome, Firefox, Safari); must also load and play on phones without breaking.
- Audio starts only after a user gesture (browser autoplay policy).
- No backend: everything runs client-side; saving is a file download; loading is a file open or drag-drop.
- Song format: JSON (`.noise.json`), with audio slices/samples embedded as base64 WAV data URIs (WAV decodes in every browser; MP3 encoding in-browser is not universally available).
- A piano roll / block editor lives at the bottom of the page and can detach into its own window (window.open + BroadcastChannel/postMessage), controlling drum machines, sequencers, and audio blocks.
- Audio chopping: the user records or loads audio, slices it (transient detection or manual/grid slicing), and plays slices from a slice player device.

## Capabilities and Constraints

Confirmed:
- Demo song: an original phonk track authored in-house (cowbell melody, 808 slides, Memphis-style drums, chopped stab/vocal-style hits) as the default state.
- Devices: drum machine(s), step sequencer(s), slice-based sampler with chopper, plus new wild devices (invented; not clones of existing Reason devices).
- Piano roll/block editor at the bottom; detachable.
- Save/download and load of the song in JSON with base64 WAV audio.
- Transport: play/stop, tempo, swing.

Constraints:
- No copyrighted samples; all sounds synthesized or user-supplied.
- Static hosting only; file sizes should stay reasonable (embedded audio kept to what the user chopped).
- Must not break on touch devices; full editing depth may be desktop-first.

Undecided:
- Whether MP3 export is offered in addition to WAV (only if a lightweight encoder is feasible).
- Exact device count.

## Brand Commitments

Name: NOISE (noise.patpadgett.com), a Patrick Padgett project. Patrick's instruction: "go fully wild — Reason is only a loose inspiration." The devices must be brand new, not skins of existing hardware or Reason devices. Terminology from the source world may be used generically (rack, sequencer, slice, REX-style loop), never trademarks as product names.

## Evidence on Hand

- Empty GitHub Pages repository at /data/pat/2_PUBLISHED/noise.patpadgett.com (README only).
- No logo, no imagery, no demo audio yet; the demo song will be authored as data within the app.
- No testimonials, users, or metrics exist; none may be claimed.

## Product Principles

1. Sound first: every control changes real audio, immediately.
2. Wild but legible: invented devices still read at a glance; label what each knob does.
3. Nothing leaves locked: the song file is readable JSON a human can open.
4. Phonk-authentic defaults: the demo and presets sound like the genre out of the box.
5. Zero install, zero backend: it works from a static page, offline once loaded.

## Accessibility & Inclusion

Keyboard-operable transport and step grid; visible focus; controls carry text labels/values (knobs expose their value as text, not only by rotation); respect prefers-reduced-motion for decorative motion; audio never autoplays.
