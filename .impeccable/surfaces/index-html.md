---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: []
---

# Surface: index.html (CUE — the one screen)

Scope: the whole app is one route with three states: NO SOURCE (load), ON AIR (treatment + preview), RENDER (footage jobs + export). Visitor mode: Operate.

Audience: a musician with a bounced mix and pasted lyrics, not a video editor. Job: get a music video they would post, after reading and approving a cue sheet they recognise as their song. Action: LOAD → paste words, optionally a one-line DIRECTION (place, time of day, look) → read/edit cues → RENDER (FREE; the hours of GPU time shown) → RETAKE any scene alone → EXPORT 9:16 or 16:9. Proof/content: the song's own analysis (tempo, bars, sections, drops), its lyrics aligned to the singing (used for anchors, never shown on screen), the cue sentences, the AI footage. Constraints: static GitHub Pages; Azure direct mode (owner key in browser) for the cue sheet; footage from the owner's own render box (Wan 2.2 5B on a Tesla T4: 1280×704, clips of 1–5 s, one at a time, ~6 min per 5 s clip on the Turbo model — a song is a couple of hours, the queue lives on the box so the tab can close); strobe warning + no-strobe variant; the video carries no text.

## Direction contract

THESIS: Your song goes on air. The cue sheet is a broadcast running order on a gallery desk under a monitor wall, every row anchored to a musical event the app found (bar 17 · 2nd chorus · bass drop) and written as a sentence a director would call. It refuses the category default (dark AI editor: preview centre, timeline strip, prompt box, purple Generate) and its opposite (a pitch-deck of pretty stills with timings in the margin).

OWN-WORLD: Gallery grey panels (#1c1f24 / #2a2e35) with pixel-crisp 1 px hairlines and no glow; rundown rows on paper (#f4f1ea, ink #141414); exactly three saturated colours in the interface, each meaning one thing: tally red #e3262b = on air now (and nothing else), tally green #22b35a = next (and nothing else), amber #f0b429 = timecode, countdown, standby, warnings and failures (everything that asks for attention without being on air). Two type sizes only: clock values (TC, BAR, NEXT CUE, SECTION, the wordmark, the drop prompt) in a condensed grotesk at 28–40 px, everything else at 14 px; rank by weight, case and tally colour. The PGM is the one large monitor; the four PVW monitors are identical to each other in size; duration is printed as a number, never drawn as a width. Broadcast media shown INSIDE a monitor (colour bars in NO SOURCE, the generated footage, authored light cues) is picture, not interface, and is exempt from the three-colour rule. Controls are desk buttons: square, labelled, lit when active.

STORY: The visitor understands the app listened to their song (the clock counts bars, the rows name sections and drops), believes the treatment is theirs (their lines named in the anchors, their direction in every shot, their drop at the right second), and acts: edits a sentence, presses RENDER knowing the dollar figure, retakes the one scene they dislike, exports.

FIRST VIEWPORT (1440 wide): a 16:9 PGM monitor at left (two-thirds width, red tally border while playing) showing the footage with the light cues over it and no text; to its right a 2×2 stack of PVW monitors (next four scenes, the next one green-bordered), each with its scene number and IN time; under the wall, the clock strip: TC 01:12:08 · BAR 017.2 · NEXT CUE −00:04 · section name; below, the running order fills the rest: # | IN | CUE | SRC (VT footage / LX lighting, with a RETAKE key on VT rows once a desk is open) | DUR | tally. Primary action RENDER (with "$18.40") sits at the right end of the clock strip as a lit desk button; LOAD is the only button in NO SOURCE state, which shows colour bars in PGM and the text NO SOURCE. Mobile (390): PGM full width, clock under it, running order as stacked rows, PVW wall folded into a horizontal strip of four.

FORM: Direction 5 of 7 on my grounded list ("The Gallery"), assigned by seed key 162a59d2 (mode operate, code-led). Raises: DATA-FIELD → hairlines, no glow, reduced-motion parks every blink and freezes strobe previews. BOTANICAL FOLIO → monitors identical in size, duration numeric. TIMETABLE → two type sizes, rank by weight/case/tally. Signature interaction: the tally handoff — at each cue's IN time the PVW monitor's green border snaps to red and the PGM cuts, the row's tally chip goes red, the previous row's goes grey; NEXT CUE counts down in amber. Motion grammar: cuts are instant (0 ms); NEXT CUE counts down in beats and ticks on the beat grid; nothing in the interface eases except the LOAD progress bar; the authored picture (light cues) is video, not interface motion, and under reduced motion the live monitor holds each light cue at a steady level while the export stays as authored.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
