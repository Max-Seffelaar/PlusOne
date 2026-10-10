# Failure modes already met (Oct 2026)

Each row was a real generation. Diagnose against this list before guessing.

| Symptom | Cause | Fix |
|---|---|---|
| Video starts right, then jumps to another street / the character's portrait background | A scene image (REF-1 with its street) was attached as reference or end frame; the model morphs toward it | Only identity references (character sheet on a plain backdrop / Element). Scene goes in the start frame only. |
| Video ignores the references entirely, invents the scene | No start frame attached (media box empty) | Upload the still and set its role to start frame; check the thumbnail before Generate. |
| Everyone in the queue is on their phone | The startframe showed it, and the prompt said "check their phones" | Fix the still first ("talking to each other and laughing, only one or two glance at a phone"); never prompt the unwanted behaviour. |
| People smoking | A breath/vapor puff in the still became smoke | "nobody smoking, no vapor" in still and video prompts; retouch vapor out of the still. |
| The line is static / feels generated | Crowds are the weakest part of video models; too many simultaneous actions | Let the camera move carry the shot, ask for small real movements (weight shifts, a laugh, a touch on the arm), use only 2–3 seconds. |
| The host stands there as an extra; guests ignore her | Blocking never stated: who faces whom, who is next | Edit the startframe so the front guests face her; write eyelines and the interaction in beats. |
| Prompts felt "simple" | Action lists instead of direction | Use the four-block director format in `prompt-format.md`. |
| Image tool did only one of several requests | Several images / an edit asked in one message | One image per message, one chat per task. |
| Edit applied to the wrong version | The superseded base image was uploaded | Keep approved images clearly named; confirm the base image before editing. |
| Crowd of near-identical faces, all white, all long hair, all leather | Under-specified crowd | "ethnically diverse, every face different, mixed hair: bobs, curls, braids, buzz cuts, long hair, mixed outfits not all leather". |
| Crowd too fetish / harnesses / mesh | Over-indexing on "hip techno" wording | "stylish but wearable"; negative: harnesses, fetish wear, mesh tops, bare chests. |
| Crowd looks like a mainstream bottle club | Velvet rope, brass stanchions, suits, back bar full of labels | Steel barrier, concrete, no readable bottles, no wristbands. |
| Sheer clothing showing underwear | Random styling | "Make the sheer skirt opaque black" edit; check every still for B2B suitability. |
| AI text on signs, stickers, neon | Signage in the scene | "no text, no signage"; retouch or crop small leftovers. |
| Old-looking device (home button, thick bezels) | Unspecified device | "modern thin-bezel black iPad Pro" / "black iPhone 16 Pro". |
| Paper clipboards next to the tablet | Props contradict the product | "nothing else on the desk, no paper" (keep such a still only as a deliberate "before"). |
| Brand logo on a laptop | Unspecified device | "plain silver laptop without any logo". |
| A character looks under 21 | Age not specified | "in his/her mid-twenties"; nightlife ads need characters who clearly read as adults. |
| Neon line with a strange loop/kink | Image artefact; will flicker in video | Crop it out of the startframe. |
| Dev server shows a Turbopack "module factory is not available" error after switching branches | HMR state from the old checkout | Restart the dev server (not a promo problem, but it happens while capturing screens). |
