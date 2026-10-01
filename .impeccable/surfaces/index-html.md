---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: []
---

# Surface brief: index.html (the one screen)

Scope: the whole app, one screen with three states (intake, working, result). Visitor mode: Persuade on the intake (drop a song), Operate on the result (hear it, five knobs, save). Audience: people with one song who want it as phonk and want the file. Proof: the phonk version itself, playing, with the song's stems visibly separated and re-tuned. Constraints: static GitHub Pages, Web Audio only, Demucs v4 in WASM workers (~84 MB model, minutes per song), no synthesized bass of any kind, owner-pinned synthwave Countach art and ReCycle / Dr. Octo Rex lineage.

## Direction contract (code-led; seed key 7246be39, assigned index 4)

THESIS: The result is two phonk-ified Propellerhead devices sitting on the Countach dash: a ReCycle-style CHOP SHOP that shows the song cut into slices across its separated stems, and a Dr. Octo Rex-style REX DECK that plays those slices back under a new beat. It refuses the stem-separator web app (upload box, four toggles, download) and it refuses the plugin rack it replaced: one screen, presets, five sliders, one SAVE.

OWN-WORLD: Midnight violet ground, laser magenta and electric cyan as the two lights, brushed chrome for what the hand touches, black LCD strips with cyan seven-segment text for what reads. Device plates with rounded corners and a hairline seam; slice flags like ReCycle's numbered markers; square chrome pads like an MPC; eight numbered slot keys like Octo Rex's loop selector. Audiowide for wordmarks and readouts, Michroma for labels.

STORY: Drop a song. Within seconds it plays back slowed, half-time, in a minor key, with a cowbell hook that plays the song's own melody; the CHOP SHOP shows the song's quick split as hairlines. In the background the neural stems land region by region; the waveform turns solid and the DRUMS / BASS / OTHER / VOCALS lamps light as current reaches them. The listener tweaks five sliders, picks a preset, saves an MP3.

FIRST VIEWPORT (result): wordmark small at top; NOW PLAYING strip with the title, key change (e.g. "F major → F minor"), BPM, and the play button; CHOP SHOP device (stem waveform with slice flags, SENSITIVITY, stems progress with minutes left); REX DECK device (8 slot keys, 16 pads lit by the playhead, LCD readout of melody notes); presets, five sliders, SAVE.

FORM: the assigned grounded direction (devices-as-result) raised by the hand it beat: stems light as current reaches them (Kraftwerk); every wait state shows minutes left and one next choice (terminal wayfinding); quick-split renders hairline and goes solid when neural stems land (provenance ribbon); each pad is labelled with its bar:beat origin (memory quilt); LCD digits change in place and the grid never reflows while playing (split-flap); magenta and cyan multiply where stems overlap in the waveform (risograph).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Unresolved
- Mobile devices run one Demucs worker and a 3-minute song takes 20+ minutes; the quick split is the real mobile path.
