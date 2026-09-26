# Android release — Codemagic → Google Play (runbook)

Fase 17 **S1a** ([86ey6bfpy](https://app.clickup.com/t/86ey6bfpy)). The pipeline itself is
`codemagic.yaml` (repo root, workflow `android-release`). This file covers what only a
human can do: accounts, keys, credentials, the first upload, testers.

> **Hard precondition — before the first build (step 6) and before any rollout:**
> `https://app.plus-one.io` must be live on the Vercel project **`plus-one`** (plan item
> **M5**, done 2026-09-25). Verify it every time before you roll out a release: open
> <https://app.plus-one.io/login> (desktop and phone browser) and see the PlusOne login page.
> The app is a remote-URL shell pinned to that exact origin — if it doesn't load there,
> every tester gets a near-black splash and a webview error. **Stop here until it does.**

Everything below is done **once**, in this order. Sources checked on **2026-09-25**; the
Play and Codemagic UIs move menus around — the menu paths are what they were on that date.

## How the pipeline works (one paragraph)

Manual start in Codemagic, or push a tag `android-v*`. The first step **fails unless the
commit is on `main`** (`git merge-base --is-ancestor HEAD origin/main`) — a tag on an
unmerged branch would otherwise build that branch's own `codemagic.yaml`/guards. Codemagic installs with
`pnpm install --frozen-lockfile`, runs `npx cap sync android` with the plain prod config
(the build **fails** if `CAP_SERVER_URL` is set, and re-checks that the synced
`capacitor.config.json` has `server.url` exactly `https://app.plus-one.io`), builds `bundleRelease`
signed with the **upload key** from Codemagic's keystore store, verifies the signature, and
uploads the AAB to the Play **internal** track as a **draft**. You press "Roll out" in Play.

- **versionCode** = `max(latest on the Play internal track + 1, BUILD_NUMBER)`. The build
  asks Play first (`google-play get-latest-build-number --package-name
  app.plusone.guestlist --tracks internal`, Codemagic's preinstalled CLI, authenticated by
  `GOOGLE_PLAY_SERVICE_ACCOUNT_CREDENTIALS` from the `google_play` group); before the first
  upload that returns nothing and counts as `0`. Codemagic's `BUILD_NUMBER` alone is not
  enough: it restarts at 1 when the app is re-added in Codemagic, moved to another team, or
  the workflow key is renamed — and Play refuses every versionCode that isn't higher than
  the last one. Play's own state is the floor; `BUILD_NUMBER` only keeps numbers moving
  while Play can't be read (the first build). Build log line: `Play internal latest=…,
  BUILD_NUMBER=… -> versionCode …`.
- **versionName** = `APP_VERSION_NAME` in `codemagic.yaml` — the single source. Bump it
  there in a PR before a release that users should see as a new version.
- Local Android Studio builds get versionCode `1` / versionName `0.0.0-dev` and are
  unsigned for release — they are never uploaded.
- `google-services.json` missing ⇒ the build **warns** (no push) and continues. Once N5 is
  merged and the file is committed, set `REQUIRE_GOOGLE_SERVICES: "true"` in
  `codemagic.yaml` so a build without push fails.

---

## 1. Create the app in Play Console

1. <https://play.google.com/console> → the PlusOne **organization** account (M2) →
   **Home** → **Create app**.
2. App name `PlusOne` · Default language **Dutch – nl-NL** · App · Free → accept the
   declarations → **Create app**.
3. Note: Play does **not** ask for the package name here. It is bound by the **first AAB you
   upload** (step 7) — that AAB is `app.plusone.guestlist`, permanently (plan decision 13).

## 2. Generate the upload key (on your own machine, never in the repo)

Play App Signing means Google holds the real *app signing key*; we only hold an
*upload key*. Lose the upload key → Play support can reset it; it can't be used to push
an update to users without going through our Play account.

Windows (Android Studio's bundled JDK), in a folder **outside** the repo:

```powershell
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -genkeypair -v `
  -keystore plusone-upload.jks -storetype PKCS12 `
  -alias plusone-upload -keyalg RSA -keysize 4096 -validity 10000
```

- Use one strong generated password; PKCS12 uses the same password for store and key.
- Name/organisation prompts: `PlusOne`, country `NL` — cosmetic, not verified.
- Store **the `.jks` file + password + alias** in the password manager (attachment). That
  is the only durable copy besides Codemagic. `*.jks`/`*.keystore` are gitignored
  (`android/.gitignore`); `tests/unit/codemagic-android-release.test.ts` fails CI if one
  is ever tracked.

## 3. Google Cloud service account (what Codemagic uses to talk to Play)

1. <https://console.cloud.google.com> → pick (or create) a project, e.g. the PlusOne
   Firebase project → **APIs & Services → Library** → enable **Google Play Android
   Developer API**.
2. **IAM & Admin → Service Accounts → Create service account** → name
   `codemagic-play-publisher` → **grant it no Google Cloud roles** (skip both optional
   steps) → Done. It needs no GCP permissions at all; its only power comes from step 4.
3. Open it → **Keys → Add key → Create new key → JSON** → a file downloads. This file is
   a secret: password manager + Codemagic (step 5), then delete it from Downloads.
   - If Google refuses with `iam.disableServiceAccountKeyCreation`, the project's org
     policy blocks keys (default for new Google Cloud organizations since 2024): lift it
     for this project under **IAM & Admin → Organization Policies**, create the key, and
     turn the policy back on.
4. Play Console → **Users and permissions** → **Invite new users** → paste the service
   account e-mail (`codemagic-play-publisher@<project>.iam.gserviceaccount.com`):
   - **Account permissions:** none.
   - **App permissions → Add app → PlusOne**, and grant only **Release apps to testing
     tracks** (plus **View app information**, which Play adds automatically). **Not**
     "Release to production", not admin, not financial data.
   - **Invite user**. Linking a Cloud project under "API access" is no longer needed.

Source: Codemagic, *Google Play publishing with codemagic.yaml* —
<https://docs.codemagic.io/yaml-publishing/google-play/> (accessed 2026-09-25).

## 4. Codemagic account + repo

1. <https://codemagic.io/signup> → sign up **with GitHub** → authorize the Codemagic
   GitHub App for **only** the `PlusOne` repository.
2. **Add application** → GitHub → `Max-Seffelaar/PlusOne` → project type **Other /
   codemagic.yaml**. Codemagic reads `codemagic.yaml` from the branch you build.
3. Free plan = 500 Mac mini M2 minutes/month, 1 concurrent build — that is why the
   workflow uses `mac_mini_m2` (<https://codemagic.io/pricing/>, accessed 2026-09-25).

## 5. Secrets in Codemagic

1. **Keystore:** Team settings → **codemagic.yaml settings → Code signing identities →
   Android keystores → Add keystore** → upload `plusone-upload.jks`, enter the password,
   alias `plusone-upload`, key password (same), **Reference name `plusone_upload_key`**
   (must match `codemagic.yaml` exactly).
2. **Play credential:** the app → **Environment variables** → add
   `GOOGLE_PLAY_SERVICE_ACCOUNT_CREDENTIALS` → paste the **whole** JSON file contents →
   group **`google_play`** → tick **Secret** → Add.
3. Do **not** add `CAP_SERVER_URL` anywhere in Codemagic — the build refuses it.

Source: <https://docs.codemagic.io/yaml-code-signing/signing-android/> (accessed 2026-09-25).

## 6. First build

Precondition: <https://app.plus-one.io/login> shows the login page (see top). Then
Codemagic → the app → **Start new build** → branch `main` → workflow
**Android release → Play internal** → Start.

Expected on this very first run: every build step green, then **the Google Play publish
step fails** (Play doesn't know the package yet). That is normal: Codemagic states *"The
very first version of your app must be uploaded to Google Play manually"*
(<https://docs.codemagic.io/yaml-publishing/google-play/>, accessed 2026-09-25) — the Play
Developer API can only upload to an app whose package already exists in Play Console.
Download `app-release.aab` from the build's **Artifacts**.

## 7. First (manual) upload + Play App Signing

1. Play Console → PlusOne → **Test and release → Testing → Internal testing** →
   **Create new release**.
2. **App integrity / Play App Signing:** choose **Use Google-generated key** (recommended,
   the default). Our `.jks` stays the upload key.
3. Drag in the downloaded `app-release.aab` → package name becomes
   `app.plusone.guestlist` forever → release name defaults to `<versionCode> (1.0.0)`
(the versionCode is Codemagic's build number here — not necessarily `1` if earlier runs
failed; that is fine) → **Next →
   Save** → **Roll out to internal testing**.
4. If Play lists unfinished "Set up your app" items that block the rollout, finish them on
   the Dashboard (app access, ads, content rating, target audience, data safety, privacy
   policy URL — the privacy URL depends on L1 being live).

From now on, every Codemagic build uploads by itself as a **draft** on the internal track:
open **Internal testing → Releases**, review, **Roll out**.

## 8. Internal testers

1. **Internal testing → Testers → Create email list** (e.g. `PlusOne team`) → add Google
   account e-mails (max 100) → Save → tick the list.
2. Copy **"Join on the web"** under *How testers join your test*. Each tester opens it on
   the phone, accepts, then installs PlusOne from the Play Store link on that page.

## 9. Closed testing (venues)

1. **Test and release → Testing → Closed testing → Create track** (or use the default
   *Closed testing – Alpha*) → **Testers**: an e-mail list or a Google Group of venue staff.
2. **Create new release → Add from library** → pick the internal build → roll out.
   Closed testing releases go through Play review (hours to a few days).
3. **The 12-testers / 14-days rule does not apply to us.** Google requires it only from
   *"personal developer accounts created after November 13, 2023"*
   (<https://support.google.com/googleplay/android-developer/answer/14151465>, accessed
   2026-09-25). M2 is an **organization** account, so production access is not gated on a
   closed test. (The number was 20 testers when the rule launched; Google lowered it to 12
   in December 2024 — the brief's "20" is out of date.)

## 10. SHA-256 of the app signing key (needed for S4 `assetlinks.json`)

Play Console → PlusOne → **Test and release → Setup → App signing** (older menus: *Setup →
App integrity → App signing*):

- **App signing key certificate → SHA-256 certificate fingerprint** — this is the one
  S4 needs: it signs the APKs Play installs on phones.
- **Upload key certificate → SHA-256** — add it too only if you want app links to work on
  a sideloaded Codemagic build.
- The same page offers a ready-made **Digital Asset Links JSON** snippet.

Only exists after step 7 (Google generates the app signing key on the first upload).

## Releasing after setup

- **Manual:** Codemagic → Start new build → `main` → `android-release`.
- **Tag:** `git tag android-v1.0.1 && git push origin android-v1.0.1` (bump
  `APP_VERSION_NAME` first if the version name should change).
- Only a commit already on `main` builds; tag a merged commit.
- Then check <https://app.plus-one.io/login> loads, and Play Console → Internal testing →
  the new draft → **Roll out**.

**Recommended:** GitHub → repo **Settings → Rules → Rulesets → New tag ruleset**, target
`android-v*`, restrict creations/updates/deletions to admins — so only you can start a
release by tag.

## If something is compromised

- **Service account key leaked:** Google Cloud → the service account → Keys → **delete**
  the key (instant), create a new one, replace the Codemagic variable. What it could do
  in the meantime, on PlusOne only: roll out or halt existing releases on testing tracks
  and edit those tracks. It cannot push a *new* binary without the upload key too (Play
  rejects an AAB that isn't signed with it), cannot touch production (no permission), and
  has no access to other apps, finance or users.
- **Upload key leaked:** Play Console → App signing → **Request upload key reset**; the
  app signing key (Google's) is unaffected, so users' installed app stays trusted.
