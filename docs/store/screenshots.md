# Store screenshots + feature graphic

Every store screenshot set and the Play feature graphic are rendered automatically from the live app (86ey6bf8k). Nobody takes them by hand. A Playwright run logs into the app on a throwaway local Supabase stack with PII-free demo data, captures each shot at the exact pixel size the store wants, checks the size and the "no alpha" rule, and writes PNGs ready to upload.

## How to run it

**CI (recommended):** GitHub → **Actions** → **Store screenshots** → **Run workflow** (branch `main`). After about 10–15 min, download the **`store-screenshots`** artifact (a zip, kept 30 days) from the run page. The job summary links it and lists the file count per set. The workflow runs only on `workflow_dispatch`, never on PRs. GitHub only shows the button for workflows that exist on the default branch, so the first run happens after this lands on `main`.

**Locally** (local stack only, never prod):

```
pnpm supabase:start        # once per machine
pnpm dev:env               # writes .env.local for the local stack (skips if present)
pnpm store:screenshots     # seed the demo night, then render every set
pnpm store:screenshots -- --project=play-phone   # one set
```

Output: `store-screenshots/<set>/<nn>-<screen>.png` (gitignored), e.g. `store-screenshots/play-phone/03-door-check-in.png`, plus `store-screenshots/play-feature-graphic/play-feature-graphic.png`.

`pnpm store:screenshots` first runs `scripts/store-screenshot-seed.mjs`. That script **hard-refuses any non-localhost Supabase URL** (the same hostname check as `/auth/dev-login`). It is idempotent, so a re-run never duplicates rows and refreshes the event times, so the demo night is always live. Check-ins and refusals are append-only (no UPDATE grant, not even for service_role), so they are inserted once and a re-run keeps their first-run times; reset the stack first for fresh ones (CI always starts fresh). It never edits `supabase/seed.sql`. Locally it shares the one stack with other worktrees ("One DB owner", CLAUDE.md), but it only adds rows and touches up a few seed strings. It does not reset anything.

What the seed adds:

- A plain venue admin, `store-demo@plusone.test` ("Alex Morgan"), at Club Vesper. The shots log in as this user, not `admin@`, because `pnpm dev:mfa` makes `admin@` a platform admin and their nav then shows the internal Platform entry.
- **"Neon Nights", live right now:** 60 fictional guests (no e-mail or phone) across Guest/VIP/Artist, +N plus-ones, 26 check-ins spread over the night, two pending landing guests, three open guest requests and one open quota request.
- Two upcoming nights and one past night.
- An English, alcohol-free touch-up of the visible `seed.sql` strings. The tier "VIP + fles op tafel" and its aliases become "Artist", and the Dutch note, motivation and reason strings become English.

## Naming

Names are human readable: lowercase, hyphens only, no underscores or spaces (guarded by `tests/unit/store-screenshot-names.test.ts`). Set folders: `play-phone`, `play-tablet-7-inch`, `play-tablet-10-inch`, `apple-iphone-6-9-inch`, `apple-ipad-13-inch`, `apple-ipad-13-inch-landscape`. Screen files keep their order prefix: `01-home.png`, `02-guest-list.png`, `03-door-check-in.png`, `04-requests.png`, `05-stats.png`.

## Shot-list

The same screens in every set, so the listings stay consistent. URLs are built with the app's own route helpers (`tests/e2e/store/sets.ts`).

1. **Home** (`/app`, Home tab): the live night plus the upcoming events.
2. **Guest list** (the live event's list): mixed tiers, checked-in rows, +N badges.
3. **Door / check-in** (Deur tab on the live event): the touch/offline-outbox door (plan decision 14) with live counters. The spec asserts it is the outbox door, never the desktop cockpit.
4. **Requests** (`aanvragen`): open guest requests with Approve/Decline. The quota request sits behind the second tab (its count shows in the tab).
5. **Stats** (`stats`): opens on the live night (most recently started), with the attendance split.

Never captured: Settings, Platform, Billing.

## Sizes (verified 2026-10-05)

| Set (folder) | PNG px | CSS viewport × DPR | Chrome | Store slot |
|---|---|---|---|---|
| `play-phone` | 1080×1920 | 432×768 × 2.5 | bottom tabs | Play: Phone |
| `play-tablet-7-inch` | 1188×2112 | 792×1408 × 1.5 | bottom tabs, `md:` tablet layout (T1) | Play: 7-inch tablet |
| `play-tablet-10-inch` | 2560×1440 (landscape) | 1280×720 × 2 | sidebar | Play: 10-inch tablet |
| `apple-iphone-6-9-inch` | 1290×2796 | 430×932 × 3 | bottom tabs | App Store: iPhone 6.9" |
| `apple-ipad-13-inch` | 2064×2752 | 1032×1376 × 2 | sidebar | App Store: iPad 13" |
| `apple-ipad-13-inch-landscape` | 2752×2064 | 1376×1032 × 2 (guest list + door only) | sidebar | App Store: iPad 13" |
| `play-feature-graphic` | 1024×500 | 1024×500 × 1 | — | Play: Feature graphic |

Every set emulates touch (`(pointer: coarse)`), as on the real device. A real 13" iPad is 1032 CSS px wide in portrait, which is past the one chrome breakpoint (1024), so the iPad shows the sidebar in both orientations. That is what an iPad user actually sees. The bottom-tab tablet layout is in the Play 7" set. All PNGs are 24-bit RGB with no alpha; the spec checks the PNG header.

Sources:

- Apple, "Screenshot specifications", https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications (accessed 2026-10-05):
  - iPhone 6.9" accepts 1260×2736, 1290×2796 or 1320×2868 (portrait).
  - iPad 13" accepts 2064×2752 / 2752×2064 or 2048×2732 / 2732×2048, and is required if the app runs on iPad.
  - .png/.jpg, no alpha.
- Google Play Console Help, "Add preview assets to showcase your app", https://support.google.com/googleplay/android-developer/answer/9866151 (accessed 2026-10-05):
  - Screenshots are JPEG or 24-bit PNG (no alpha), 320–3840 px, and the long side may be at most 2× the short side.
  - Phone: 9:16 portrait, at least 1080×1920.
  - Tablets: 9:16 or 16:9, between 1080 and 7680 px, at least 4 screenshots.
  - Up to 8 screenshots per device type.
  - Feature graphic: 1024×500, JPEG or 24-bit PNG (no alpha).
- **Deviation from the task brief:** the brief suggested 1200×1920 and 1600×2560 for the Play tablets. Both are 10:16, not the 9:16/16:9 Play now asks for, so the sets use 1188×2112 (9:16) and 2560×1440 (16:9).

## Feature graphic

`tests/e2e/store/feature-graphic.html`, rendered by `feature-graphic.spec.ts`:

- near-black `#0B0B0D`, with lavender `#B5A6FF` as the only accent;
- the "+1" icon from `native/icon/plusone-icon.svg`, the "PlusOne" wordmark, and the line "Guest lists, quotas and the door. One app.";
- Bricolage Grotesque + Hanken Grotesk, loaded from the app's own `next/font` files on the dev server (no CDN). The spec fails if they did not load.

No device mockups, and no claims the product doesn't back (no ticketing, no invitations — #36). To change the copy, edit the HTML and re-run.

## Uploading

1. **Play Console** → your app → **Grow users → Store presence → Main store listing → Graphics**.
2. Upload `play-feature-graphic/play-feature-graphic.png` as the Feature graphic.
3. Upload `play-phone/*` under Phone screenshots, `play-tablet-7-inch/*` under 7-inch tablet and `play-tablet-10-inch/*` under 10-inch tablet, in file-name order. Save.
4. **App Store Connect** → the app → the version being prepared → **Previews and Screenshots**.
5. Drag `apple-iphone-6-9-inch/*` into **iPhone 6.9" Display**, then `apple-ipad-13-inch/*` plus `apple-ipad-13-inch-landscape/*` into **iPad 13" Display**. Apple scales these down for the smaller display sizes.
