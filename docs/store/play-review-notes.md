# Google Play — App access, review notes and the other App content declarations

Fase 17 S5-Android ([86ey6bfyj](https://app.clickup.com/t/86ey6bfyj)). This file has the
**answers** for every Play Console **Policy and programs → App content** declaration except
Data safety (that's in `play-store-listing.md`). The click path is in
`play-console-checklist.md`.

Facts used throughout: package `app.plusone.guestlist` · targetSdk 36 · developer =
**The Operators** (eenmanszaak), KvK **99992841** (Max, 2026-09-25) · Play **organization**
account (no 12-tester rule, `docs/native/android-release.md` §9) · the app is a remote-URL
shell that loads `https://app.plus-one.io`.

> ⛔ **BLOCKER found while writing this, needs an app-code task before submission:** the
> native app opens on `https://app.plus-one.io/login` (e-mail + one-time code). **Nothing in
> the app links to `/auth/review-login`**, and the Android App Links claim only
> `/auth/confirm` and `/auth/callback` (`android/app/src/main/AndroidManifest.xml`). If the
> reviewer opens the review URL in Chrome, the session lands in **Chrome**, not in the app's
> webview. So right now Google's reviewer **cannot sign in inside the installed app**. The
> demo address has no mailbox, so the normal OTP login can't work either. Fix options for
> that task (not built here, this PR is docs-only): (a) a small "App review sign-in" link on
> `/login` that only shows while the review window is open, or (b) add
> `/auth/review-login` to the App Link paths + `APP_LINK_HOST` allowlist. The steps below
> describe the flow **as it should work once that task is merged**.

---

## 1. App access (Policy and programs → App content → App access)

**Answer:** *All or some functionality in my app is restricted* → **Add instructions**.

Fields (Play asks for name, username, password and "any other information"):

| Field | Paste |
|---|---|
| Instruction name | `PlusOne demo venue (review code)` |
| Username / email | *(leave empty, the code is the only credential)* |
| Password | `<REVIEW_LOGIN_CODE — Max pastes in Play Console>` |
| Any other information required to access your app | The text block below |

**Never** write the real code into this repo, a commit, a PR, chat or a ClickUp comment. It
lives only in Vercel (Production env, Sensitive) and in this Play Console field. Generate a
fresh one per submission (`docs/review-login.md` → "Per submissie").

Text for "any other information" (English; Google's reviewers read English):

```text
PlusOne is an invite-only business app for venue staff (clubs, event venues): guest lists,
per-host quotas, approvals and door check-in. There is no public sign-up, so we provide a
demo venue with fake data.

HOW TO SIGN IN
1. Open the app. On the sign-in screen tap "App review sign-in".
2. Enter the review code from the "Password" field above (type the dashes too) and tap
   "Sign in".
3. Accept the Terms on the first screen ("Agree & continue"). You are now in the
   "PlusOne Demo" venue as an admin + door host.
The code works until <REVIEW_LOGIN_EXPIRES_AT — Max fills in the date>. If it stops
working, please reply to us and we will send a new one right away.

WHAT TO LOOK AT
- Approvals + push notifications: a card "Know when a request comes in" appears in the
  app. Tap "Turn on", then "Allow" in the Android prompt (you can also do this later
  under Profile -> Push notifications). Open the "Requests" tab and approve or decline a
  guest request or a quota request in one tap. New requests arrive as a push
  notification with a generic text ("New guest request"), never a guest's name.
- Offline door check-in (works without internet): open the "Check-in" tab and pick the
  demo event. Turn on airplane mode. Check a guest in (tap the name, then "Check in"). The
  check-in appears straight away and is queued on the device. Turn airplane mode off.
  The queue syncs within seconds, and the check-in also shows on another device or in
  the guest list.
- Guest list: open an event, add a guest with a +1 and see the host quota go down.

DISABLED FOR THE DEMO ACCOUNT (on purpose, not a bug)
Demo account: full access to guest lists, approvals and the door check-in. Creating
venues, inviting people and changing the account e-mail are disabled for this account.

ACCOUNT DELETION
Accounts can't be created by the public; a venue admin invites team members by e-mail.
Any account holder can ask to have their account deleted at
https://www.plus-one.io/legal#delete-account (or by e-mail to <SUPPORT_ADDRESS — Max
confirms the mailbox>). Guests on a venue's list are removed by that venue
("forget contact"), which is immediate.
```

Notes for Max:
- The "Demo account: …" sentence is the one `docs/review-login.md` says to paste. Keep it
  word for word so it matches what the reviewer sees in the app.
- Step 1's "App review sign-in" label is the button the blocker task above has to add.
  If that task picks another label or route, update step 1 here.
- The "Check-in" and "Requests" tab names, the "Know when a request comes in" card and the
  "Turn on" button are what the English UI shows today (`src/lib/i18n/en.ts` `nav`,
  `push`). If they change before submission, update the text.
- **A push can't reach the reviewer by itself.** The demo venue has no other members and
  its public request page is off (`landing_active = false`, `docs/review-login.md`), so
  nothing creates a *new* request while Google tests. The seeded requests show the
  approvals flow; the push itself only shows if a request comes in during the review.
  Options: accept that (the reviewer still sees the opt-in + the system prompt), or
  decide on a way to trigger one test request during the review window. That's a
  decision for Max, not something these notes can promise.
- Before you press "Send for review": run `node scripts/seed-demo-venue.mjs --prod`, so the
  demo events are in the future and any MFA factor is gone (`docs/review-login.md`).

## 2. Ads (App content → Ads)

**Does your app contain ads? → No.** No ad SDK, no ad network, no sponsored content
(`docs/legal/privacy-policy.md` §12: "contains no analytics or advertising SDK").

## 3. Advertising ID (App content → Advertising ID)

Play asks this for every app with targetSdk ≥ 33. **Does your app use advertising ID? →
No.** Our own manifest doesn't declare `com.google.android.gms.permission.AD_ID`, and we
use no ads/analytics SDK. `firebase-messaging` (push) doesn't add it either.
**Check once (Max, Android Studio):** open `android/app/src/main/AndroidManifest.xml` →
tab **Merged Manifest** → search `AD_ID`. Expect no hit. If it does show up, a dependency
added it: tell the orchestrator. That's an app-code task (`tools:node="remove"`), not a "Yes".

## 4. Content rating (App content → Content rating → IARC questionnaire)

- E-mail for IARC: Max's developer contact address.
- **Category:** *All other app types* (not Game, not Social/Communication).

| IARC topic | Answer | Why (checked against the app) |
|---|---|---|
| Violence / blood / fear | **No** to all | Business tool, no such content |
| Sexuality / nudity | **No** | — |
| Language (crude humour, profanity) | **No** | Copy deck has none |
| Controlled substances: does the app **reference** alcohol, tobacco or drugs? | **Yes: reference only** *(Max's call, see note)* | Nightlife context: the tier-alias examples in the UI say "bottle" and "champagne" → VIP (`src/lib/i18n/surfaces/events.ts`, `guests.ts`, `templates.ts`). No depiction of use, no sale, no encouragement → answer **No** to every follow-up about use/sale/encouragement. |
| Gambling (real or simulated) | **No** | — |
| Can users interact or exchange content with each other? | **Yes**, limited | Team members of one venue see each other's guest entries and notes. An admin's decision message is shown to the guest on their status page. Not public, not open to strangers (invite-only). This adds the "Users Interact" note; it doesn't change the age rating. |
| Shares the user's current physical location with other users? | **No** | No location at all |
| Digital purchases | **No** | No billing UI in the native shell (`isNativeShell()`, Apple/Google store-tax decision) |
| Unrestricted internet / web browser | **No** | The webview only loads `https://app.plus-one.io`. External links (terms, privacy) open in the system browser via `openExternal()`. |

**Note on alcohol:** the brief assumed "no" here. The UI does name bottle service, so
answering "No" would be inaccurate. The honest answer is "references only", which
typically gives PEGI 12 / Teen-level ratings instead of PEGI 3 / Everyone. That's fine
for an 18+ business app. If Max would rather have the lowest rating, the copy has to change
(an app-code/copy task), not the answer.

## 5. Target audience and content (App content → Target audience)

- **Target age groups:** tick **18 and over** only.
- **Could the app unintentionally appeal to children?** → **No**. It's a staff tool for
  venues: no characters, no games, invite-only.
- Not in "Designed for Families", no Families Policy commitment.
- Consistency: privacy policy §14 sets account holders at **16+**. 18+ is stricter, so
  there's no conflict. The lawyer may want them aligned (reported in the PR).

## 6. Other declarations (App content page, each its own card)

| Declaration | Answer | Why |
|---|---|---|
| **News app** | **No** | Not a news or magazine app |
| **Government app** | **No** | Private company (The Operators), not acting for a government |
| **Financial features** | **My app doesn't provide any financial features** | No payments, loans, banking, crypto in the app. Stripe billing is web-only and hidden in the native shell. |
| **Health apps** | **My app does not have any health features** | — |
| **COVID-19 contact tracing and status** (if shown) | **No** | — |
| **Data safety** | See `play-store-listing.md` → "Data safety form" | — |
| **Privacy policy** | `https://www.plus-one.io/legal#privacy` | ⛔ BLOCKED until L1: the page must show the lawyer-approved v0.2 text |

## 7. Permissions: do any need a Play declaration?

From `android/app/src/main/AndroidManifest.xml` (plus what the Capacitor/Firebase libraries
merge in):

| Permission | Type | Play declaration form? |
|---|---|---|
| `INTERNET` | normal | **No** |
| `ACCESS_NETWORK_STATE` | normal (N7: lets the webview fire `online`/`offline`) | **No** |
| `POST_NOTIFICATIONS` | runtime (Android 13+), asked in-app, never at launch | **No**. Not on Play's sensitive list. The user sees the system prompt. |
| `WAKE_LOCK`, `com.google.android.c2dm.permission.RECEIVE` (merged by `firebase-messaging`) | normal | **No** |

None of Play's restricted permissions is used (SMS/Call log, `QUERY_ALL_PACKAGES`,
`MANAGE_EXTERNAL_STORAGE`, background location, photo/video access, accessibility,
`USE_EXACT_ALARM`/`SCHEDULE_EXACT_ALARM`, `USE_FULL_SCREEN_INTENT`, foreground-service
types). So **no Permissions declaration form**. If Play Console still shows a permissions
card after the first upload, it lists what the AAB really contains: compare it to this table
and report any difference before answering.

## 8. If Google rejects (what to expect)

- **"Can't sign in / credentials invalid":** the code expired or the review window
  closed. Generate a new code, redeploy, re-seed (`docs/review-login.md`), update the App
  access field and reply in the Policy inbox. Check the blocker above is really fixed.
- **Account deletion:** point to the delete-account URL and (if it's built) the in-app path.
  See `play-store-listing.md` → "Account deletion".
- **"Minimum functionality / webview wrapper":** answer with the two native features:
  push for approvals (FCM) and the offline door that queues and syncs (Door tab +
  airplane mode).
