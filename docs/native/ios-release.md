# iOS release — Codemagic → TestFlight (runbook)

Fase 17 **S1b** ([z8uq9m0gvn](https://app.clickup.com/t/z8uq9m0gvn)). The pipeline itself is
`codemagic.yaml` (repo root, workflow `ios-release`). This file covers what only a human
can do: Apple records, keys, Firebase, the first build, testers. **No Mac needed** —
every step is a web page; Codemagic's Mac builds and signs.

> **Hard precondition — before the first build (step 7) and before every release:**
> open <https://app.plus-one.io/login> on a phone and see the PlusOne login page. The app
> is a remote-URL shell pinned to that exact origin (and WebKit only lets it navigate to
> `app.plus-one.io`, App-Bound Domains). If the page doesn't load, testers get a dark
> screen. **Stop until it does.**

Do the steps **once, in this order, one at a time** — each ends with "Check" so you know it
worked before moving on. Sources checked **2026-10-01**; Apple, Firebase and Codemagic move
menus around — the paths are what they were on that date.

Fixed values you will type more than once:

| What | Value |
|---|---|
| Apple Team ID | `52ZZ6F5V5Y` |
| Bundle ID (permanent, plan decision 13) | `app.plusone.guestlist` |
| Codemagic API key name (must match `codemagic.yaml`) | `PlusOne ASC` |

## What is secret and where it lives

| Thing | Secret? | Lives in |
|---|---|---|
| App Store Connect API key (`AuthKey_XXXX.p8`) | **Yes** | password manager + Codemagic only |
| APNs key (`AuthKey_YYYY.p8`, a *different* key) | **Yes** | password manager + Firebase only |
| Distribution certificate (`.p12` + password) | **Yes** | Codemagic generates it; keep the downloaded copy in the password manager only |
| `GoogleService-Info.plist` | No — client identifiers, bound to the bundle id | the repo, `ios/App/App/GoogleService-Info.plist` |
| Issuer ID, Key IDs, Team ID | No (identifiers) | wherever convenient |

Never paste a `.p8`/`.p12` into a chat, a ticket, a PR, a terminal or the repo.
`ios/.gitignore` ignores `*.p8`/`*.p12`/`*.mobileprovision`, and
`tests/unit/codemagic-ios-release.test.ts` fails CI if one is ever tracked. Delete
downloaded copies from `Downloads` once they are in the password manager.

## How the pipeline works (one paragraph)

Manual start in Codemagic, or push a tag `ios-v*`. The first step **fails unless the commit
is on `main`**. Then `pnpm install --frozen-lockfile`, `npx cap sync ios` with the plain
prod config (the build **fails** if `CAP_SERVER_URL` is set, and re-checks that the synced
`capacitor.config.json` has `server.url` exactly `https://app.plus-one.io`), resolves the
Swift packages (Capacitor + Firebase Messaging), applies the App Store certificate +
profile Codemagic holds, archives, and verifies the IPA (bundle id, version, build,
iPhone + iPad, `aps-environment = production`, associated domains, `WKAppBoundDomains` =
exactly `app.plus-one.io`, and — once committed — that `GoogleService-Info.plist` really is
in the bundle). Codemagic then
**uploads** it to App Store Connect. It never submits anything for review: internal
testers get the build through TestFlight automatically (step 8); an App Store release is
always a human action in App Store Connect.

- **Build number** = `max(latest TestFlight build + 1, BUILD_NUMBER)` — the same floor rule
  as Android's versionCode. The build looks up the app by bundle id and asks App Store
  Connect (`app-store-connect get-latest-testflight-build-number`); before the first upload
  that returns nothing and counts as `0`. Log line: `TestFlight latest=…, BUILD_NUMBER=… ->
  build …`.
- **Version** (`CFBundleShortVersionString`) = `APP_VERSION_NAME` in `codemagic.yaml`. iOS
  and Android each declare it, and the guard test fails if they differ — bump **both** in
  the same PR.
- `GoogleService-Info.plist` is committed and `REQUIRE_GOOGLE_SERVICE_INFO: "true"` is set
  in `codemagic.yaml`, so a build without it **fails** (no silent build without push).
  Independently of that flag, a file that
  is committed but **missing from the IPA** always fails *Verify the IPA* (the copy build
  phase didn't run; `ENABLE_USER_SCRIPT_SANDBOXING = NO` on the App target keeps it able to
  read the file).
- Firebase Messaging does **not** auto-initialise (`FirebaseMessagingAutoInitEnabled =
  false` in `Info.plist`): no installation ID / FCM token is created before the user opts in
  to notifications.

---

## 1. App ID with Push Notifications + Associated Domains

1. <https://developer.apple.com/account> → **Certificates, IDs & Profiles** →
   **Identifiers**.
2. If `app.plusone.guestlist` is **not** listed: **+** → **App IDs** → Continue → **App**
   → Continue → Description `PlusOne`, Bundle ID **Explicit** `app.plusone.guestlist`.
   If it is listed: click it.
3. Under **Capabilities** tick **Associated Domains** and **Push Notifications** (leave
   Push's "Configure" alone — we use a key, not a certificate). **Continue/Save** →
   **Register/Confirm**.

Check: the identifier's page shows both capabilities ticked. Without them signing fails
("Provisioning profile doesn't include the aps-environment / associated-domains
entitlement") — the entitlements are already in `ios/App/App/App.entitlements`.

Source: <https://developer.apple.com/help/account/identifiers/register-an-app-id/>;
Associated Domains context in `docs/native/app-links.md`.

## 2. App Store Connect app record

1. <https://appstoreconnect.apple.com> → **Apps** → **+** → **New App**.
2. Platforms **iOS** · Name `PlusOne` (must be unique on the whole App Store — if taken,
   use e.g. `PlusOne Guestlist`; the home-screen name stays "PlusOne" from `Info.plist`) ·
   Primary language **English** (the UI is English-only, decision 2026-08-19, and
   `CFBundleDevelopmentRegion` is `en`; the primary language is the metadata fallback for
   every locale and is hard to change later — add **Dutch** afterwards as a localization
   for the listing under *App Information → Localizable Information*) · Bundle ID **app.plusone.guestlist** · SKU
   `plusone-guestlist` · User access **Full Access** → **Create**.

Check: the app opens on its *App Store* tab; **App Information → Apple ID** shows a number.
(You don't need to copy it — the build finds the app by bundle id.)

Source: <https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app>.

## 3. App Store Connect API key (what Codemagic uses)

1. App Store Connect → **Users and Access** → **Integrations** → **App Store Connect API**
   → **Team Keys** → **+** (the first time: *Request Access* → accept).
2. Name `Codemagic PlusOne` · Access **App Manager** (Codemagic's recommendation; it can
   upload builds and manage certificates/profiles, but cannot add users or touch
   agreements/banking — choose **Admin** only if App Manager turns out not to be able to
   create the certificate in step 4) → **Generate**.
3. **Download API Key** → `AuthKey_<KEYID>.p8`. **Apple lets you download it exactly
   once.** Put the file, the **Key ID** and the **Issuer ID** (shown above the key list) in
   the password manager.

Check: the key is listed as *Active*.

Source: Codemagic, *iOS code signing* — <https://docs.codemagic.io/yaml-code-signing/signing-ios/>
(accessed 2026-10-01).

## 4. Codemagic: integration, certificate, profile

Codemagic is already set up from S1a (`docs/native/android-release.md` step 4).

1. **API key:** Codemagic → **Team settings** → **Team integrations** → **Developer
   Portal** → **Manage keys** → **Add key** → name **`PlusOne ASC`** (exactly — the YAML
   refers to it), Issuer ID, Key ID, upload the `.p8` → **Save**.
2. **Distribution certificate:** Team settings → **codemagic.yaml settings** → **Code
   signing identities** → **iOS certificates** → **Generate certificate** → type **Apple
   Distribution** → key `PlusOne ASC` → reference name e.g. `plusone_distribution`. Codemagic
   shows a password and offers a download: store both in the password manager (it's the
   only other copy), then delete the download.
3. **Provisioning profile** (only after step 1 of this runbook, so it carries Push +
   Associated Domains): <https://developer.apple.com/account> → Certificates, IDs &
   Profiles → **Profiles** → **+** → **App Store Connect** (under Distribution) → App ID
   `app.plusone.guestlist` → the certificate from 4.2 → name `PlusOne App Store` →
   **Generate**. Then in Codemagic: Code signing identities → **iOS provisioning
   profiles** → **Fetch profiles** → tick `PlusOne App Store` → reference name
   `plusone_app_store` → **Download selected**.

   The reference names in 4.2/4.3 don't matter: the workflow uses `ios_signing:
   distribution_type + bundle_identifier`, so Codemagic matches the certificate and profile
   automatically (reference names are only used by the per-file `certificates:` /
   `provisioning_profiles:` form). A typo there is harmless. What **does** matter is that the
   certificate is **generated in Codemagic** (4.2), so Codemagic holds its private key.
4. Do **not** add `CAP_SERVER_URL` anywhere in Codemagic — the build refuses it.

Check: the profile row in Codemagic shows bundle id `app.plusone.guestlist`, type *App
Store*, and the certificate as matched. If you ever tick a new capability on the App ID,
regenerate the profile in Apple's portal and **Fetch** it again.

Source: <https://docs.codemagic.io/yaml-code-signing/signing-ios/> (accessed 2026-10-01).

## 5. Firebase iOS app → `GoogleService-Info.plist` into the repo

1. Firebase console → ⚙ **Project settings** → **General** → **Your apps** → **Add app**
   → **Apple (iOS)** → Bundle ID **`app.plusone.guestlist`**, nickname `PlusOne iOS`, App
   Store ID empty → **Register app** → **Download GoogleService-Info.plist** → skip the
   remaining wizard steps (the SDK is already wired in `AppDelegate.swift`).
2. Put the file **exactly** here: `ios/App/App/GoogleService-Info.plist` (next to
   `Info.plist` and `AppDelegate.swift`). Do not rename it — a browser that saved it as
   `GoogleService-Info (1).plist` must be renamed back.
3. **Done:** the file is committed and `REQUIRE_GOOGLE_SERVICE_INFO: "true"` is set in the
   `ios-release` workflow of `codemagic.yaml`. It is not a secret (plan decision 13).

Check: the build log's *Check GoogleService-Info.plist (push)* step prints
`GoogleService-Info.plist present for app.plusone.guestlist`; the step fails loudly if
the file belongs to another bundle id.

No Xcode edit is needed: a build phase copies the file into the app when it exists, and
the app only starts Firebase when it finds it (so a build without it has no push, rather
than crashing).

## 6. APNs key → Firebase (push delivery)

FCM delivers to iPhones through Apple's push service; Firebase needs an APNs key for that.

1. <https://developer.apple.com/account> → Certificates, IDs & Profiles → **Keys** → **+**
   → name `PlusOne APNs` → tick **Apple Push Notification service (APNs)** → **Configure**
   → environment **Sandbox & Production**, key type **Team Scoped** → Save → **Continue** →
   **Register** → **Download** (`AuthKey_<KEYID>.p8`, once only). Password manager: file +
   Key ID. Account Holder or Admin role needed.
2. <https://console.firebase.google.com> → the PlusOne project → ⚙ **Project settings** →
   **Cloud Messaging** → **Apple app configuration** → (the iOS app from step 5 is
   listed) **APNs Authentication Key** → **Upload** → the `.p8`, Key ID, Team ID
   `52ZZ6F5V5Y` → Upload. Then delete the download.

Check: the Cloud Messaging tab shows the APNs authentication key with your Key ID for the
iOS app.

Sources: <https://developer.apple.com/help/account/keys/create-a-private-key/>,
<https://firebase.google.com/docs/cloud-messaging/ios/certs> (both accessed 2026-10-01).

## 7. First build

Precondition: <https://app.plus-one.io/login> loads (see top). Codemagic → the app →
**Start new build** → branch `main` → workflow **iOS release → TestFlight (internal)** →
Start (~15–25 min).

Check: all steps green, including *Verify the IPA* (prints `aps-environment OK:
production`, `UIDeviceFamily OK: Array{12}` = iPhone + iPad), and the *App Store Connect*
publish step says the upload succeeded. Apple then **processes** the build (5–30 min, an
e-mail arrives). The export-compliance question is pre-answered
(`ITSAppUsesNonExemptEncryption = NO` in `Info.plist`: the app only uses the OS's
HTTPS — exempt), so the build should not stop at *Missing Compliance*.

Typical first-run failures: *No matching profiles found* → step 4.3 (profile missing or
made before the capabilities were ticked); *no App Store Connect app record* → step 2;
*could not list App Store Connect apps* → step 4.1 name/key.

After the first green run: download the `Package.resolved` artifact from the build page and
commit it as `ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`
(small PR), so Firebase's transitive Swift packages are pinned for every later build.

## 8. TestFlight internal testers

1. App Store Connect → the app → **TestFlight** → **+** next to **Internal Testing** →
   name `PlusOne team` → tick **Enable automatic distribution** → **Create**.
2. **Testers → +** → pick people. Internal testers must be App Store Connect users of
   your team (Users and Access → **+** to invite someone first; role *Developer* or
   *Marketing* is enough). Max 100 per group.
3. Each tester: install **TestFlight** from the App Store on the iPhone **and** the iPad,
   open the invite e-mail on that device → **View in TestFlight** → **Install**.

Check: the build shows under the group with status *Testing*. Every later processed build
reaches the group by itself (automatic distribution). If a build sits without the group,
open it → **Groups** → add `PlusOne team`.

Source: <https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers>
(accessed 2026-10-01).

## 9. Test on iPhone AND iPad

Run the numbered test list in the S1b PR on both devices. Plan decision 15: also confirm
on both that the Deur tab still opens with flight mode on after one online visit (App-
Bound Domains + service worker); if the bridge or the SW fails on a device, report it
before any App Store submission.

**Push on iOS is on (86exxuvye)** for shells built from that change onward: the web app
(`src/features/notifications/capacitor-provider.ts`) turns iOS push on only when the
shell's `PlusOnePushConfig.isConfigured` answers `tokenTransport: "fcm"` — i.e. the
AppDelegate hands JS the FCM registration token, never the raw APNs token. An older iOS
build keeps answering "unsupported" and never asks for permission. Opt-in stays explicit:
`FirebaseMessagingAutoInitEnabled=false` in Info.plist; auto-init is switched on only once
the APNs registration (= the person's yes) succeeds, and switched off again with the FCM
token deleted on Profile "off" / sign-out (`invalidateToken`). Token rotation reaches the
server through the AppDelegate's `MessagingDelegate`. Run the numbered iPhone push test
list from the 86exxuvye PR on a fresh build.

## Releasing after setup

- **Manual:** Codemagic → Start new build → `main` → `ios-release`.
- **Tag:** `git tag ios-v1.0.1 && git push origin ios-v1.0.1` (bump `APP_VERSION_NAME` in
  **both** workflows first if users should see a new version).
- Only a commit already on `main` builds; tag a merged commit.
- Recommended: GitHub → **Settings → Rules → Rulesets → New tag ruleset** for `ios-v*`
  (same as `android-v*`), restricted to admins.

## If something is compromised

- **What the main-only guard does and doesn't stop:** it stops accidents (a tag on an
  unmerged branch, a manual start of a feature branch), not someone with Codemagic access:
  Codemagic reads `codemagic.yaml` from the commit it builds, so a branch whose own YAML
  lacks the guard is not stopped by anything in this repo. The trust boundary is the
  Codemagic account (and the App Store Connect API key + certificate it holds) — protect
  that account (2FA, minimal team members) like the key itself.

- **App Store Connect API key leaked:** App Store Connect → Users and Access →
  Integrations → App Store Connect API → the key → **Revoke** (instant), then generate a
  new one and replace it in Codemagic (step 4.1). With **App Manager** access, in the
  meantime someone could: upload builds and manage TestFlight testers for our apps, edit
  App Store metadata, **submit a version for review and release it** (App Manager may),
  and create/revoke certificates and profiles. They could not sign a build *as us* without
  also holding the distribution certificate's private key (Codemagic + password manager),
  and cannot add users or change agreements/banking. After revoking, also check
  App Store Connect → the app → *Activity* / *TestFlight* for builds you don't recognise.
- **Distribution certificate leaked:** Apple Developer → Certificates → the
  *Apple Distribution* certificate → **Revoke**, generate a new one (step 4.2), regenerate
  and re-fetch the profile (4.3). Installed App Store apps keep working.
- **APNs key leaked:** Apple Developer → Keys → **Revoke**; create a new one and upload it
  to Firebase (step 6). Push to iOS stops until the new key is uploaded. A leaked APNs key
  lets someone send pushes to our app's devices if they also have device tokens.
