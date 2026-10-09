---
name: promo-video
description: Plan, prompt and review AI-generated promo video for PlusOne (reels, trailers, ads, launch clips) with one consistent look, cast and quality bar. Use this skill whenever Max wants marketing or social video for PlusOne — "reel", "trailer", "promo", "ad", "TikTok/Instagram video", "Higgsfield", "Kling", "Seedance", "Nano Banana", "storyboard", "shotlist", "startframe", "character sheet", "video prompt" — or sends a generated image or .mp4 and asks what you think, even if he does not name the skill. It owns the look bible (flash photography, black + one lavender accent), the recurring cast (Lotte, Daan, Robin), the director-grade prompt format, the startframe/character workflow in Higgsfield, the demo data the app screens come from, and the review checklist for generations.
---

# PlusOne promo video

PlusOne promo video is made in three layers, and the quality comes from keeping them apart:

| Type | What it is | Made with |
|---|---|---|
| A — atmosphere | People, the door, the queue, the bar. No readable screen. | Higgsfield video from a startframe |
| B — device | A phone or iPad in frame with a flat green screen | Higgsfield video; the real app screen is keyed in during the edit |
| C — UI motion | Real app screens scrolling, tapping, counting | Screen recordings / stills of the real app, animated in the edit |

**AI never renders the app or any text.** Video models melt UI text, names and numbers, and on a SaaS promo everyone notices. Screens always come from the real app on demo data; AI only supplies the world around them.

The live storyboard (shotlist, every prompt, status per reference image) is the Claude Doc
https://claude.ai/code/artifact/e8f1f5b9-b67c-4682-b948-4c167660d5cc — read it before planning new shots and keep it current when shots or references change (it is a Claude Docs artifact: use the docs connector, not a web fetch).

## The world and the cast

Read `references/look-and-cast.md` before writing any prompt. In short: one Saturday night at **Kelder Nord**, a fictional underground club in a raw concrete building in Amsterdam. Hard on-camera-flash look, deep black falloff, **one** accent colour: lavender `#B5A6FF`. Crowds are mixed, stylish and wearable — not fetish, not bottle-service, not all on their phones. No text, logos, signage, smoking or vapor. Nobody looks into the lens (exception: character intros).

The cast matches the demo data, so the names in the app match the faces in the video:

- **Lotte Visser** — head of door, the hero. Black bob with micro bangs, winged eyeliner, vintage leather blazer, silver chains.
- **Daan Kok** — promoter, mid-twenties, black track jacket with white piping.
- **Robin Vermeer** — owner, bleached buzz cut, small dark oval sunglasses, black turtleneck.

## Workflow for a new video

1. **Story first.** Write the hook and what the viewer should believe after watching (e.g. "the door never stops, even offline"). Each shot is one beat of that story. Real-world logic matters: guests at the front of a queue face the host; the host is in control; nobody waits with their back to the door.
2. **Shotlist.** Per shot: time, type (A/B/C), what we see, startframe + references, model, overlay text. Overlays are English and follow `tone-of-voice.md` (short, verb-first, no slop words like seamless/elevate).
3. **App screens (type C and the green screens of B).** Seed the demo company locally with `pnpm promo:seed` (Kelder Nord: three events, 75+ guests each, real names in the audit log; log in via `/auth/dev-login?email=owner@kelder-nord.test&next=/app`). Then capture every storyboard screen with stable file names, on phone (1290×2796) and iPad landscape (2752×2064):

   ```bash
   npx playwright test -c .claude/skills/promo-video/scripts/screens.config.mjs
   ```

   It starts its own dev server on port 3100 and writes `~/Documents/PlusOne promo/app-screens/<device>/<nn>-<slug>.png` (override with `PROMO_SCREENS_DIR`; from a git worktree add `DEV_WEBPACK=1`). The screen list lives in `scripts/screens.spec.mjs`: add a row there when a new shot needs a new screen. Capture while the seeded live night is still live (it is anchored at seed time). When a shot needs a state the seed does not have (a specific refusal reason, a fresh request), create it in the app as the right persona before recording, so names and the audit log stay true. Interactions (typing, tapping) are screen recordings at the same viewport. Never use production data in a promo.
4. **Characters.** Each recurring character gets a character sheet (portrait, side, full body, back, hands) on a plain charcoal backdrop, then a Soul Character in Higgsfield (for stills) and an `@` Element (for video). See `references/look-and-cast.md`.
5. **Startframes.** Every video shot starts from an approved still. Rules below.
6. **Video prompts.** Director format, see `references/prompt-format.md`. Test at 720p, 5 s, sound off. Generate the hardest/most important shot first.
7. **Review every generation** with the checklist below before the next one costs credits.

## Files and names

Everything for a campaign lives in `~/Documents/PlusOne promo/`, and every setting line in the storyboard names a file there. File names go in the setting line above a prompt, never inside the prompt (the model never sees file names and may render them as text).

| Folder | Holds | Example |
|---|---|---|
| `refs/` | Approved reference images and end frames cut from them | `REF-2_rij.jpg`, `REF-2_eindframe.jpg` |
| `karakters/<name>/` | Character sheets | `karakters/lotte/lotte_1-portret.png` |
| `startframes/trailer/`, `startframes/reels/` | New startframes per shot | `T01_lotte-kijkt-op.png`, `R2-A_daan.png` |
| `generaties/trailer/`, `generaties/reels/` | Higgsfield videos per shot and version | `T04_v1.mp4`; approved: `T04_v3_ok.mp4` |
| `app-screens/phone/`, `app-screens/ipad-landscape/` | Captured app screens (step 3) | `phone/04-door-checkin.png` |
| `opnames/` | Screen recordings of the real app | `T03_check-in.mp4` |
| `montage/` | Edit projects and exports | `trailer_v1.mp4` |

Shot codes: trailer shots `T01`…`T12`, reel shots `R<reel>-<shot>` (`R1-3` = reel 1, shot 3); reel startframes keep their letter (`R1-A`). When Max sends an image, say which file name it should be saved as.

## Startframes

The startframe is literally the first frame of the video; the model only animates it. Anything not in the startframe gets invented — that is where generations go wrong.

- Compose the **start** of the action, not the end (the guests are already facing the host; the nod and walk-in are in the prompt).
- Make it in the video's aspect ratio (16:9 trailer, 9:16 reels). For reels, recompose an approved 16:9 still with an "Edit this image: recompose it as a vertical 9:16 frame…" edit rather than cropping.
- Build on approved images with "Edit this image: change only …" edits. Regenerating from scratch gives a different street and different people.
- In Higgsfield set the image's role to **start frame**, not reference. An **end frame** (e.g. a crop of the startframe) only for pure camera moves; never when people must move through the frame.
- **References are for identity only** (character sheets / Elements). A scene image as reference makes the video jump to that scene.

## Model choice (Higgsfield, as seen in Max's account)

| Need | Model | Inputs |
|---|---|---|
| A character must stay recognisable while acting | Seedance 2.0 | start frame + end frame + image references / `@` Element |
| Natural human acting, no identity refs needed (character is in the startframe) | Kling v3.0, mode pro | start frame (+ end frame) |
| Atmosphere without a fixed character (bar, dance floor, iPad) | Cinema Studio 3.0 (4.0 adds camera/lens/light controls) | start frame + end frame |
| Stills: character sheets, edits of approved images | Nano Banana Pro (inside Higgsfield) | image references |
| Stills with a trained character | Soul Cinema + Soul Character | prompt + character |

Model names and features change; check with the Higgsfield MCP `models_list` before recommending something new (it is paginated: the Kling models are on the second page, `after: "20"`). Several models generate audio by default, so always tell Max to switch sound off. The MCP in this setup can read the catalogue, credits and finished generations but cannot upload or generate — Max generates in the web app.

## Reviewing a generation

When Max sends an image, look at it directly. When he sends an .mp4 path or a Higgsfield generation (`show_generations` gives its URL), extract frames and look at them:

```bash
node .claude/skills/promo-video/scripts/frames.mjs <video.mp4> <outDir> 0.1 1.5 3 4.5 9
```

(Headless Edge via Playwright; times past the end clamp to the last frame. Copy downloads into a scratch directory first.) To make an end frame from a startframe, crop and upscale it:

```bash
node .claude/skills/promo-video/scripts/crop.mjs <image> <out.jpg> <x> <y> <w> <h> 1920 1080
```

Check, in this order, and name the cause, not just the symptom:

1. **Continuity** — same place and people from first to last frame? A jump almost always means a scene image was attached as a reference or end frame.
2. **Story logic** — do eyelines and blocking make sense (who is next, who decides)?
3. **Look** — flash light, black + lavender only, no text/logos/signage, no smoking, nobody looking into the lens.
4. **Cast** — the character recognisable; no clones; mixed crowd; everyone clearly 21+.
5. **Technical** — green screens flat and fully visible, phone/tablet steady enough to track, nothing worth fixing that a crop or retouch cannot.

Then give the fix as concrete changes: which input to swap, which line of the prompt to change, and the full corrected prompt ready to paste. `references/failure-modes.md` lists the failures already met and their fixes — check it before diagnosing.

## How to work with Max on this

- Answer in Max's language (usually Dutch); prompts themselves are English.
- Hand over complete, copy-paste-ready prompts — never fragments he has to assemble, and one image per message for image tools.
- Credits are real money: ask him to send a startframe for a check before he spends credits on video.
- Keep the storyboard doc current: approved references, new prompts, status per shot. If you cannot read it in this session, say so and work from this skill's references.
- Sensitive moments (a refusal, someone drunk) stay dignified: the guest is clearly adult, shown through posture rather than slapstick, no drink in hand, no physical contact; Lotte stays calm and respectful. The brand is a door that runs well, not a door that humiliates people.
