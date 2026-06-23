# Test-run rapport — STAP 4.1

> ClickUp [Claude] 4.1 — uitvoerbare test-suites afmaken + draaien.
> Datum: **2026-06-23** · main-commit: `41de6fb` · Node v24.13.1 · Supabase CLI 2.106.0 · Vitest 1.6.1.
> Scope: **alleen bestaande features**. Stripe-webhook, ticketing-adapter/Vault en deurtaken-realtime/push zijn **uitgesteld** (feature bestaat nog niet).

## Samenvatting

| Suite | Bestanden | Tests | Resultaat |
|---|---|---|---|
| **Vitest** (unit, `pnpm test`) | 39 | **434** | ✅ alle groen |
| **pgTAP** (RLS/triggers, `pnpm db:test`) | 22 | **529** | ✅ alle groen (verse reset) |
| `pnpm lint` | — | — | ✅ geen warnings/errors |
| `pnpm type-check` (`tsc --noEmit`) | — | — | ✅ 0 fouten |

Sequentieel gedraaid (lint → type-check → Vitest → `db:fresh` → `db:test`), zoals de taak vraagt. De **`supabase db reset` liep volledig schoon** — alle ~40 migraties in volgorde toegepast + seed geladen: bewijs dat er **geen migratie-timestamp-collisies** op main staan.

## Wat is toegevoegd (gaten gedicht voor bestaande logica)

Baseline was al groen (37 bestanden / 421 tests). De gaten zaten in de **offline outbox** (#25) en de **secret-confinement**; de andere genoemde gebieden bleken al dekkend:

| Bestand | + Tests | Gat dat het dicht |
|---|---|---|
| `src/features/door/outbox/replay.test.ts` | +4 | `replayEntry` voor de kinds **`refusal`** en **`ack_note`** ontbrak (6 van 8 kinds getest → nu 8/8): reason/refused_by/event/device gepind, idempotente re-send (pkey-conflict → synced), ack/heropen-flag doorgegeven. |
| `src/features/door/outbox/types.test.ts` *(nieuw)* | +5 | Pure statushelpers `isPending` / `isRetryable` / `hasUnsynced` (sturen de auto-drainer, force-sync en de sync-bar-dot) waren ongetest. |
| `src/lib/supabase/service-confinement.test.ts` *(nieuw)* | +4 | **Secret-grep in CI** (DEEL D): faalt de suite als de `service_role`-key buiten de éne `server-only`-module opduikt, of als een `'use client'`-component de service-client importeert. Draait mee in de bestaande `pnpm test`-stap van CI. |

Totaal **+13 tests / +2 bestanden** (421 → 434).

## Dekkingskaart per gevraagd gebied

**Vitest — bestaande logica (de 5 genoemde gebieden):**

- **Quota-math / +N (1+N slots, #5/#22):** `po/eventday/cockpit.test.ts` (25 — `heads`, `arrivedHeads`, `insideHeads`, `partyState`, `cockpitTiles`, `perTierLive`, partial party), `door/model.test.ts` (12 — `insideHeadcount`/`registeredHeadcount`, gesplitste party, void), `po/adapters.test.ts` (47 — `toPoHome` quotaFree/walking/attendancePct, exempt), `guests/quick-add-parser.test.ts` (`totalSlots`, `slots = 1+plusOnes`). **Dekkend.**
- **Lock (#23):** `events/lock.test.ts` (5 — `isEffectivelyLocked` mirror van `can_write_guests`: manueel, auto-lock-instant, onparseerbaar). DB-handhaving zit in pgTAP `rls`/`events`. **Dekkend.**
- **Outbox (#25/#11):** `replay.test.ts` (21) + `types.test.ts` (5) — alle 8 kinds, `classifyError` (23505 guest_id→duplicate, pkey→synced, 45001/45002→error, netwerk→pending), FIFO-drain, idempotentie, early-stop. **Dekkend (nu compleet).**
- **Parser (#33):** `quick-add-parser.test.ts` (49 — cases a/b/c, +N-grammatica NL, fuzzy/ambiguous, e-mail/telefoon-capture, `resolveAmbiguity`, `parseBulk`, `totalSlots`). **Dekkend.**

**pgTAP — bestaande features (22 bestanden, 529 tests):**

- **Aanvaller-scenario's (allowed én denied per rol):** `rls`, `contacts.rls`, `tables` (GRANT-matrix + hard-DELETE ingetrokken voor app-rollen, #21), `auth.invites`.
- **Quota & +N:** `quota` (1+N, 45001/45002), `permanent` (is_permanent/quota-exempt).
- **Deur / check-in (deur-PWA-uitbreiding):** `checkin.incremental` (top-up + monotone cap), `checkin.void` (soft-void/revive), `checkin_scope` (event_id/venue_id scope-trigger), `door_status_sync`, `allow_uncheck`.
- **Audit & analytics (log-vertaling/aggregaties/leesrechten):** `audit` (actor/action/diff), `analytics` (`event_stats_summary` + per-tier, admin/finance/organizer-gating).
- **Anonimisering (geen PII-restant, idempotent):** `privacy`, `contacts.privacy`.
- **Overig bestaand:** `events`, `landing` (rate-limit, lekt geen bestaan-van-e-mail), `onboarding`, `contacts.autolink`/`capture`/`dedup`, `realtime` (publication-membership).

## Dekkingsgaten (eerlijk — bestaande features)

1. **Geen line-coverage-meting.** De getallen zijn test-aantallen, niet `c8`/`v8`-coverage. De pure feature-logica is sterk gedekt; component-render-tests zijn dun (alleen `CheckInList.test.tsx` + `app.code-split`).
2. **Server actions niet direct unit-getest.** `*/actions.ts` (guests/quota/events/door/contacts) zijn niet als functie aangeroepen in unit-tests; hun gedrag wordt **indirect** afgedekt door (a) Zod-schema-tests, (b) de outbox-gateway-tests, en (c) de pgTAP RLS/trigger-laag die de échte grens is. Dit is by-design (RLS = boundary), maar een expliciete actie-integratietest ontbreekt.
3. **e2e (Playwright kernflow)** is **niet** in deze sessie gedraaid — dat is **STAP 4.3** (invite→login→event→gasten→lock→deur-offline→audit→stats). De Playwright-config staat klaar onder `tests/e2e/` en is uitgesloten van `pnpm test`.
4. **Realtime-gedrag** is op DB-niveau getest (publication-membership) en op throttle-niveau (`realtime-throttle.test.ts`), maar de end-to-end fan-out (postgres_changes→Broadcast) hoort bij de schaal-track (STAP 3.5 #3), niet hier.

## Uitgesteld (feature bestaat nog niet — bewust niet getest)

- **Stripe-webhook** (`checkout.session.completed` etc.) — handler bestaat nog niet; alleen de pure `billing/plans.ts`-catalogus is getest (`plans.test.ts`, 8).
- **Ticketing-adapter / Vault** — phase-3 connector (#36), niet aanwezig.
- **Deurtaken-realtime / push-notificaties** — notifications-seam bestaat als abstractie, maar geen web-push/FCM-adapter om te testen.

## Reproduceren

```bash
pnpm install
pnpm lint && pnpm type-check && pnpm test   # 39 files / 434 tests
pnpm db:fresh                                # supabase db reset + seed + dev-mfa
pnpm db:test                                 # 22 files / 529 pgTAP tests
```

> **DB-hygiëne:** `db:fresh`/`db:test` zijn tegen de gedeelde lokale stack gedraaid en daarna **vrijgegeven**. Tijdens deze run hield deze sessie de DB vast; geen andere sessie mag in dat venster `db:fresh`/`db:reset`/`db:push` draaien.
