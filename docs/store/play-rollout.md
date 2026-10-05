# Google Play — staged rollout plan (Android)

Fase 17 S5-Android ([86ey6bfyj](https://app.clickup.com/t/86ey6bfyj)). How the first
Android release goes from the internal track to 100% of production, with a go/no-go per
step and how to stop. The build and upload pipeline is `docs/native/android-release.md`.

## First, what a staged rollout does and does **not** gate

PlusOne's Android app is a **remote-URL shell**: the native app loads
`https://app.plus-one.io`, and every screen, every fix and every bug comes from the
**web deploy on Vercel**, not from the AAB.

- **A web deploy reaches 100% of users at once**: browser, PWA, *and every installed
  Android app*, whatever the Play rollout percentage is. Play's 10% / 50% does **not**
  protect anyone from a bad web deploy. That protection is the normal web process
  (CI, review gates, Vercel instant rollback: Vercel → project `plus-one` → Deployments →
  the previous good deploy → **Promote** / **Instant Rollback**).
- **The staged rollout only gates the native shell**: the Capacitor version, plugins
  (push, back button, status bar, splash, browser), the Android manifest (permissions,
  App Links), the FCM setup and the signing. Those are the things that can break *only*
  on Android, and only the AAB can change them.
- Corollary: during a rollout, **don't ship risky web changes to the native-only seams**
  (`src/lib/native/`, `src/features/notifications/`, `src/lib/platform.ts`, the door
  outbox). Otherwise you can't tell whether a problem came from the new shell or the new web.

## The steps

| Step | Track | Who gets it | Minimum time | Then |
|---|---|---|---|---|
| 0 | **Internal testing** | Max, Joeri, the PlusOne team list (`android-release.md` §8) | Until every check below is green on at least 2 devices (one Android 13+, one older) | → step 1 or 2 |
| 1 *(optional)* | **Closed testing** | Staff of 1–3 pilot venues (e-mail list or Google Group, `android-release.md` §9) | **At least one real event night** per pilot venue | → step 2 |
| 2 | **Production, staged 10%** | 10% of new installs/updates, chosen by Play | **3 days**, including at least one Friday or Saturday night | → step 3 |
| 3 | **Production, staged 50%** | 50% | **3 days**, including a weekend night | → step 4 |
| 4 | **Production, 100%** | Everyone | — | Done. Keep watching for one week. |

Why weekend nights: the door (offline outbox, push for requests) only gets real load on
event nights. A quiet Tuesday at 10% proves nothing.

Step 1 is optional because there's no 12-tester rule for our organization account
(`android-release.md` §9). Do it if a pilot venue is willing. It's the only step where
real door staff use the native app before strangers do.

**Note on step 2 for a brand-new app:** at the very first production release the install
base is close to zero, so 10% of "nobody" is nobody. For **v1.0** the percentage mainly
limits who *finds* the app in the store. The steps really earn their keep from **the
second release** on, when a new shell version replaces one that already works.

## Go / no-go per step

Check **all** of these before you move to the next step. One red = stay or halt (below).

| Signal | Where to look | Go | No-go |
|---|---|---|---|
| **Crash-free users** (native) | Play Console → PlusOne → **Monitor and improve → Android vitals → Overview** (filter: the new version code) | ≥ 99.5% crash-free users, and no ANR/crash cluster that's new in this version | Below 99%, or Play shows "bad behavior" thresholds exceeded (user-perceived crash rate ≥ 1.09%, ANR rate ≥ 0.47%) |
| **Web/app error rate** | Sentry → project for `app.plus-one.io` → Issues, filter `release` / environment production, last 24 h | No new issue with > 10 events that only shows in the Android webview (user agent contains `wv`) | Any new Android-webview-only issue that blocks a flow (sign-in, guest list, check-in) |
| **Push delivery** | Supabase Dashboard → project `tolxwgqhppdcvnogdpel` → **Edge Functions → push-dispatch → Logs**: lines `{"fn":"push-dispatch","event":"done",…}` | `failed` stays ~0 and `sent` > 0 on event nights; at least one tester confirms a push arrived on the new version | `failed` > 5% of `claimed` over a night, or `oauth_failed` / `fcm_not_configured` appears even once |
| **Door outbox replays** | Sentry → search `door-outbox` (messages *"IndexedDB write failed"*, *"dropped … outbox entr…"*) + one manual test: airplane mode → check in → reconnect | No `door-outbox` warnings from the new version; the manual offline check-in syncs within a minute after reconnecting | Any "IndexedDB write failed" or "dropped … entries" from Android devices on the new version |
| **Sign-in** | A tester signs in fresh on the new version (e-mail code, plus the magic-link App Link `/auth/confirm` opening *in the app*) | Works | Link opens in Chrome instead of the app, or the code login loops |
| **Reviews/feedback** | Play Console → **Ratings and reviews**; messages from venues | Nothing that points at the new version | A pattern (≥ 2 independent reports of the same problem) |

## How to halt a rollout

**Halt** stops new users from getting the version. People who already updated keep it.

1. Play Console → PlusOne → **Test and release → Production** (or the testing track) →
   tab **Releases**.
2. On the release that's rolling out: **Halt rollout** → confirm.
3. How to check it worked: the release's status shows **Halted**. New installs get the
   previous production version again (on the very first release: nobody new can install).
4. Fix: in a PR, then a new build (Codemagic, `android-release.md` "Releasing after
   setup"). It **must have a higher versionCode** (Play never accepts the same or a lower
   one again; the pipeline does this automatically). Start that new release from step 0 again.
5. **Resume** (Play Console → the halted release → **Resume rollout**) is only for a halt
   that turned out to be a false alarm, with the same build. Never resume after a fix.

Users who already have the bad shell version can't be rolled back by Play. They get the fixed
version as a normal update. If the problem is in the **web** layer instead (see the top
of this file), skip Play entirely: roll back on Vercel, and every Android user is fixed on
their next app start.

## Who decides

Max decides every step change (10 → 50 → 100) and every halt. A Claude session can gather
the signals above and give a go/no-go recommendation, but never presses a Play button.
The service account Codemagic uses can't touch production by design
(`android-release.md` §3).
