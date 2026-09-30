# Universal links / App Links (Fase 17 S4)

Plan decisions 7 + 11 (`capacitor-plan-claude-code.md`). When the app is installed, an
invite / magic-link / e-mail-change mail opens **in the app** instead of the browser, so
the session lands in the webview's cookie jar. Without it (v1 fallback) the link logs in
the browser and the app still asks for the 6-digit OTP.

## What is claimed

Only `https://app.plus-one.io/auth/confirm` and `https://app.plus-one.io/auth/callback`,
exact paths, any query. Never `/e/*`: the guest landing stays in the browser even for a
promoter who has the app (decision 11). Everything else on the domain stays in the browser.

Single source: `src/lib/native/app-links.ts` (Apple Team ID `52ZZ6F5V5Y`, app id
`app.plusone.guestlist`, host, paths). An Apple org-account switch is a one-line change
there + the Team ID in the signing setup. `tests/unit/app-links.test.ts` pins the native
manifests below to those constants.

| Piece | Where | State |
| --- | --- | --- |
| `/.well-known/apple-app-site-association` | `src/app/.well-known/apple-app-site-association/route.ts` | Live on deploy. Static JSON, 200, `application/json`, no redirect. |
| `/.well-known/assetlinks.json` | `src/app/.well-known/assetlinks.json/route.ts` | **404 until `ANDROID_APP_LINK_SHA256` is set** (Play Console fingerprints, `docs/native/android-release.md` step 10). |
| Middleware | `src/middleware.ts` matcher skips `/.well-known/` | Live. A 307 to /login would read as "no association" to Apple/Google. |
| Android intent-filter | `android/app/src/main/AndroidManifest.xml` (`autoVerify="true"`, `android:path` exact) | In the next build; verifies once the fingerprints are served. |
| iOS entitlement | `ios/App/App/App.entitlements`, wired via `CODE_SIGN_ENTITLEMENTS` (Debug + Release) | In the repo; **needs the Associated Domains capability on the App ID before S1b signs a build** (below). |
| In-app routing | `src/components/native-app-links.tsx`, mounted once in `src/app/layout.tsx` | Live on deploy; no-op in a browser. |

## iOS: Associated Domains capability (S1b, Max)

The entitlement is:

```xml
<key>com.apple.developer.associated-domains</key>
<array>
	<string>applinks:app.plus-one.io</string>
</array>
```

A provisioning profile must carry it, or signing fails ("Provisioning profile doesn't
include the com.apple.developer.associated-domains entitlement"). Once, before the first
S1b build: Apple Developer → Certificates, Identifiers & Profiles → Identifiers →
`app.plusone.guestlist` → tick **Associated Domains** → Save. Codemagic managed signing
then fetches/creates a profile that includes it. Re-generate an existing profile after
ticking the box.

Apple fetches the AASA through its CDN, not from the device: after a deploy, check
`https://app-site-association.cdn-apple.com/a/v1/app.plus-one.io` (may lag up to ~24h).

## Android

`android:autoVerify="true"` + the served `assetlinks.json`. While the route 404s,
Android 12+ does not verify and the links simply open in the browser (the v1 fallback);
Android 11 and older may show an "Open with" chooser. Verify on a device:
`adb shell pm get-app-links app.plusone.guestlist`.

## In-app routing — the security boundary

The OS only hands the app URLs the association files allow, but the `appUrlOpen` listener
does not trust that: `appLinkTarget()` accepts only `https:`, host exactly
`app.plus-one.io` (no port, no userinfo), and a WHATWG-normalised pathname exactly equal
to one of the two paths (percent-encoded paths are not decoded into a match). It returns a
same-origin relative `path?query` (fragment dropped) and loads it as a full document
navigation, so the route handler runs, sets the cookies, and applies its own `next=`
open-redirect guard (`safeNextPath`). A given link is navigated at most once per app process,
from either source (`appUrlOpen` or `getLaunchUrl()`): committed links are remembered as short
hashes (never the URL) in `sessionStorage`. That set matters on Android, where
`getLaunchUrl()` keeps returning the cold-start link for the whole process. A link only counts
as used once its navigation commits (`pagehide`); a known-offline tap waits for the `online`
event, and a navigation that never leaves the page is released after 10 s, so a first tap
without network never strands a valid link.
