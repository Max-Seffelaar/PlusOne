# Director-grade video prompts

A list of things that should happen ("people talk, she nods, light rain") gives generic, floaty AI video. A director's brief gives the model a reason for every movement. Max explicitly asked for prompts written like a director who explains the story and then, technically, exactly what must happen.

## Structure (always all four blocks, pasted as one prompt)

```
[Story & world] Where we are, who this character is, and why this moment matters in the story.

[General style & framing] The shared look (identical in every prompt of a campaign; see look-and-cast.md).

[Format] Aspect ratio, one continuous take, where the main action sits in the frame.

[Shot: 0:00-0:05] The meaning of the moment in a few words ("The line." / "Too late."), then:
- lens and camera position (28mm at eye level on the pavement close to the wall);
- the camera move and its motivation (slow push-in toward the person who decides), speed, no speed ramps;
- the action in timed beats (0:00-0:02 … 0:02-0:03 …), each one physical and small;
- performance (cool and in control, no smile; nobody looks at the camera);
- light and texture details (rain caught by the flash, lavender rim on hair);
- technical constraints (green screen flat and fully in frame; same street and people from first to last frame).
```

### Format lines

- Trailer, 16:9: `16:9, one continuous take, no cuts. Keep the main action inside the centre third of the frame so a 9:16 vertical crop keeps it.`
- Reel, 9:16: `Vertical 9:16, one continuous take, no cuts. The main action stays in the centre of the frame; keep the top and bottom fifth calm for captions.`

### Writing rules and why

- **One hero action per shot.** Models lose the thread when five things happen at once; the edit can combine shots.
- **Beats with timecodes, physical micro-actions.** "Her thumb taps once, firmly, in the lower third of the screen" animates; "she uses the app" does not.
- **Motivate the camera.** A move with a reason (toward the decision, following someone down) reads as filmmaking; a random drift reads as AI.
- **Describe motion, not appearance.** The startframe and the Elements carry the look; re-describing the person invites the model to drift from them. Name the character with `@Name` when an Element is attached.
- **Say what must stay the same** (same street, same people, nobody new enters) and what must not appear (smoking, text) — explicitly, every time.
- **Green screens:** `the screen stays a perfectly flat, even green (#00FF00) for the whole take, with no reflections, glare, text or icons, so it can be replaced in post`, plus "the phone stays steady and fully in frame" (and "all four corners visible" for tablets, for tracking).
- **Generation settings:** 5 s, sound off, 720p for tests; use only the best 2–4 seconds in the edit.

## Worked example — trailer shot 4, the door moment

Settings: Seedance 2.0, startframe = REF-2 edited so the two front guests face Lotte, Element `@Lotte`, no end frame (people must move), 5 s, 16:9, sound off.

```
[Story & world] Saturday night at Kelder Nord, an underground club in a raw concrete building in Amsterdam. The night is run from the door by @Lotte, the head of door: calm, sharp, always in control. PlusOne is the guest list app on her phone, and it is why her door moves fast and nobody argues.

[General style & framing] Photorealistic, like candid nightlife flash photography brought to life: hard frontal light as if from an on-camera flash, crisp highlights on leather and wet pavement, deep black falloff behind the subject, a single lavender neon accent (#B5A6FF) as the only colour in a palette of blacks and greys, subtle 35mm film grain, natural skin texture, real human weight and timing. No text, no logos, no signage, no smoking, no vapor. Nobody looks into the lens.

[Format] 16:9, one continuous take, no cuts. Keep @Lotte and the doorway inside the centre third of the frame so a 9:16 vertical crop keeps them.

[Shot 4: 0:00-0:05] The payoff: the line moves and the guests are in. A 35mm handheld shot at eye level from the pavement just behind the front of the queue, with a gentle push-in. 0:00-0:01 the woman in the black puffer vest finishes saying their names, with a small hand gesture toward her friend. 0:01-0:02 @Lotte glances down at her phone, then up at them. 0:02-0:03 one small nod; she steps half a pace back against the door frame and tilts her head toward the open door. 0:03-0:05 the two women slip past her into the dark doorway, laughing; the lavender neon rims their hair for a moment before the darkness inside takes them. Behind them the queue shuffles one step forward. Performance: natural and understated; the guests are excited, @Lotte is cool and in control and does not smile. Same street and same people as the first frame; nobody new enters the frame.
```

## Worked example — reel shot with a green screen

Settings: Kling v3.0 pro, startframe = close-up of Daan's hand holding a phone with a flat green screen (9:16), 5 s, 9:16, sound off.

```
[Story & world] Saturday night at Kelder Nord. Daan, a promoter, wants to squeeze one more friend onto tonight's list, but the list locked at 22:00.

[General style & framing] Photorealistic, like candid nightlife flash photography brought to life: hard frontal light as if from an on-camera flash, deep black falloff, a single lavender neon accent (#B5A6FF) as the only colour in a palette of blacks and greys, subtle 35mm film grain. No text, no logos, no smoking, no vapor.

[Format] Vertical 9:16, one continuous take, no cuts. The phone stays in the centre of the frame; keep the top and bottom fifth calm for captions.

[Shot: 0:00-0:05] Too late. A 50mm close-up on Daan's hand and phone, almost locked off. 0:00-0:02 his thumb taps the lower half of the screen with confidence. 0:02-0:03 he pauses, the thumb hovering. 0:03-0:05 he taps again, harder, then his hand drops a few centimetres in mild defeat. Technical: the phone stays steady and fully in frame; the screen stays a perfectly flat, even green (#00FF00) with no reflections or icons, so it can be replaced in post.
```

## Still prompts (startframes, references)

Stills are described by appearance (that is their job), in the look-bible vocabulary, ending with `harsh direct on-camera flash, 35mm film grain, no text, no smoking`. The still sets what the video can do: whatever is wrong in the startframe (phones out, vapor, a closed door where people must walk through) comes back in the video. Edits of an approved image start with `Edit this image.` and say what changes and what must not (`Change only three people … Do not change anyone else: same faces, same clothes, same positions, same light, same composition.`).
