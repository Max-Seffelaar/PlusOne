# Play Console — click-by-click checklist (PlusOne, first Android release)

For Max. One action per numbered step. Each step has: **Where** (the exact menu path), **Do**
(what to enter and where to copy it from) and **Check** (how you know it worked). Tick the
box as you go.

Menu paths are what Play Console showed as of 2026-09/10. Google renames menus now and
then. If a label is slightly different, look for the closest match in the left menu;
**never** pick an answer that doesn't match the source file.

**Before you start**
- The app already exists in Play Console and the first AAB is on the **internal** track
  (`docs/native/android-release.md` steps 1–7). If not, do those first.
- `https://app.plus-one.io/login` loads (desktop + phone).
- Have open: `docs/store/play-store-listing.md` (texts + data safety),
  `docs/store/play-review-notes.md` (app access + declarations), `docs/store/play-rollout.md`.
- Sources = files in this repo. "Paste" always means copy the exact text from that file,
  without the `>` quote marks.

**⛔ = BLOCKED until L1.** The privacy policy at **`https://www.plus-one.io/legal#privacy`**
must show the **lawyer-approved v0.2 text** (not the draft) before you do a ⛔ step. Steps
without ⛔ can be done now and saved; Play keeps them as a draft until you send for review.

**🟧 = needs a decision or a fix first** (see the PR / ClickUp task). Don't skip it, and
don't make something up.

---

## A. Dashboard → "Set up your app" (the declarations)

Start every step from **Play Console → PlusOne → Dashboard → "Set up your app"**. Each
line there opens one form. All of them also live under **Policy and programs → App content**.

1. [ ] ⛔ **Privacy policy**
   - Where: Dashboard → Set up your app → **Set privacy policy** (= App content → Privacy policy).
   - Do: paste `https://www.plus-one.io/legal#privacy` → **Save**.
   - Check: open the URL in a private browser window. It must show the final (approved)
     policy, and the Dashboard task gets a green tick.

2. [ ] **Ads**
   - Where: Set up your app → **Ads**.
   - Do: **No, my app does not contain ads** → Save. (Source: `play-review-notes.md` §2.)
   - Check: green tick on the task.

3. [ ] **Advertising ID**
   - Where: App content → **Advertising ID** (sometimes only shown after the first AAB upload).
   - Do: first do the Merged Manifest check in `play-review-notes.md` §3. Then **No** → Save.
   - Check: the card says "Does not use advertising ID". If Merged Manifest showed `AD_ID`:
     stop and report it, don't answer.

4. [ ] **Content rating — start**
   - Where: Set up your app → **Content rating** → **Start questionnaire**.
   - Do: e-mail address = your developer contact address. Category = **All other app types**.
   - Check: the questionnaire opens on the first topic.

5. [ ] 🟧 **Content rating — answers**
   - Do: answer every topic exactly as in the table in `play-review-notes.md` §4. The one to
     decide: the alcohol question ("reference only" = **Yes**, every follow-up **No**).
   - Check: the **Summary** page shows the ratings (PEGI/ESRB/…) before you submit.

6. [ ] **Content rating — submit**
   - Do: **Save** → **Submit**.
   - Check: the task gets a green tick, and App content → Content rating shows the rating
     per region.

7. [ ] **Target audience — ages**
   - Where: Set up your app → **Target audience and content**.
   - Do: tick only **18 and over** → Next.
   - Check: no other age box is ticked.

8. [ ] **Target audience — appeal to children**
   - Do: "Could your store listing unintentionally appeal to children?" → **No** → Next →
     Save. (Source: `play-review-notes.md` §5.)
   - Check: green tick; the summary says "18 and over".

9. [ ] **News app**
   - Where: Set up your app → **News apps**.
   - Do: **No** → Save.
   - Check: green tick.

10. [ ] **Government app**
    - Where: App content → **Government apps** (if listed).
    - Do: **No** → Save.
    - Check: green tick / "Not a government app".

11. [ ] **Financial features**
    - Where: App content → **Financial features**.
    - Do: tick **My app doesn't provide any financial features** → Save.
    - Check: green tick.

12. [ ] **Health**
    - Where: App content → **Health apps**.
    - Do: tick **My app does not have any health features** → Save.
    - Check: green tick.

13. [ ] **App category + contact details**
    - Where: Set up your app → **Select an app category and provide contact details**
      (= Grow users → Store presence → **Store settings**).
    - Do: App or game = **App**; Category = **Business**; Tags: optional, pick at most
      "Event planning"-style tags if offered, otherwise none. E-mail = the support address
      (🟧 until Max confirms the mailbox); Website = `https://www.plus-one.io`; Phone: leave empty.
    - Check: **Save** turns grey (saved), and the Dashboard task gets a green tick.

## B. Store listing (texts + graphics)

14. [ ] **Open the main store listing**
    - Where: Grow users → Store presence → **Main store listing** (Dashboard: "Set up your
      store listing").
    - Check: default language at the top says **Dutch – nl-NL**. If not: Store settings →
      change it before you paste anything.

15. [ ] **App name (NL)**
    - Do: `PlusOne`.
    - Check: counter ≤ 30.

16. [ ] **Short description (NL)**
    - Do: paste from `play-store-listing.md` → Dutch → *Short description*.
    - Check: counter shows **63/80**.

17. [ ] **Full description (NL)**
    - Do: paste from `play-store-listing.md` → Dutch → *Full description*. Play doesn't
      render `**bold**`: remove the `**` markers after pasting (keep the words).
    - Check: no `**` or `>` left in the field; counter < 4000.

18. [ ] **App icon (512 × 512)**
    - Do: upload a **512 × 512 px PNG (32-bit, with alpha), max 1 MB**. The source is the app
      icon from N3 (`docs/store/preview/` has the preview). Max exports it at 512.
    - Check: the preview shows the icon unclipped. Play rounds the corners itself, so
      don't upload it pre-rounded.

19. [ ] **Feature graphic (1024 × 500)**
    - Do: upload **`store-screenshots/play-feature-graphic/play-feature-graphic.png`**
      (generator output, **1024 × 500 px**, 24-bit PNG, no alpha; Play allows max 15 MB).
      Get the folder from the **Store screenshots** workflow artifact (or
      `pnpm store:screenshots`), see `docs/store/screenshots.md`.
    - Check: the preview shows it and Play gives no size error.

20. [ ] **Phone screenshots**
    - Do: upload all five PNGs from **`store-screenshots/play-phone/`** (`01-home.png` …
      `05-stats.png`, in that order). Generator size: **1080 × 1920 px** portrait (9:16),
      24-bit PNG, no alpha. Play wants 2–8, JPEG or 24-bit PNG, 9:16 or 16:9, each side 320–3840 px.
    - Check: all show in the phone row in the right order. No real guest names visible (the
      generator uses demo data only).

21. [ ] **7-inch tablet screenshots**
    - Do: upload all five PNGs from **`store-screenshots/play-tablet-7-inch/`**
      (`01-home.png` … `05-stats.png`). Generator size: **1188 × 2112 px** portrait (exactly
      9:16, bottom-tab T1 tablet layout). Play wants 2–8, 16:9 or 9:16, each side 1080–7680 px.
    - Check: they show in the "7-inch tablet" row and the layout is the T1 tablet layout,
      not a stretched phone.

22. [ ] **10-inch tablet screenshots**
    - Do: upload all five PNGs from **`store-screenshots/play-tablet-10-inch/`**
      (`01-home.png` … `05-stats.png`). Generator size: **2560 × 1440 px** landscape (exactly
      16:9, sidebar layout). Play wants 2–8, 16:9 or 9:16, each side 1080–7680 px.
    - Check: they show in the "10-inch tablet" row.

23. [ ] **Save the NL listing**
    - Do: **Save** (bottom right).
    - Check: no red errors; the top says "Changes saved" / nothing unsaved.

24. [ ] **Add English (translation)**
    - Where: same page → **Manage translations → Add your own translation text** → tick
      **English (United Kingdom) – en-GB** *and* **English (United States) – en-US** → Apply.
    - Check: a language switcher appears at the top of the listing.

25. [ ] **English texts**
    - Do: for each English language, paste name `PlusOne`, the English short description
      (**61/80**) and the English full description from `play-store-listing.md` → English
      (remove `**` again). Graphics carry over from NL; leave them.
    - Check: Save; switch the language back and forth and the texts are there.

## C. Data safety

26. [ ] **Open Data safety**
    - Where: Policy and programs → App content → **Data safety** → **Start** (or Manage).
    - Check: you see the "Overview" page.

27. [ ] **Data collection and security**
    - Do: answer Q1–Q3 exactly as in `play-store-listing.md` → "Step 1".
    - Check: the "account creation" question shows **Username and other authentication**.

28. [ ] **Delete account URL**
    - Do: paste **`https://www.plus-one.io/delete-account`** (live). The in-app path is
      **Profile → Delete account** (live; it opens the same URL).
    - Check: open the URL in a private window and see the deletion steps; in the app, Profile
      shows the Delete account row.

29. [ ] **Data types**
    - Do: tick exactly the ✅ rows of the "Step 2" table, nothing else.
    - Check: the list on the next page has exactly those 10 types: Name, Email address,
      User IDs, Phone number, Other info, Other user-generated content, Other actions,
      Crash logs, Diagnostics, Device or other IDs.

30. [ ] **Per data type (×10)**
    - Do: for each type click it and answer from the "Step 3" table: Collected ✓, Shared ✗,
      ephemeral **No**, required/optional, purposes.
    - Check: every type shows "Completed".

31. [ ] ⛔ **Preview + submit Data safety**
    - Do: **Next** → read the **preview** (what users will see) → **Save** → submit.
    - Check: the preview says "No data shared with third parties" and lists the types
      above, and the App content card is green.

## D. App access

32. [ ] 🟧 **App access: restricted**
    - Precondition: the review-login **blocker** in `play-review-notes.md` (top) is fixed and
      deployed, and the code + expiry are set in Vercel (`docs/review-login.md` → "Per submissie").
    - Where: Policy and programs → App content → **App access**.
    - Do: tick **All or some functionality in my app is restricted** → **Add instructions**.
    - Check: an instruction form opens.

33. [ ] **App access: the instructions**
    - Do: fill the four fields from `play-review-notes.md` §1. The Password field gets the
      **real review code**, typed here from your password manager only. Replace the
      `<…>` placeholders in the text (expiry date, support address).
    - Check: no `<` or `>` placeholder left in the text. **Save**.

34. [ ] **App access: try it yourself**
    - Do: on an Android phone with the internal-track build, follow the steps from the
      text exactly (sign in with the code, accept terms, Requests, Check-in, airplane mode).
    - Check: every step works as written. If one doesn't, fix the text or the app before
      step 39.

## E. Production release

35. [ ] **Countries**
    - Where: Test and release → **Production** → tab **Countries/regions** → **Add
      countries/regions**.
    - Do: tick **Netherlands** (plus Belgium if Max wants it; the listing is NL/EN). Save.
    - Check: the tab lists exactly the chosen countries.

36. [ ] **Create the production release**
    - Where: Production → **Create new release** → **Add from library**.
    - Do: pick the version code that passed internal testing (`play-rollout.md` step 0;
      or closed testing, step 1). Don't upload a new AAB here.
    - Check: the release shows package `app.plusone.guestlist` and that version code.

37. [ ] **Release name + notes**
    - Do: release name = keep Play's default (`<versionCode> (<versionName>)`). Release
      notes: paste "What's new (initial release)" from `play-store-listing.md`, NL in the
      `<nl-NL>` block, EN in the `<en-GB>`/`<en-US>` blocks.
    - Check: Next shows no errors (warnings about "no deobfuscation file" are fine for
      this app).

38. [ ] **Staged rollout 10%**
    - Do: on the review page set **Rollout percentage** to **10%** → **Save**. (Plan:
      `play-rollout.md` step 2.)
    - Check: the release shows "10% rollout" as a draft. **Don't** press "Start rollout"
      yet; that happens via step 39.

## F. Send for review

39. [ ] ⛔ **Publishing overview**
    - Where: left menu → **Publishing overview**.
    - Do: check that the list of "Changes ready to send for review" has the store listing,
      all App content declarations, Data safety, App access and the production release.
      Turn **Managed publishing** **on** (so an approval doesn't go live by itself).
    - Check: no item says "Action required"; the Dashboard has no open "Set up your app" tasks.

40. [ ] ⛔ **Send for review**
    - Do: **Send N changes for review** → confirm.
    - Check: Publishing overview says "In review". Expect a few hours to ~7 days for a new app.
      Watch **Policy and programs → Policy status / Inbox** and your e-mail.

41. [ ] **After approval: publish**
    - Do: with Managed publishing on, go to Publishing overview → **Publish changes**. The
      rollout then starts at 10%. From here, follow `play-rollout.md` (go/no-go per step).
    - Check: Production → Releases shows "Available on Google Play, 10% rollout"; the
      store page opens on a phone in an included country.

42. [ ] **After the review: close the review window**
    - Do: once approved (or rejected), run
      `node scripts/seed-demo-venue.mjs --prod --end-review` from the linked main checkout
      (`docs/review-login.md`).
    - Check: the script reports the global sign-out; the demo account has no live sessions.
