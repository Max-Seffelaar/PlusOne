# Performance-baseline — STAP 3.5a (+ scale/concurrency stress)

> Bron: meet-sessie 2026-06-21 (read-only). Hoort bij `launchplan-claude-code.md` DEEL D (STAP 3.5a/3.5b).
> Fixes + vóór/na-hermeting leven in ClickUp onder **3.5b** (`86exzefv8`); deze doc is het bewijs + de recipe.
> **Niets in deze meting wijzigde app-code of liet DB-residu achter** (stress-data committed → superuser-teardown → baseline geverifieerd).

## Samenvatting in één zin

De **database houdt het** (495 check-ins/sec, geïndexeerde reads 13 ms); de **client en de read/realtime-vorm niet** — en er zitten **twee echte bugs** in (reads kappen af op 1000 rijen; realtime dropt boven 10 events/sec) die vóór de perf-polish moeten.

## Hoe gemeten

- **Bundle/route:** `pnpm build` route-tabel + `.next/app-build-manifest.json` (exact, prod).
- **Query-tijden:** `EXPLAIN (ANALYZE, BUFFERS)` als `authenticated`-rol mét RLS-claims, op de echte read/write-paden.
- **Web Vitals:** prod `next start` + Playwright/Chrome met de echte ingelogde sessie in de cookie-jar (data laadt écht — geverifieerd 0× 401), via een CSP-strip-proxy zodat de prod-build de lokale Supabase mag bereiken. Mobiel = Slow-4G + 4×CPU; desktop = ongethrottled.
- **Caveat:** gemeten tegen de **lokale** Supabase (≈0 ms RTT). Echte hosted prod (eu-west-1) telt netwerk-RTT op per round-trip → de data-afhankelijke cijfers (deur-snapshot, eventday) vallen op echt mobiel **hoger** uit. Bundle-cijfers zijn exact. Seed-event = 33 gasten; spec-target 50–150; stress tot 1500.

## Web Vitals (data-populated, prod)

| Scherm | LCP mob | LCP desk | FCP mob | CLS mob | INP mob |
|---|---|---|---|---|---|
| Gastenlijst `/app` | **3,96 s** | 1,25 s | 1,52 s | 0,00 | 72 ms |
| Event-dag `/eventday` | 3,56 s | 0,86 s | **3,56 s** (wit tot data) | 0,01 | 56 ms |
| Deur `/door/[id]` | 2,87 s | 1,16 s | 1,52 s | **0,298** | 72 ms |

Drempels: LCP goed <2,5 s / poor >4,0 s · CLS goed <0,1 / poor >0,25 · INP goed <200 ms. INP overal goed; desktop overal goed; CLS goed behalve de deur.

## Bundle per route (First Load JS, prod)

| Route | First Load JS | wat erin zit |
|---|---|---|
| `/app` | **272 kB** | page-chunk 206 kB raw = de hele po-SPA; `src/components/po/app.tsx` importeert élk scherm statisch; chart-bundle (recharts) eager |
| `/eventday` | 216 kB | shared + chart-bundle |
| `/door/[id]` | 206 kB | shared + deur-logica (géén charts) |
| shared baseline | 102 kB | react-dom + framework + supabase |

## Query-tijden (RLS-on, lokale DB)

- **Lijst laden** (`fetchPoGuests`): ~1,1 ms, index-backed; schaalt naar 1500 (13 ms, bitmap-index) — gezond.
- **Deur-snapshot** (`fetchDoorSnapshot`): elke query <1 ms, maar **4-diepe sequentiële round-trip waterfall** (event → [venue,guests,tiers] → [check_ins,refusals] → profiles).
- **Check-in schrijven** (`gateway.ts`): **7,3 ms** incl. triggers (`sync_guest_status` 3,4 + `audit` 1,5) — prima; de deur gebruikt de offline-outbox, dus de user blokkeert hier nooit op.
- **Cockpit:** `event_stats_summary` 2,8 ms (zwaarste DB-call) + fan-out van losse hooks met dubbele guests/tiers-reads.

## Stress test — 1500 gasten + 5× gelijktijdig inchecken

| Meting | @33 gasten | @1500 gasten | oordeel |
|---|---|---|---|
| Deur cold-load (mobiel) | ~3 s | **14,3 s** | onbruikbaar traag |
| Snapshot-download | ~5 kB | **541 kB**, ~13.850 DOM-nodes | zwaar |
| **Gasten zichtbaar aan de deur** | 33/33 | **1000 / 1532** | **~532 onzichtbaar** |
| Zoeken (INP/toets) | ~70 ms | **224 ms** | poor |
| Deur-CLS (mobiel) | 0,30 | 0,201 | poor |
| **5× gelijktijdig inchecken** | — | **1000 check-ins in 2,0 s = 495/sec, 0 fouten, p95 13 ms** | **uitstekend** |

**🚩 Correctheids-bug (afkapping):** `Content-Range: 0-999/1532` — PostgREST kapt elke losse `.select()` af op 1000 rijen. `fetchDoorSnapshot` + `fetchPoGuests` + headcounts/arrivals doen één `.select()` zónder `.range()` → bij 1500 gasten zijn ~532 gasten onzichtbaar aan de deur (niet incheckbaar) + tellers fout. **Backend-writes zijn juist rotsvast.**

## Realtime test — `eventsPerSecond` drop

Schone test: 500 check-ins burst (596/sec), 2 subscribers naast elkaar.

| Subscriber | Ontvangen | Drop | Lag |
|---|---|---|---|
| **default 10/s (= wat de app nu doet)** | **0 / 500** | **100%** | — |
| raised 200/s | 500 / 500 | 0% | p50 161 ms · p95 219 ms |

**🚩 Root cause:** `getDoorClient` (`src/features/door/offline/device.ts`) + de browser-client (`src/lib/supabase/client.ts`) zetten geen realtime-params → supabase-js default `eventsPerSecond: 10`. Boven ~10 check-ins/sec dropt de deur/cockpit realtime-events **stil** tot een refetch. Quick fix = `eventsPerSecond` ophogen + refetch-on-reconnect; échte schaalfix = `postgres_changes` → **Broadcast**.

## Top-bevindingen → 3.5b-taken (MVP-cut)

| # | ClickUp | Bevinding | MVP? |
|---|---|---|---|
| #0a | `86ey0rdp1` | Ranged reads (1000-afkapping) | **JA** (events >1000) |
| #0b | `86ey0rdpf` | Realtime throttle fix | **JA** |
| #1a | `86ey0rdpw` | Lijst-virtualisatie | **JA\*** (grote events) |
| #1b | `86ey0rdqh` | Zoeken debouncen | nee\* |
| #2a | `86ey0rdqq` | `/app` code-split (recharts lazy) | nee (polish) |
| #2b | `86ey0rdr0` | First-paint + deur-CLS | nee (polish) |
| #3 | `86ey0rdra` | Realtime→Broadcast + read-load + tier/pooling/kosten | nee (schaal-track) |

## Platform-fit op doel-schaal (500+ orgs gelijktijdig)

**Vercel + Supabase + de codebase houden stand — maar niet met de huidige read/realtime-patronen. Geen rewrite; een read/realtime-laag-harding.**

- **Vercel** — niet de bottleneck (zwaar werk gaat direct browser→Supabase). Aandachtspunt = kosten.
- **Postgres** — datavolume triviaal; 500 tenants + RLS is standaard. Mits passende compute-tier + Supavisor-pooling + efficiënte RLS-helperfuncties. DB is niet de muur.
- **Realtime (`postgres_changes`)** — **#1 schaalrisico:** evalueert RLS per subscriber per wijziging (gedocumenteerd plafond). Naar **Broadcast** voor de concurrency-doel.
- **Wat breekt eerst:** (1) realtime fan-out, (2) read-druk uit chatty polling/waterfalls/½MB-snapshots, (3) de 1000-afkapping. Níét: ruwe DB-capaciteit, writes, Vercel.

## Meet-recipe (read-only, reproduceerbaar voor 3.5b vóór/na)

- **Bundle:** `pnpm build` route-tabel; `.next/app-build-manifest.json` voor route→chunk-mapping.
- **Query-tijden RLS-on:** `docker exec -i supabase_db_PlusOne_Guestlist psql -U postgres` → `set local request.jwt.claims = '{"sub":"<uid>","role":"authenticated","aal":"aal2"}'; set local role authenticated;` dan `explain (analyze, buffers)`. Check-in WRITE meten in `begin; … insert …; rollback;`.
- **Web Vitals data-populated:** prod `next start` + mini CSP-strip reverse-proxy (verwijder de `content-security-policy` response-header) zodat de client de lokale Supabase mag bereiken. Auth-cookie `sb-127-auth-token` is **niet httpOnly** → Playwright `addCookies` (channel:'chrome', geen browser-download) zet 'm in de JAR (anders 401 → alleen shell). CDP-throttle: `Network.emulateNetworkConditions`(150 ms/1,6 Mbps) + `Emulation.setCPUThrottlingRate{rate:4}`. Lighthouse via `npx -y lighthouse` (niet `pnpm dlx`); chrome-launcher gooit op Windows EPERM bij temp-cleanup ná een geslaagde run (check op file-bestaan, niet exit-code).
- **Realtime delivery:** 2 Node-subscribers (default vs `eventsPerSecond` raised) op `postgres_changes` INSERT `check_ins`; burst inserts via supabase-js; match receipt vs insert per `guest_id`. Borg dat `guests`+`check_ins` in de `supabase_realtime` publicatie zitten (lokale quirk: leegt bij restart).
- **Scale-data + teardown:** committed naar een event + superuser-teardown (capture ids → `delete check_ins`+`guests` → purge `audit_log` by `entity_id`; verifieer baseline terug). De DB is een gedeelde stack — claim 'm (geen andere sessie test mee) en ruim op.
