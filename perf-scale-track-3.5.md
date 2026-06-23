# Schaal-track — STAP 3.5 #3 (realtime + read-load + tier/pooling/kosten)

> Bron: ontwerp-/ops-sessie 2026-06-22. Vervolg op `perf-baseline-3.5a.md` (3.5a baseline + 3.5b fixes, gemerged via PR #53/#54).
> ClickUp: `86ey0rdra` (#3, schaal-track). **Géén MVP/pilot-blocker** — nodig vóór grootschalige onboarding.
> Doel-schaal: **500+ orgs die mogelijk gelijktijdig werken** (clubs/event-spaces, piek vrijdag/zaterdagnacht).
>
> **Status deze sessie (2026-06-22):** de twee goedkope ops-checks zijn opgeleverd als onderbouwde analyse —
> **(d) tier/pooling-sanity** en **(f) kostenmodel** (secties 3 + 4). De vier code-tracks **(a) Broadcast,
> (b) polling, (c) caching, (e) RLS-helpers** en de **(g) hosted load-test** zijn concreet uitgewerkt als
> ontwerp (secties 5–9) maar **nog niet geïmplementeerd** — bewust: de aanrader-volgorde is eerst (g) als
> meet-fundament neerzetten, dán (a/b/c/e) implementeren mét (g) als vóór/na-bewijs. Geen app-code gewijzigd.

## Samenvatting in één alinea

De backend-writes zijn rotsvast (495 check-ins/sec, p95 13 ms) en het maandelijkse infra-**bedrag** is
verwaarloosbaar (~**€110–130/mnd voor 500 orgs ≈ €0,25/org/mnd**, sectie 4). De muur is geen kosten en geen
write-capaciteit — het zijn **(1) het realtime concurrency-plafond** (`postgres_changes` evalueert RLS per
subscriber per wijziging; `check_ins` mist bovendien een `event_id`-filter → elke check-in wereldwijd raakt
elke deur/cockpit-subscriber vóór RLS), **(2) read-druk** uit 10s-polling × veel schermen + RLS-functieketens
van 3–4 lookups per rij op de hete `check_ins`/`refusals`-reads, en **(3) een step-cost** als de gelijktijdige
realtime-websockets het plan-plafond (Pro-default ~500) overschrijden. De linchpin-fix die track (a) én (e)
tegelijk ontgrendelt: **denormaliseer `event_id` (+ `venue_id`) op `check_ins`/`refusals`.** Alles hieronder
is daarop gericht; de hosted load-test (g) is het vóór/na-bewijs dat de DoD vereist.

---

## 1. Huidige architectuur (gemeten, met file:line)

### 1a. Realtime — 2 `postgres_changes`-kanalen, 0 Broadcast

| Surface | Kanaal | Tabel · event · filter | Bij ontvangst | Mount |
|---|---|---|---|---|
| Deur | `door:${eventId}` | `check_ins` · INSERT · **géén filter** | `patchSnapshot()` (dedup op guest_id) | `useDoorSync` in `DoorProvider` ([src/features/door/sync/useDoorSync.ts:137](src/features/door/sync/useDoorSync.ts)) |
| Deur | `door:${eventId}` | `guests` · `*` · `event_id=eq.X` | upsert/remove in snapshot | idem |
| Cockpit | `eventday:${eventId}` | `guests` · `*` · `event_id=eq.X` | `invalidateQueries` ×4 | `usePoEventRealtime` ([src/features/po/hooks.ts:364](src/features/po/hooks.ts)) |
| Cockpit | `eventday:${eventId}` | `check_ins` · `*` · **géén filter** | `invalidateQueries` ×4 | idem |

- Eén browser-tab = **één websocket** (supabase-js multiplext kanalen). De gewone `/app`-schermen (home,
  gasten, events, stats) openen **géén** realtime — alleen Deur + Cockpit. Concurrent websockets ≈
  (live cockpits) + (deur-devices), **niet** elke `/app`-gebruiker.
- Client-config: `eventsPerSecond: 200` in beide clients ([src/lib/supabase/client.ts:18](src/lib/supabase/client.ts) +
  `src/features/door/offline/device.ts`). Quick-fix uit 3.5b (#0b); de échte schaalfix is Broadcast.
- Publicatie `supabase_realtime` bevat `guests` + `check_ins` (`20260614000000_realtime_door.sql`).
- **Kernprobleem:** `check_ins` heeft **geen `event_id`** ([20260613000000_full_schema.sql:270](supabase/migrations/20260613000000_full_schema.sql)),
  dus de `check_ins`-subscriptions kunnen **niet** server-side op event filteren → elke check-in (élk venue,
  élk event) wordt door de Realtime-server tegen elke subscriber z'n RLS geëvalueerd. Dat is precies het
  gedocumenteerde `O(changes × subscribers)`-plafond, hier nog versterkt door het ontbrekende filter.

### 1b. Polling + caching (TanStack Query)

| Hook | Interval | Pauzeert verborgen? | staleTime | Reads/cyclus |
|---|---|---|---|---|
| `usePoHomeEvents` ([hooks.ts:135](src/features/po/hooks.ts)) | **10 s** (`HOME_POLL_MS`) | ja (default) | 30 s | `fetchEvents` + `fetchEventHeadcounts` |
| `usePoHomeStats` ([hooks.ts:179](src/features/po/hooks.ts)) | **10 s** | ja | 30 s | `fetchOpenRequestCount` + `event_quota_status` RPC |
| `usePoEventStats` (cockpit) | — (realtime-gedreven) | — | 15 s | `event_stats_summary` |
| `usePoCheckinArrivals` (cockpit) | — | — | 10 s | arrivals |
| `useDoorSync` safety-floor | 60 s | nee (+ online/focus/visibility) | — | outbox-drain + snapshot-refetch |
| overige po-queries | — | — | 30 s | one-shot |

- QueryClient-defaults: po = `staleTime 30 s / gcTime 5 min`, `refetchOnWindowFocus:false`
  (`src/features/po/PoLiveProvider.tsx`); deur = `staleTime 30 s / gcTime 1 week`, `networkMode:'offlineFirst'`,
  IndexedDB-persist (`src/features/door/offline/query-client.ts`).
- **Home = 4 reads / 10 s** terwijl de Start-tab gemount én zichtbaar is. Cockpit pollt niet (realtime).
  Geen `unstable_cache`/ISR/HTTP-cache; alles client-side React Query + Supabase RLS.
- Deur-snapshot ([src/features/door/queries.ts:66](src/features/door/queries.ts)): ranged reads (3.5b #0a),
  ~0,36 kB/gast (541 kB @1500 → ~60 kB @100 gasten incl. tiers/checkins/refusals/profiles).

### 1c. RLS-helpers ([20260613120000_rls_policies.sql:26-198](supabase/migrations/20260613120000_rls_policies.sql))

Alle helpers zijn **`STABLE`, `SECURITY DEFINER`, `set search_path=''`, schema-qualified** en doen een
`exists(select 1 …)` tegen geïndexeerde kolommen — per *aanroep* efficiënt. De `UNIQUE(venue_id,user_id)`
op `venue_memberships` en `UNIQUE(event_id,user_id)` op `event_organizers` zijn btree-indexen (een UNIQUE
constraint *is* een index — er ontbreekt hier geen index).

Het schaalprobleem zit niet in een enkele aanroep maar in **per-rij ketens met per-rij-variërende argumenten**
op de hete reads. Voorbeeld `check_ins`-SELECT (arg = `guest_id`, varieert per rij):

```sql
using (
  public.has_venue_role(public.event_venue(public.guest_event(guest_id)), '{admin,finance,doorhost}')
  or public.is_event_organizer(public.guest_event(guest_id))
);
```

`guest_event → event_venue → has_venue_role` = **3 lookups/rij** (+ `guest_event` nogmaals voor de OR).
Een doorhost die 1500 check_ins leest ⇒ ~4500–6000 index-lookups puur voor RLS, bovenop de query zelf. Idem
`refusals`. `can_write_guests` nest intern 3× `has_venue_role`. Dit is de read-CPU die onder concurrency +
invalidatie-refetches optelt.

---

## 2. Wat breekt eerst (uit 3.5a, nu bevestigd in code)

1. **Realtime fan-out** — `postgres_changes` × per-subscriber-RLS, versterkt door de ontbrekende
   `event_id`-filter op `check_ins`. → track (a) + (e).
2. **Read-druk** — 10s-polling × veel home-tabs + RLS-functieketens op `check_ins`/`refusals`. → (b) + (c) + (e).
3. **Realtime connection-plafond** — gelijktijdige websockets vs plan-limiet (step-cost). → (d) + (f).
4. **Níét:** ruwe DB-capaciteit, writes, Vercel, of het maandbedrag.

---

## 3. (d) Compute-tier + Supavisor-pooling — sanity & sizing  ✅ opgeleverd

### 3.1 Welke as schaalt écht?

- **Postgres-verbindingen / Supavisor-pooling is NIET de bindende as.** Vrijwel alle DB-toegang loopt via
  **PostgREST** (browser-client én server-client praten REST met het user-JWT) — PostgREST multiplext over een
  interne pool; er is géén directe PG-connectie per gebruiker. Supavisor (transaction-mode) wordt pas relevant
  zodra er *directe* PG-workloads bijkomen: **Edge Functions met raw SQL, de load-test-client (g), analytics,
  migraties.** Houd Supavisor in **transaction mode** voor die gevallen; laat de pooler-grootte de default van
  de gekozen compute-tier volgen. De DB-druk die telt is **PostgREST-worker-pool + DB-CPU** uit RLS-zware reads
  onder polling — dat adresseren (b)/(c)/(e), niet de pooler.
- **Realtime concurrent connections is WÉL de bindende as.** Elke deur/cockpit-tab = 1 websocket. Dit plafond
  is plan-gebonden (zie 3.2) en is de step-cost in het kostenmodel.
- **DB-CPU is de tier-sizing-input.** Writes zijn goedkoop (baseline). De CPU-piek komt van
  read-fan-out + RLS-ketens bij gelijktijdigheid — de knie meet je met (g).

### 3.2 Sizing-methode + startaanbeveling

**Schat piek-websockets** (alleen deur + cockpit): `F × 500 orgs × ~3 websockets/live-org`, met F = fractie
orgs met een live event in het 22:00–03:00-venster:

| F (orgs live) | Piek-websockets | Past in Pro-default (~500)? |
|---|---|---|
| 10% (50) | ~150 | ja |
| 30% (150) | ~450 | krap |
| 50% (250) | ~750 | **nee → quota-verhoging of Team-plan** |

**Aanbeveling (startpunt, dan met (g) bijstellen):**
1. **Supabase Pro** + compute-add-on **Medium** als startpunt voor headroom onder RLS-read-piek (begin Small
   alleen als (g) laat zien dat het ruim past). Compute is de goedkoopste knop om DB-CPU-headroom te kopen.
2. **Supavisor transaction mode** aan; pooler-grootte = default voor de tier. Niet de bottleneck, wél nodig
   zodra Edge Functions/load-test directe PG doen.
3. **Bevestig het realtime concurrent-connection-plafond van het huidige plan** en of Pro het laat ophogen
   (spend-cap/support) — dit is de échte limiet, niet compute. Onboard niet voorbij ~150 gelijktijdig-live
   orgs zonder dit bevestigd te hebben.
4. (a) Broadcast verlaagt **CPU per bericht** (geen N×RLS), niet het *aantal* websockets — een gegeven tier
   bedient er daardoor méér. Het connection-plafond zelf blijft een plan/quota-knop.

> **⚠️ Te verifiëren in het dashboard (kan ik niet van binnenuit de repo lezen):** huidige compute-tier,
> huidige realtime concurrent-limiet + of die op Pro te verhogen is, en de actuele pooler-grootte. Zie de
> verify-checklist (sectie 10).

---

## 4. (f) Kostenmodel op doel-concurrency  ✅ opgeleverd

> **⚠️ Prijzen = gedocumenteerd begin-2026; mijn kennis-cutoff is jan 2026. Verifieer elk bedrag tegen de
> actuele Supabase/Vercel pricing-pagina vóór besluit.** Alle getallen hieronder zijn afgeleid uit het
> code-gebaseerde load-profiel (secties 1) + die richtprijzen.

### 4.1 Aannames (corrigeerbaar)

- 500 orgs onboarded; per org ~24 events/mnd, 100 gasten gem. (CLAUDE.md: "dozens of events/month, 50–150
  guests"), ~10 staff. ⇒ **12.000 events/mnd**, ~5.000 MAU.
- Piek-concurrency: scenario's F = 10/30/50% orgs gelijktijdig live (sectie 3.2).
- Realtime-berichten/event ≈ (120 check-ins + 30 guest-changes) × ~3 subscribers ≈ **450 delivered/event**.
- Egress: deur-snapshot ~60 kB × ~6 cold-loads/event; home-polling ~3 kB/read.

### 4.2 Maandbedrag bij "expected load" (500 orgs)

| Post | Berekening | ~Bedrag/mnd |
|---|---|---|
| Supabase Pro base | incl. $10 compute-credit (dekt Micro) | $25 |
| Compute add-on | Medium (headroom RLS-read-piek) | ~$60 |
| Egress | ~50–80 GB ⟨zie 4.3⟩ < 250 GB incl. | $0 |
| Realtime-berichten | 12.000 × 450 ≈ **5,4 M** vs 5 M incl. → 0,4 M × ~$2,50/M | ~$1 |
| DB-size / MAU | gasten/checkins triviaal; 5k MAU < 100k incl. | $0 |
| **Supabase subtotaal** | | **~$86** |
| Vercel Pro | 1 seat | $20 |
| Vercel edge-middleware | ~4,5 M req (elke nav draait middleware) vs 1 M incl. × ~$0,65/M | ~$2–3 |
| Vercel functions/bandwidth | server-actions/SSR ~1–2 M; assets CDN-cached | ~$0–10 |
| **Vercel subtotaal** | | **~$25–40** |
| **TOTAAL** | | **~€110–130/mnd ≈ €0,25/org/mnd** |

### 4.3 Egress-detail (waar (b)/(c) bijten)

| Bron | Schatting/mnd | Opmerking |
|---|---|---|
| Home-polling | 100 zichtbare home-tabs × 0,4 rps × ~2 u/dag × 30 d × 3 kB ≈ **~26 GB** | grootste enkele post; (b) 10s→30s ÷3, (c) snijdt herhaalde tier/venue-reads |
| Deur-snapshots | 12.000 events × 6 × 60 kB ≈ **~4 GB** | klein; cache + ranged reads doen 't werk al |
| On-demand reads | gasten/events/stats ≈ **~20–40 GB** | bounded |
| **Totaal egress** | **~50–80 GB** | ruim onder 250 GB incl. → groeimarge 3–4× |

### 4.4 Conclusie (f)

**Het maandbedrag is geen constraint** — ~€0,25/org/mnd is verwaarloosbaar tegen elke redelijke SaaS-prijs.
De enige echte kosten-/ops-**risk is een step-cost**: zodra piek-night gelijktijdige realtime-websockets het
plan-plafond (Pro-default ~500) overschrijden (F ≥ ~30%), is een **quota-verhoging op Pro** of de **Team-plan
(~$599/mnd)** nodig. Die step is gekoppeld aan *concurrency*, niet aan maandvolume. Daarom: (a)/(b)/(c)/(e)
de-risken de step (lagere CPU/bericht + minder reads = meer orgs per tier), en het bevestigen van de
realtime-limiet (sectie 3.2 pt 3) is de goedkoopste actie vóór échte traffic. Realtime-berichten zitten
bovendien dicht op de 5 M-inclusielijn — monitoren, geen actie.

---

## 5. (a) Realtime `postgres_changes` → Broadcast  ⏳ ontwerp

**Waarom:** `postgres_changes` evalueert de tabel-RLS **per subscriber per wijziging** in de Realtime-server.
Broadcast autoriseert **één keer bij channel-join** (RLS-policy op `realtime.messages`), niet per bericht →
de `O(changes × subscribers)`-RLS-kost verdwijnt. Berichtaantal blijft ~gelijk; de **CPU per bericht** daalt.

**Ontwerp — "Broadcast from Database":**
1. **Prereq:** denormaliseer `event_id` op `check_ins`/`refusals` (sectie 7) — levert de topic-sleutel.
2. AFTER-trigger op `check_ins`/`guests`(/`refusals`) roept `realtime.broadcast_changes()` / `realtime.send()`
   naar topic **`event:{event_id}`**, event-naam `check_in` / `guest`.
3. RLS-policy op `realtime.messages` (SELECT voor receive) die join op topic `event:{id}` toestaat aan wie het
   event mag zien (hergebruik `can_check_in`/`is_venue_member`/`is_event_organizer` op de `event_id` uit de
   topic-naam) — één evaluatie per join.
4. Client: `.channel('event:'+id, { config: { private: true } })` + `.on('broadcast', {event:'check_in'}, …)`;
   `client.realtime.setAuth()` met het access-token vóór subscribe.
5. **Achter een flag** naast `postgres_changes` tot (g) Broadcast valideert; daarna postgres_changes uit.

**Net:** geen per-subscriber-RLS-per-bericht meer, én het "check_ins zonder filter raakt iedereen"-probleem
verdwijnt (topic is al event-scoped). Capacitor-safe (zelfde supabase-js websocket, #37).

## 6. (b) Polling-chattiness terug  ⏳ ontwerp

- **Home 10 s → 30 s** (`HOME_POLL_MS`), behoud visibility-pause, zet `refetchOnWindowFocus:true` *alleen* op
  de home-queries (goedkope versheid bij terugkeer), en invalideer de home-keys na de eigen mutaties van de
  gebruiker. ⇒ ~3× minder home-reads (de grootste egress-post, 4.3).
- **Cockpit:** al realtime-gedreven; na (a) ongewijzigd.
- **Deur 60 s safety-floor:** behouden — goedkoop, offline-kritisch.
- Overweeg: home's `fetchEvents`+`fetchEventHeadcounts` samenvoegen tot één RPC (1 round-trip i.p.v. 2).

## 7. (c) Caching hete semi-statische reads  ⏳ ontwerp

- **Referentie-laag** met lange `staleTime`/`gcTime` voor wat zelden wijzigt: **venue-metadata, `guest_tiers`,
  `user_profiles`-namen** (staleTime 30 s → 5 min), expliciet geïnvalideerd op de zeldzame writes (tier-edit,
  rol-wijziging). Events-lijst korter houden (status verandert).
- Egress-winst + DB-read-winst, stapelt op (b).
- **Niet** doen: gedeelde CDN/HTTP-cache op RLS+cookie-data (onveilig per-tenant). Client-side blijft de plek.

## 8. (e) RLS-helper-efficiëntie  ⏳ ontwerp

- **Mythe corrigeren:** `(select fn())`-wrapping forceert single-eval **alleen bij CONSTANTE argumenten**
  (`auth.uid()`, `is_aal2()`). Op `check_ins`/`refusals`/`guests`-SELECT variëren de args **per rij**
  (`guest_id`) → wrappen helpt daar niet; het blijft per-rij.
- **Echte fix = denormaliseren** `event_id` **+** `venue_id` op `check_ins`/`refusals`. Daarna:
  ```sql
  using ( public.has_venue_role(venue_id, '{admin,finance,doorhost}') or public.is_event_organizer(event_id) );
  ```
  — `guest_event` + `event_venue` weg (2 van de 3 lookups/rij geschrapt). Het is een **geaudite tabel**:
  migratie met kolommen + backfill + `not null`, vullen in de gateway/trigger, soft-delete + audit-triggers
  intact, pgTAP toegestaan+geweigerd per rol. Deze fix voedt óók (a) (topic-sleutel) en het deur-filter.
- **Quick win los daarvan:** policies waar het arg WÉL constant is en nog niet `(select …)`-wrapped zijn,
  alsnog wrappen (Supabase initplan-optimalisatie). Inventariseren welke kwalificeren.
- Indexen: de membership-lookups zijn al gedekt door de UNIQUE-constraints — geen ontbrekende index.

## 9. (g) Hosted realtime-load-test  ⏳ ontwerp (meet-fundament — eerst doen)

**Doel (DoD):** stabiele realtime + acceptabele DB-CPU bij doel-concurrency aantonen, mét vóór/na over (a/b/c/e).

- **Harness** (Node/k6): (1) open N realtime-clients (websockets) op event-topics over M sim-venues,
  (2) drijf check-in-insert-burst op R/sec, (3) meet delivery-%, lag p50/p95, dropped, en DB-CPU
  (dashboard/Realtime-metrics + `pg_stat_statements`).
- **Tegen een wegwerp-hosted project** (of branch-project) — **nooit prod** (audit-vervuiling + live RLS).
  Seed M venues/events/gasten.
- **Scenario's:** ramp websockets 100→500→1000; bursts 50/300/600/sec; eerst `postgres_changes` (baseline),
  dán Broadcast (na) = de headline vóór/na. Leg vast: connection-plafond-knik, delivery-%, lag, DB-CPU%,
  PostgREST-pool-saturatie.
- **Teardown** als de baseline-recipe (capture ids → delete → purge audit → verifieer baseline terug).

---

## 10. Volgorde, DoD-mapping & verify-checklist

**Aanrader-volgorde:** (d)+(f) ✅ → **(g) harness** → (e) denormalisatie+RLS → (a) Broadcast → (b) polling →
(c) caching, elk met (g) als vóór/na.

| DoD-eis | Geleverd door |
|---|---|
| Hosted load-test: stabiele realtime + acceptabele DB-CPU @doel-concurrency | (g), na (a)+(e) |
| Onderbouwd kostenmodel | (f) ✅ (sectie 4) |
| Vóór/na | baseline = `postgres_changes` (3.5a + sectie 1); na = Broadcast (g) |

**Verify-checklist (vóór échte traffic / vóór besluit):**
- [ ] Huidige Supabase **compute-tier** (dashboard → Settings → Compute).
- [ ] **Realtime concurrent-connection-limiet** van het huidige plan + of Pro die laat ophogen.
- [ ] Actuele **prijzen**: compute-add-on/mnd, egress $/GB + inclusie, realtime $/M + inclusie (Supabase);
      edge-middleware/functions inclusie + overage (Vercel). Mijn cutoff = jan 2026 → herijk.
- [ ] **Supavisor** staat op transaction mode; pooler-grootte = tier-default.
- [ ] Bevestig piek-concurrency-aanname F (sectie 3.2) tegen de werkelijke event-spreiding bij onboarding.
