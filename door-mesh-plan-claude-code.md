# Door Mesh — offline multi-device check-in via WebRTC

> **Voor de uitvoerende sessie:** dit plan is goedgekeurd door Max (2026-07-07) en ontworpen om per PR (0 t/m 4, in volgorde) in aparte sessies uitgevoerd te worden — één ClickUp-taak per sessie, per PR een eigen branch vanaf `main`. Alle regels uit `CLAUDE.md` gelden onverkort (security-checklist, Definition of Done, per-screen test-handoff). De regelnummer-verwijzingen (bijv. `DoorProvider.tsx:284`) zijn geverifieerd d.d. 2026-07-07 — verifieer ze opnieuw vóór het editen; de structuur is leidend, niet het exacte nummer. Bij twijfel of conflict met de spec: flaggen, niet stil afwijken.

## ⏸️ Status: GEPARKEERD (besluit Max 2026-07-08) + activerings-trigger

De hele reeks (PR 0–4) is **uitgesteld tot het aantoonbaar de moeite waard is**. Niet bouwen
zonder dat de trigger hieronder is afgegaan of Max expliciet heractiveert.

- **Trigger (besluit 8/7):** heractiveren bij **≥5 klanten (actieve venues)** *óf* zodra **één
  venue structureel met 2–3+ deur-devices per avond** draait — de waarde van het mesh schaalt met
  multi-device deurgebruik, niet met klantaantal op zich.
- **Detectie wordt gemeten, niet gegokt:** bij de PostHog-bouw wordt een **insight + alert**
  ingericht op multi-device deurgebruik (`door_checkin` per venue per event-avond, breakdown op
  device) én op het aantal actieve venues → alert naar Max = het startsein voor deze reeks.
  ClickUp-taak: `86ey7e3pm` ("PostHog — mesh-trigger alert"); hangt aan de PostHog-bouw
  (`86ey3x371`), die ná de UX/IA-reeks komt (G1 eerst — zie `ux-ia-audit-claude-code.md`).
- **Sequencing-winst:** UX/IA-**G2** (deur-consolidatie, `86ey7dzzg`) bouwt éérst; dit mesh-plan
  rebased daarna op de geconsolideerde deur-architectuur (de regelnummer-verwijzingen hieronder
  MOETEN dan sowieso opnieuw geverifieerd worden — `DoorShell` bestaat na G2 niet meer).
- **Open punt (default: wacht mee):** PR 0 (SW cold-start + hotspot-SOP) en de losse
  wake-lock-taak `86ey6x56p` zijn strikt genomen geen mesh en ook single-device nuttig; ze mógen
  eerder los (bijv. bij G2 of de Capacitor N4-spike) — alleen na expliciete bevestiging van Max,
  tot die tijd wachten ze mee.

## Context

Venues met instabiel internet zijn een reële doelgroep; de deur moet blijven werken als internet wegvalt. Max' praktijkbeeld: **soms 4+ devices tegelijk** aan de deur, en alle vier de pijnpunten tellen: (1) dubbel inchecken over devices heen voorkomen, (2) lijst kunnen laden zonder internet, (3) kloppende live tellers, (4) algemene robuustheid. Dit plan beoordeelt het WebRTC-idee en werkt het uit tot een gefaseerd bouwplan.

## Beoordeling: is WebRTC de moeite waard?

**Ja — maar als versterkingslaag ("door mesh"), nooit als afhankelijkheid, en ná een paar goedkope wins (Fase 0).**

**Wat er al staat (verkend en geverifieerd):** volledige offline-outbox (IndexedDB, 8 mutatietypes, idempotente replay, UUIDv7 client-ids — spec #25), snapshot-cache in IndexedDB (7 dagen), service worker voor `/door` cold-start, dubbel-incheck-bescherming via `check_ins.guest_id UNIQUE` (eerste device wint, tweede krijgt `duplicate` — spec #11), realtime ~1s + delta-sync bij focus/reconnect + 60s vangnet (spec #14).

**Het gat — precies Max' scenario's:** internet weg → devices zien elkaars check-ins niet meer (gast kan bij deur B opnieuw naar binnen; tellers lopen uiteen). Eén telefoon met 4G helpt de rest niets. Een device dat mid-storing zonder cache opent, heeft geen lijst.

**Waarom WebRTC hier de juiste (en enige) techniek is:**
- Enige cross-device lokaal-netwerk-optie die in browser/PWA én Capacitor-webview werkt (#37). BroadcastChannel = same-browser-only; Web Bluetooth kan dit niet.
- DataChannels blijven over het LAN werken **nadat** internet wegvalt — mits al opgezet. Signaling doen we via Supabase Realtime broadcast **bij het openen van de deur** (begin van de avond, vrijwel altijd nog verbinding).
- **Geen CRDT's nodig:** outbox-entries zijn al append-only events met client-UUID's; gossippen = grow-only set-union, natuurlijk convergent. De server blijft via `UNIQUE(guest_id)` + 23505 de scheidsrechter. Het mesh is alleen voor **zichtbaarheid en lokaal blokkeren**, nooit een tweede source of truth.
- Fraudebestendigheid intact: elk device upload alleen z'n **eigen** outbox; audit-attributie (`checked_by`, `device_id`, audit-triggers) verandert niet. Geen relay-writes namens een ander device in v1.

**Harde randvoorwaarde (documenteren + detecteren):** devices moeten op hetzelfde lokale netwerk zitten. Geen app nodig — WebRTC werkt in browser/PWA én in de Capacitor-webview. Scenario-matrix (ook opnemen in `docs/door-ops.md`):

| Situatie | Sync? | Via |
|---|---|---|
| Iedereen 4G of werkende wifi | ✅ | Normale server-sync (bestaand — mesh niet nodig) |
| Venue-wifi op, internet-backhaul dood | ✅ | Mesh over de wifi |
| Geen wifi, één telefoon heeft 4G → hotspot | ✅ | Rest op de hotspot: mesh + de hotspot-telefoon synct naar de server |
| Helemaal geen connectiviteit | ⚠️ | Elk device op eigen cache/outbox (huidig gedrag); mesh onmogelijk |
| Venue-wifi met client-isolation | ⚠️ | Mesh geblokkeerd → detecteren + hotspot-hint tonen |

Telefoons elk op eigen 4G kunnen níet onderling P2P zonder TURN — maar dan is er internet en is het mesh overbodig; dit gat bestaat in de praktijk niet. **Hotspot-SOP is sowieso het ops-advies** (nul code, lost 80% op, en "één telefoon met bereik" wordt vanzelf de brug naar de server); het mesh is de productlaag daarbovenop.

**Bewust NIET:** geen TURN (LAN-only by design), geen relay-uploads namens peers (v1), geen QR-signaling voor joinen tijdens storing (v1), **geen migratie/schema-wijziging in enige PR** (puur client-side; signaling gebruikt Realtime broadcast/presence — geen tabellen, geen RLS-wijziging, geen pgTAP).

**Besluiten op open punten:** UI-copy in het Engels (Engels is de enige locale; nieuwe keys in `src/lib/i18n/surfaces/door.ts`). Open broadcast-kanaal is acceptabel v1 (kanaalnaam bevat event-UUID, berichten bevatten niets dat een doorhost niet al heeft, alles zod-gevalideerd, peers veroorzaken nooit server-writes) — hardening naar private channels + `realtime.messages` RLS = backlogtaak. Peer-cap = 8. Isolation-hint = rustig in de SyncBar, niet als banner.

---

## Geverifieerde codebase-feiten (bouw hierop, niet op aannames)

- `enqueueDoorWrite` = `src/features/door/DoorProvider.tsx:284–299`, de ene funnel voor alle 8 mutatiesoorten → één publish-hookpunt.
- Eigen optimistische writes worden **in de gecachte snapshot** gepatcht (`patchSnapshot` :233 → `queryClient.setQueryData`); de peer-overlay moet **bovenop** die snapshot als afgeleide laag, **nooit in de query-cache** (anders is superseden/purgen onmogelijk).
- View-derivatie = pure functie `buildDoorView(snapshot)` (`src/features/door/model.ts:150`), aangeroepen in `useMemo` op `DoorProvider.tsx:170–180`. Tellers (`insideCount`, `insideHeadcount`, …) komen daaruit → overlay op de snapshot geeft automatisch kloppende offline headcounts.
- Realtime: `getDoorClient().channel('door:'+eventId)` met `client.realtime.setAuth(token)` vóór subscribe (`useDoorSync.ts:131–157`). supabase-js `^2.108`: broadcast = `channel.on('broadcast',{event},cb)` + `channel.send({type:'broadcast',event,payload})`; presence = `channel.on('presence',…)` + `channel.track(state)`.
- **Realtime-authorization is NIET geconfigureerd** (`supabase/config.toml`: alleen `[realtime] enabled=true`; nergens `private: true` of `realtime.messages`-policies) → broadcast is open voor anon-key-houders die de kanaalnaam kennen. Mitigatie: zie besluit hierboven.
- Service worker (`public/service-worker.js`) cachet alleen `SHELL=['/door']`, geregistreerd alléén vanuit `src/app/door/layout.tsx`. Onder `src/app/app/` bestaat **alleen `page.tsx`** (geen layout) → `/app` (waar de mobiele Deur-tab woont) heeft GEEN offline cold-start. Dat is Fase 0.
- Zod `^3.23.8` aanwezig; vitest+jsdom geconfigureerd, pure-fn-tests colocated (`model.test.ts`, `sync/status.test.ts`); Playwright e2e bestaat (`tests/e2e/door-offline.spec.ts`).
- Device-identiteit: `src/features/door/offline/device.ts` (stabiele UUIDv7 per browser-profiel, localStorage).
- Capacitor-seam: `src/lib/platform.ts` `isNativeShell()`; regel #37 = alles browser-only guarden.

---

## PR 0 — goedkope niet-mesh wins (~150 LOC)

**0a. `/app` cold-start offline (SW-dekking).**
1. `public/service-worker.js`: `SHELL = ['/door', '/app']`, bump `CACHE = 'plusone-door-v2'`. Navigatie-fallback pad-bewust: `caches.match(url.pathname.startsWith('/app') ? '/app' : '/door')`.
2. Verplaats `RegisterServiceWorker` uit `src/app/door/register-sw.tsx` naar `src/components/register-sw.tsx` (of re-export); maak `src/app/app/layout.tsx` (bestaat nog niet) die `{children}` + de registratie rendert; `src/app/door/layout.tsx` gebruikt hetzelfde component. Dev-kill-switch-gedrag ongewijzigd.
3. Documenteer in de PR: offline fallback serveert de laatst-succesvolle `/app`-HTML (per browser-profiel, gewist bij sign-out net als IndexedDB — spiegel het bestaande safety-comment). Check dat de SSR-payload van `/app` geen gasten-PII embed; zo wel → flaggen, niet stil cachen.

**0b. Ops-SOP.** Nieuw `docs/door-ops.md`: venue-avond-checklist — alle deur-devices op hetzelfde wifi/hotspot vóór de deuren opengaan; bij AP/client-isolation: telefoon-hotspot (host-telefoon met eigen data = meteen ook "het ene device met internet"); schermen wakker houden; betekenis SyncBar-statussen; waarom geen TURN.

Gates: `pnpm lint`, `pnpm type-check`, `pnpm vitest run` groen. Geen migratie.

---

## Module-layout — nieuw: `src/features/door/mesh/`

| Bestand | Verantwoordelijkheid | API |
|---|---|---|
| `protocol.ts` | Zod-schemas + types voor ALLE berichten (signaling + DataChannel), versioned envelope, size-caps vóór `JSON.parse`. Puur (alleen zod). | `PROTOCOL_VERSION=1`, `signalMessageSchema`, `channelMessageSchema`, `peerOutboxEntrySchema`, `encodeMessage`, `decodeChannelMessage`, `decodeSignal`, `MAX_MESSAGE_BYTES=65536`, `CHUNK_BYTES=16384` |
| `peer-entries.ts` | Module-singleton store van **ontvangen** peer-entries, zelfde discipline als `outbox/store.ts`: `useSyncExternalStore`-bron, persist via bestaande `offline/idb.ts` onder key `door-peer-entries`, dedup op `clientId`. `PeerEntry = { entry; origin:{deviceId,userId,userName?}; receivedAt; status:'peer-pending'\|'peer-synced'\|'peer-duplicate'\|'peer-error' }` | `init/subscribe/getSnapshot/getServerSnapshot/upsert/setStatus/purge/clearForOtherEvents/knownClientIds` |
| `overlay.ts` | **Puur**: peer-entries toepassen op een `DoorSnapshot` → overlaid snapshot voor `buildDoorView`; supersede-classificatie. | `applyPeerOverlay(snapshot, entries)`, `isSuperseded(entry, snapshot, ownOutbox)`, `peerPendingByGuest(...)` |
| `gossip.ts` | **Puur**: anti-entropy (digests, diffing, batching), geen I/O. | `computeDigest`, `missingClientIds`, `batchEntries` |
| `signaling.ts` | Supabase Realtime-wrapper voor kanaal `door-mesh:{eventId}`: presence-roster + directed broadcast voor SDP/ICE. `setAuth` vóór subscribe (spiegel `useDoorSync.ts:131`). Geen React. | `createSignaling(client, eventId, deviceId, handlers)` → `{announce, send(to,msg), presence(), destroy, state}` |
| `connection.ts` | Eén `RTCPeerConnection` + één DataChannel (`'door-mesh'`, ordered) per peer; **perfect negotiation** (polite = hogere deviceId), ICE-restart, heartbeat, backpressure, chunk-reassembly. Geen React. | `createPeerLink(opts)` → `{send, restartIce, close, state, lastSeenAt}` |
| `mesh-manager.ts` | Niet-React orchestrator: roster → dial/accept, inbound routeren (via `protocol.ts` valideren), eigen entries fan-outen, anti-entropy-tick (30s), status-gossip, snapshot-serving (PR 4). Subscribe/getSnapshot-bron voor React. | `createMeshManager(deps)` → `{start, stop, publishEntry, publishStatus, requestSnapshot, subscribe, getSnapshot}`; `MeshSnapshot = {supported, signalingOpen, peers, connectedCount, anyUnreachable}` |
| `useDoorMesh.ts` | Enige React-stuk: environment-guard (#37), manager-lifecycle per `eventId`, koppelt `peer-entries.ts`. | `useDoorMesh({eventId, enabled, onPeerEntry})` → `MeshState = MeshSnapshot & {publish, publishStatuses}` |
| `status.ts` | Pure mesh-bewuste statusextensie (laat `sync/status.ts` ongemoeid). | `deriveMeshAwareStatus(base, {connectedCount})` — regel: `warn` + `connectedCount>0` → `stale`; rest passthrough |
| `snapshot-transfer.ts` (PR 4) | Chunked DoorSnapshot-serialisatie (16KB-chunks, index/total/checksum), reassembly + zod-validatie. Puur. | `chunkSnapshot`, `assembleSnapshot` |
| `index.ts` | Re-exports. | — |

## Berichtprotocol (kern van `protocol.ts`)

Alles van een peer = untrusted input: `safeParse`, stil droppen bij falen, size-cap vóór parse. Envelope met `v: z.literal(1)`; onbekende `v`/`kind` → negeren.

**Gossip-payload** hergebruikt de bestaande `OutboxEntry`-payloadvormen (`outbox/types.ts`) maar **`status`/`attempts`/`message` worden NOOIT van de wire geaccepteerd**. Discriminated union op alle 8 kinds, elk `{kind, clientId: uuid, eventId: uuid, createdAt: iso, payload: <kind-schema>}` met strakke caps (`plusOnesArrived ≤ 500`, `fullName ≤ 200`, `reason ≤ 500`).

**Signaling** (broadcast-event `'signal'`; roster via presence, dus geen announce-bericht): `{v, eventId, from, to}` (deviceIds; negeer als `to !== self` of `eventId` mismatch) × kinds `offer|answer` (sdp ≤ 64KB), `ice` (candidate ≤ 2KB), `bye`. Presence-track-state `{v:1, deviceId, userId, userName?, joinedAt}` (ook zod-gevalideerd bij lezen).

**DataChannel** (JSON-strings, één kanaal): `hello` (origin + volledige digest — meteen eerste anti-entropy-ronde), `ping`/`pong` (10s), `entry` (live gossip), `entry_status` (`synced|duplicate|error` + message ≤ 300), `entries_digest` (≤ 5000 ids, 30s-tick), `entries_request` (≤ 500 ids), `entries` (≤ 200 per batch), `snapshot_request`/`snapshot_chunk` (PR 4).

**Relay-regel:** elk device gossipt eigen entries ÉN relayt bekende peer-entries (digest dekt eigen+peer-sets) zodat entries over het mesh hoppen ook als twee devices elkaar nooit direct bereikten. Origin blijft origineel; loop-safe door dedup op `clientId`.

## Peer-overlay-ontwerp (`overlay.ts` + DoorProvider)

**Gelaagdheid (onder → boven):** server-snapshot → eigen optimistische patches (zitten al ín de cache-snapshot) → **peer-overlay (berekend, nooit in de cache)** → `buildDoorView`.

`applyPeerOverlay`: filter op `eventId` + status `peer-pending|peer-synced`; sorteer op `clientId` (UUIDv7 ≈ tijdgeordend); pas per kind toe en **spiegel exact de bestaande optimistische patch-functies in DoorProvider** (bewuste duplicatie in pure vorm, met comment die beide kanten op wijst — DoorProvider in deze PR niet refactoren):
- `check_in`: skip als snapshot al een check-in-rij voor `guestId` heeft (zelfde first-wins als guard op DoorProvider:312 en de server-23505); anders synthetische `CheckInRow` met `checked_by=origin.userId`, `device_id=origin.deviceId`, `offline_synced:false`.
- `check_in_topup`: `plus_ones_arrived = max(current, target)` (monotoon, spiegelt :352). `check_in_void`: alleen als `checked_at <= clientTimestamp`. `check_in_revive`: alleen als momenteel voided. `refusal`: status `refused` + refusal-rij (skip als id bestaat). `undo_refusal`: alleen als `refused` en laatste refusal ≤ clientTimestamp. `add_guest`: synthetische `GuestRow` (vorm van DoorProvider:465–486, `source:'door'`); skip als `tierId` niet in `snapshot.tiers` (untrusted-guard). `ack_note`: ack-velden zetten/wissen.
- Entry die verwijst naar onbekende `guestId` → stil skippen (anti-entropy + `clientId`-sortering zet de bijbehorende `add_guest` er meestal vóór).

**Supersede** (`isSuperseded`, voor purge + badge, niet voor correctheid — applicatie is idempotent): `check_in` = pre-overlay-snapshot bevat al een rij voor die gast; void/revive/topup = pre-overlay-staat reflecteert het al; `refusal` = `payload.id` in pre-overlay refusals; `add_guest` = id in pre-overlay guests; plus: eigen outbox bevat hetzelfde `clientId` (relay-echo van eigen write). **Purge-cadans:** na elke geslaagde snapshot-refetch, entries waar `isSuperseded === true` én `receivedAt` > 5 min oud (flicker-gratie), plus alles > 24u.

**Dubbel-incheck-blok:** gasten met peer-pending `check_in` renderen als `inside` (via overlay) → normale "already inside"-flow. Daarnaast **verplichte** expliciete guard in `DoorProvider.checkIn` vóór `enqueueDoorWrite` (de bestaande cache-guard ziet peer-rijen NIET, want de overlay zit niet in de cache):
```ts
if (peerPendingByGuestRef.current.get(guestId)?.some(p => p.entry.kind === 'check_in')) {
  showToast(fmt(t.door.meshAlreadyCheckedIn, { device: origin.userName ?? shortId }));
  return;
}
```

**Badge:** context krijgt `peerPendingByGuest: Map<string, PeerEntry[]>` naast bestaand `outboxByGuest` (:86); `GuestDetail.tsx` + check-in-lijstrij tonen `t.door.meshPendingBadge` ("via other device · not yet synced") waar de duplicaat-marker al rendert.

**`entry_status`:** `synced` → `peer-synced` (badge weg); `duplicate` → `peer-duplicate` (niet meer toepassen); `error` → `peer-error` + niet meer toepassen (bijv. quota-afgewezen check-in van een peer mag de gast bij ons niet groen houden).

## Signaling-details (`signaling.ts`)

```ts
const channel = client.channel(`door-mesh:${eventId}`, {
  config: { broadcast: { self: false, ack: false }, presence: { key: deviceId } },
});
channel
  .on('presence', { event: 'sync' }, () => handlers.onRoster(parseRoster(channel.presenceState())))
  .on('broadcast', { event: 'signal' }, ({ payload }) => {
    const msg = decodeSignal(payload);
    if (msg && msg.eventId === eventId && msg.to === deviceId) handlers.onSignal(msg);
  })
  .subscribe(async (st) => {
    if (st === 'SUBSCRIBED') await channel.track({ v: 1, deviceId, userId, userName, joinedAt: new Date().toISOString() });
  });
// send: void channel.send({ type: 'broadcast', event: 'signal', payload: msg });
```
Zelfde `getDoorClient()`-instantie → één Realtime-socket, twee kanalen (`door:` + `door-mesh:`); `setAuth` vóór subscribe zoals `useDoorSync.ts:131–135`; de bestaande `eventsPerSecond: 200` dekt ICE-bursts voor ≤ 8 peers. Re-`track` bij élke `SUBSCRIBED` (auto-rejoin na reconnect). Over signaling gaat NIETS behalve SDP/ICE/bye.

## Verbindings-lifecycle

- **RTC-config:** `{ iceServers: [{ urls: ['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302'] }] }`. **Geen TURN by design** (TURN relayt via internet = doel ondergraven; op gedeeld LAN/hotspot verbinden host-candidates direct).
- **Wie belt:** bij roster-sync dialt het device met de **lagere** deviceId (`createDataChannel`); de hogere wacht op `ondatachannel`. Perfect negotiation (polite = hogere deviceId) vangt glare.
- **Open:** beide kanten sturen `hello` (origin + digest) → missende entries uitwisselen.
- **Heartbeat:** ping/pong 10s; 3 gemiste pongs → peer `stale` (kanaal open laten). `lastSeenAt` per peer.
- **Failure:** `connectionState==='failed'` → `restartIce()`; na 15s nog failed én signaling open → teardown + éénmalig redial; signaling dicht (offline) → `restartIce` op 30s-backoff, link-object behouden (reconnect als LAN heelt).
- **Client-isolation-detectie:** signaling open + offer/answer gewisseld + ICE haalt binnen 15s bij **alle** peers geen `connected` → `anyUnreachable=true` → SyncBar-hint `t.door.meshIsolated` ("Devices can't reach each other on this network — use a phone hotspot").
- **Internet valt weg:** signaling-kanaal `CHANNEL_ERROR/CLOSED`; bestaande DataChannels blijven werken (P2P). Geen nieuwe joins tijdens storing. Bij reconnect: supabase-js rejoint → presence re-track → roster-resync → nieuwe/gebroken peers dialen.
- **Teardown:** best-effort `bye` + presence untrack + links sluiten + `client.removeChannel` — in de `useDoorMesh`-effect-cleanup bij `eventId`-wissel/unmount (patroon `useDoorSync.ts:159–164`). `peerEntries.clearForOtherEvents(eventId)` bij start.
- **Backpressure:** alleen `send` bij `readyState==='open'`; anti-entropy-tick overslaan bij `bufferedAmount > 1MB`; losse berichten ≤ 64KB; snapshot in 16KB-chunks. Peer-cap 8: extra presence-entries negeren.

## Capacitor/webview-veiligheid (#37)

`useDoorMesh` eerste regel: `supported = typeof window !== 'undefined' && typeof RTCPeerConnection === 'function' && typeof RTCSessionDescription === 'function'`; niet supported of `!enabled` → `DISABLED_MESH_STATE` (noop-publish, lege peers). Geen enkel mesh-codepad mag gooien zonder RTC; `new RTCPeerConnection` in try/catch → bij throw naar unsupported. `peerEntries` volgt het SSR-veilige outbox-patroon (`getServerSnapshot` = bevroren lege array). Mesh raakt de service worker nooit aan. WKWebView ondersteunt RTCDataChannel zonder permission-prompts (geen getUserMedia).

## Integratiepunten (exacte edits aan bestaande bestanden — minimaal houden)

**`src/features/door/DoorProvider.tsx`** (enige substantieel bewerkte bestand):
1. Imports uit `./mesh`.
2. Na de outbox-`useSyncExternalStore` (:147): zelfde patroon voor `peerEntries` + `useEffect(() => { void peerEntries.init(); }, [])`.
3. `const mesh = useDoorMesh({ eventId, enabled: true, onPeerEntry: (pe) => peerEntries.upsert(pe) })` — in `onPeerEntry` entries droppen waarvan `clientId` in eigen outbox zit.
4. View-derivatie (:170–180): `useMemo`-input wordt `applyPeerOverlay(snapshot, peerEntryList)`; **de realtime-dedup-Sets (:203–208) en alle `patchSnapshot`-callbacks blijven op de rauwe snapshot/cache werken** — alleen de view/guestMap-laag gaat naar overlaid.
5. `enqueueDoorWrite` (:284–299): entry eerst in lokale const bouwen, dan `outbox.enqueue(...)` + `mesh.publish(entry)`.
6. `checkIn` (:303): de peer-pending-guard + toast (zie boven).
7. `flush` (:242–275): na `drainOutbox` en vóór `clearSynced()` → `mesh.publishStatuses(outbox.getSnapshot())`; na de invalidate → superseded peer-entries purgen.
8. Contextwaarde: + `mesh: MeshState` en `peerPendingByGuest` (useMemo over `[peerEntryList, snapshot, outboxEntries]`).

**`useDoorSync.ts` — géén wijzigingen.** **`SyncBar.tsx`:** `deriveMeshAwareStatus(sync.status, mesh)` voor kleur/label; chip "· {n} devices nearby" bij `connectedCount>0`; offline+meshed label `t.door.syncOfflineMeshed`; vaste `h-[48px]` behouden (truncate). **`src/lib/i18n/surfaces/door.ts`:** keys `meshPeers`, `syncOfflineMeshed`, `meshPendingBadge`, `meshAlreadyCheckedIn`, `meshIsolated` (Engels). **`GuestDetail.tsx` + `CheckInList.tsx`/`checkin-items.ts`:** badge renderen (additief).

---

## PR-fasering (elk zelfstandig shippable; gates per PR: `pnpm lint` + `pnpm type-check` + `pnpm vitest run`; nergens een migratie)

| PR | Inhoud | Waarde geleverd | Omvang |
|---|---|---|---|
| **PR 0** | SW `/app`-shell + gedeelde `RegisterServiceWorker` + `docs/door-ops.md` | Deur-tab cold-start offline + hotspot-SOP | ~150 LOC |
| **PR 1 — mesh-presence** | `protocol.ts` (signaling-subset), `signaling.ts`, `connection.ts`, `mesh-manager.ts` (roster/links/heartbeat), `useDoorMesh.ts`, `mesh/status.ts`; DoorProvider krijgt `mesh` in context (nog geen overlay); SyncBar-chip + mesh-bewuste status; i18n-keys | "N devices nearby", zachtere offline-status, isolation-detectie | ~700 LOC |
| **PR 2 — gossip + overlay** | channel-messages in `protocol.ts`, `peer-entries.ts`, `overlay.ts`, `gossip.ts` (hello-digest, nog geen tick), DoorProvider-edits 2/4/5/6/8, gast-badges | Offline cross-device dedup + kloppende lokale tellers | ~900 LOC |
| **PR 3 — anti-entropy + status-gossip + resilience** | 30s-digest-tick, `entries_request/entries`-relay, `entry_status` (DoorProvider-edit 7), purge-on-refetch, ICE-restart/redial-hardening, per-peer last-seen-UI | Convergentie bij gemiste berichten/late joins; peer-fouten opruimen | ~500 LOC |
| **PR 4 — snapshot-from-peer** | `snapshot-transfer.ts` + `doorSnapshotSchema`, manager request/serve; DoorProvider: geen cache + offline + `connectedCount>0` → `requestSnapshot()` → `setQueryData(doorSnapshotKey(eventId), snap)` (stale gemarkeerd zodat refetch vervangt) | Device zonder cache en zonder internet krijgt de lijst van een peer | ~450 LOC |

Backlog (niet in deze reeks): private-channel-hardening (`realtime.messages` RLS — migratie + pgTAP), relay-uploads namens peers (audit-attributievraagstuk), QR-signaling voor join-tijdens-storing, `navigator.wakeLock`, Capacitor-native transport-adapter (Multipeer/Nearby).

## Testplan

- **Unit (vitest, colocated, fixture-stijl van `model.test.ts`):** `protocol.test.ts` (geldig/ongeldig/oversized/vreemd-event), `overlay.test.ts` (elke kind; idempotentie `apply(apply(s,e),e) ≡ apply(s,e)`; check_in first-wins; void/revive/topup-ordening op clientId; supersede-matrix incl. eigen-outbox-echo), `gossip.test.ts` (digest/missing/batching), `status.test.ts`.
- **Handmatig (localhost):** `pnpm dev` (poort 7000); venster A normaal Chrome-profiel, venster B tweede profiel (device-identiteit = per profiel) → beide `http://localhost:7000/auth/dev-login?email=door@plusone.test&next=/app`, Deur-tab openen. SyncBar toont "1 device nearby". Check-in op A → binnen ~1s op B mét mesh-badge. Dan DevTools → Network → Offline op **beide** (let op: DevTools-offline blokkeert fetch/WebSocket maar snijdt bestáánde WebRTC niet door — precies het doelscenario: signaling down, mesh up). Check-in op A terwijl beide offline → B toont gast inside + blokkeert her-check-in. Netwerk alleen op A terug → A drained; B (nog offline) houdt overlay; B terug → overlay superseded door refetch, badges weg. Écht radio-uit testen vergt twee fysieke devices op één hotspot.
- **E2E (follow-up, geen PR-gate):** Playwright multi-context (`browser.newContext()` × 2, `context.setOffline(true)`) op het patroon van `tests/e2e/door-offline.spec.ts`.

## UX-verfijningen (besloten met Max 2026-07-07)

**A. Adaptieve offline-melding met debounce (verfijnt con #1/#2 hieronder).** Geen alarm bij elke blip. Pas na een grace-periode offline (~90s–2min, debounce) escaleert de SyncBar naar een melding, waarvan de tekst zich aanpast aan de mesh-staat:
- Offline maar nog gemesht (peers > 0) → geruststellend: "Geen internet, maar nog verbonden met N apparaten — je kunt doorgaan."
- Offline én alleen (geen peers) ná de grace-periode → actiegericht: "Geen internet en geen verbonden apparaten. Vraag een collega om een hotspot te delen en verbind daarmee."
Slimme variant: zolang signaling nog leeft (venue-wifi op, backhaul dood), weet elk gemesht device van zichzelf of het nog serververbinding heeft — dan kan de melding "Device X heeft nog internet — vraag díe om te delen" tonen (voeg een `hasInternet`-vlag toe aan presence/hello). Bij een volledig gefragmenteerd netwerk is de melding een out-of-band instructie aan de mens. Bouw: detectie/mesh-staat in **PR 1**, escalatie-copy + `hasInternet`-vlag in **PR 3**.

**B. Cache-update na hotspot (verduidelijking, con #2).** Zodra een device wéér internet krijgt — eigen of via andermans hotspot — draint het z'n outbox naar de server en refetcht de snapshot; de cache is dan meteen bij (bestaand gedrag: online-event / realtime-resubscribe → drain + invalidate). **Cruciaal inzicht:** een telefoon-hotspot deelt échte 4G-internet, dus élk device op die hotspot krijgt gewone serververbinding terug — normale sync werkt weer en het mesh is op dat moment niet eens nodig. Een device dat mid-storing zonder cache instapte, haalt zodra het op de hotspot zit gewoon de verse lijst van de server. Het mesh is daardoor onvervangbaar in precies één geval: **lokaal netwerk leeft, maar nergens internet** (kelder-venue zonder 4G) — plus moment-tot-moment demping bij flapperend internet.

**C. Wake-lock + geforceerde sync-overlay bij hervatten → EIGEN TAAK ([`86ey6x56p`](https://app.clickup.com/t/86ey6x56p), nuttig in álle gevallen, los van deze mesh-reeks).** Screen Wake Lock (feature-detect, Capacitor-safe #37, her-acquire bij `visibilitychange`) + een **blokkerende** overlay wanneer de app weer zichtbaar wordt en de laatste geslaagde sync ouder is dan een drempel (default ~5 min): forceer een sync vóór verder inchecken. **Harde eis — geen onpasseerbare muur bij echte offline-staat:** online → sync + sluit; offline maar gemesht → ververs van peers ("data van N apparaten in de buurt") + doorgaan; offline én alleen → duidelijke waarschuwing "je mist mogelijk recente check-ins" + expliciet doorgaan (de deur mag nooit dichtvallen). Zie de taak voor details; helpt single-device net zo goed als het mesh, daarom losgetrokken.

## Risico's & open vragen voor Max

1. **WiFi client/AP-isolation** bij venues verslaat LAN-P2P stilletjes — detectie + hotspot-hint zit in PR 1, maar de SOP (hotspot) is de echte mitigatie. Verwachtingsmanagement richting venues nodig.
2. **iOS/WKWebView:** pagina wordt gesuspend bij schermvergrendeling/achtergrond → mesh valt weg en rejoint bij wake. Mitigatie = wake-lock + stale-resume overlay uit taak [`86ey6x56p`](https://app.clickup.com/t/86ey6x56p) (zie UX-verfijning C). Batterijkosten van ≤ 8 peers + 10s-heartbeats over een 6-uurs nacht: laag maar ongetest.
3. **`add_guest` + quota:** een peer-overlaid deurgast telt lokaal mee maar kan server-side op quota (45001/45002) stuklopen — `entry_status: error` (PR 3) ruimt het op, maar tussen offline-add en reconnect kan de lokale telling het quotum overschrijden. Zelfde semantiek als het huidige single-device optimistische gedrag → geaccepteerd, tenzij Max anders wil.
4. **Zelfde login op meerdere devices:** `origin.userName` is dan overal gelijk → per-peer-labels vallen terug op device-short-id.

## Verificatie (Definition of Done per PR)

1. `pnpm lint` + `pnpm type-check` + `pnpm vitest run` groen; geen migraties dus geen pgTAP.
2. Security-checklist toegepast: alle inbound mesh/signaling-berichten zod-geparsed, eventId-scoped, size-capped; peers veroorzaken nooit server-writes; geen PII in logs; geen service-role.
3. Handmatige twee-profielen-test (recept hierboven) per PR uitgevoerd en resultaat in de PR-beschrijving.
4. Per-screen test-handoff voor Max aan het einde van PR 2 (dev-login-link `door@plusone.test` + genummerde ja/nee-vragen over: chip zichtbaar, check-in propagatie offline, dubbel-blok, tellers, badge-supersede, ≤390px layout).
5. Spec-update: nieuwe decision-rij in `gastenlijst-app-spec.md` ("door mesh = enhancement-laag, LAN-vereiste, server blijft scheidsrechter — verfijnt #11/#14") in PR 2.
