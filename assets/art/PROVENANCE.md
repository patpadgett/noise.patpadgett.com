# Artwork provenance

Both plates were generated locally with ComfyUI + Flux Schnell fp8 (workflow /data/comfy/workflows/flux_schnell_photoreal.json), 6 steps, euler/simple, 2026-09-30.

countach-source.png (1216x832, seed 47), web derivatives countach.webp / countach.jpg (1600w):
"1980s synthwave poster art, a white Lamborghini Countach LP5000 with the rear wing, low three-quarter rear view, parked on a wet neon-lit street at night, hot magenta and electric cyan neon reflections streaking across the wet asphalt and the car's flanks, a huge retro sun with horizontal black scanline stripes setting behind a purple gradient sky, a laser grid floor perspective fading to the horizon, palm tree silhouettes, chrome typography-free, VHS grain, airbrushed 1985 movie poster finish, ultra detailed, cinematic wide shot"
Post-process: the generated plate text and its puddle reflection were painted out with ffmpeg delogo (x252 y419 176x46 and x280 y748 116x52); the page places a PHONK plate overlay over the bumper region (App.placePlate).

pinup-source.png (832x1216, seed 88), web derivatives pinup.webp / pinup.jpg (1200h):
"1980s synthwave airbrushed pin-up poster art, a confident woman in a shiny hot-pink string bikini and mirrored aviator sunglasses leaning back against the door of a white Lamborghini Countach, one hand on the roof, big teased 80s hair, glossy skin lit by magenta and cyan neon, chrome and laser-grid backdrop, retro sun with scanlines behind her, Nagel-style airbrush illustration meets photoreal, full body in frame, night, VHS grain, Patrick Nagel and Miami Vice poster energy, ultra detailed"
Seed 5 was rejected (under-resolved left hand, signature gibberish).

pinup-cut-source.png (832x1216, seed 88, 2026-10-01), web derivatives pinup-cut.webp (643x1153, alpha) / pinup-cut.png (502x900, alpha) — the figure the page shows since v4:
"1980s synthwave airbrushed pin-up poster illustration, a confident woman in a shiny hot-pink string bikini and mirrored aviator sunglasses, standing full body, leaning back slightly with one hand adjusting her sunglasses, big teased 80s blonde hair, glossy tanned skin lit by magenta and cyan neon rim light, Patrick Nagel meets Miami Vice poster energy, ultra detailed, isolated on a completely flat solid bright green chroma key background, no scenery, no car, no sun, no grid, no floor, plain uniform #00ff00 green backdrop, full figure in frame with space above the head and below the feet"
Seeds 47 and 1313 rejected (47: head cropped at the top; 1313: backdrop not flat, car fragments returned).
Matte: rembg `isnet-general-use` ∪ `u2net_human_seg`, intersected with a relative green key ((G − max(R,B)) / G > 0.22, G > 40 — this also catches the shadowed olive green in the pockets between arm, hair and neck), largest connected component, hole fill that re-opens green holes, 1 px erosion, 0.8 px feather, green spill suppression (G −= 0.9·max(0, G − (R+B)/2)), edge colour pulled from the nearest opaque pixel. Recipe reproduced in the .json sidecars.
The earlier pinup.webp / pinup.jpg (figure on a scene plate, shown through a radial mask) are kept as source history only; the page no longer references them.
