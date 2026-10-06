# Legal v0.3 — docs én code gelijktrekken, in golven

> Status: **plan, besproken en besloten met Max op 2026-10-05**. Bron: de externe feedback op de legal drafts v0.2 (24 september 2026) plus de "Code follow-ups" en "Questions" die al in `docs/legal/README.md` v0.2 stonden. Dit document is het *wat* én het *hoe*; de mechaniek (orchestrator per golf, workers op eigen ClickUp-taak/branch/PR, reviewer-sessies voor high-risk PR's, migratie-timestamps vooraf toegewezen) is identiek aan `capacitor-orchestration-claude-code.md` §1 en wordt hier niet herhaald.
>
> Milestone: **Now** — de eerste DPA wordt ondertekend zodra venue #5 tekent, en de app-store-submissie (Fase 17 L1) vereist een gepubliceerde privacy policy. Lijn: **code fixen, tekst niet afzwakken**, behalve waar hieronder expliciet anders besloten.

## 0. Uitgangssituatie

- De v0.2-docs staan **niet in de repo**. `docs/legal/` op `main` bevat nog v0.1 (9 juli 2026, vier bestanden, geen Guest Terms). De v0.2-set (privacy policy, subprocessor list, ToS v0.2, DPA v0.1.1, Guest Terms v0.2, README) staat in Max' Downloads. Golf 0 landt die eerst; alles daarna werkt op de repo-kopie.
- `Plus-One.io/src/lib/content.ts` (de `/legal`-pagina van de marketing-site) bevat placeholder-tekst. Publicatie van de echte tekst is een aparte stap (§7).
- `src/lib/legal.ts` kent `TERMS_URL` en `PRIVACY_URL`, geen `GUEST_TERMS_URL`. `TERMS_VERSION = '2026-06-24'`.
- Geverifieerd tegen `main` (2026-10-05): `run_privacy_retention()` laat op `guest_requests` `dedupe_key` en `birthdate` staan; `forget_contact()` raakt `guest_requests` niet; er is geen export (alleen CSV-import); de request page toont "the organizer of this event" zonder legal-link; `marketing_opt_in` wordt opgeslagen en nergens getoond; platform-admin-reads worden nergens gelogd; Sentry scrubt `event.user`/`event.request` maar de IP-opslag-toggle is een dashboardinstelling.

## 1. Besluiten (Max, 2026-10-05)

| # | Onderwerp | Besluit |
|---|---|---|
| 1 | Self-service export | **Bouwen, nu.** Admin-only, per venue, CSV. Spec in §3 (E1). ToS 9.5/14.3/16.5 en DPA 11.2 blijven "customer exports" + "on request after termination" — beide waar zodra E1 live is. |
| 2 | Marketing opt-in | Checkbox blijft. `marketing_opt_in` zit **standaard** in de export en wordt zichtbaar op de request-kaart en in het contact-detail (E1). Tekst Guest Terms §4 / Privacy §4.2 / §4 slot blijft, want hij wordt waar. |
| 3 | Platform-admin leestoegang | **Lichte variant nu**: een `platform_access_log` die elke venue-switch van een platform admin vastlegt (admin, venue, moment, reden optioneel). **Niet zichtbaar voor de klant**; wij delen op verzoek. DPA 4.4 krijgt: "Access to a Venue by Platform Administrators through the application is logged and made available to the Customer on request." De zware variant (DB-afgedwongen support-sessies in de RLS-helpers) gaat naar de backlog ≥25. |
| 4 | Inactieve accounts (Privacy §10, 24 maanden) | **Geen sweep.** Zin wordt "on request". |
| 5 | Audit-diffs van `invites`, `venue_memberships`, `influencers` | **Bewaren**, termijn expliciet: "for the life of the Venue, deleted with it (ToS 16.6)". Geen anonimisering. `platform_invites` krijgt wél een sweep (24 maanden na laatste contact) in de bestaande retention-cron. Privacy §10 generalisatie "redacted when the underlying record is anonymized" wordt beperkt tot guests/contacts/requests. |
| 6 | `device_id` op `check_ins`/`audit_log` | **Accepteren.** Eén zin in DPA Annex 1D bij door records: "device identifier (random browser identifier, not anonymized)". Geen code. |
| 7 | Minimumleeftijd accounthouders | **16 blijft.** AVG-toestemmingsleeftijd; 17-jarige deur-/garderobehulp is legaal werk; gastenleeftijd is venue-beleid (Guest Terms §2). Reviewer-voorstel 18 afgewezen. |
| 8 | Prod-data via Claude Code / MCP | **Anthropic wordt subverwerker** (sectie A van de lijst: "engineering and support tooling; incidental access to production data during support and incident response; commercial terms, no training on inputs"). Werkregel in CLAUDE.md: schema, logs, advisors en aggregaten standaard; gastrijen alleen bij een concreet supportticket of incident, en dan met een `platform_access_log`-rij of ClickUp-verwijzing. Een later product-MCP (venue bevraagt eigen lijst met eigen AI) valt hier niet onder: die AI is de verwerker van de venue. |
| 9 | Guest Terms NL | **Nu meeschrijven**, door Fable (A2), advocaat verifieert. |
| 10 | Guest Terms aansprakelijkheidscap | **Schrappen** (6:237 sub f BW). Blijft: "PlusOne is not responsible for the event, the guest list decisions or admission; those are the Venue's." Grove schuld-formulering in Guest Terms blijft (consument); ToS 14.4 houdt *opzet of bewuste roekeloosheid* (B2B). Bewust verschillend. |
| 11 | Acceptatie Guest Terms (6:234 BW) | Regel boven de verzendknop op `/e/[slug]`: "By sending this request you accept the PlusOne Guest Terms and [venue]'s privacy notice." met beide links. Venue-naam vervangt "the organizer of this event". (C1) |
| 12 | PlusOne-opzegrecht | ToS 16.2 krijgt termination for convenience: 3 maanden schriftelijk aan de admins, einde billing period, pro-rata restitutie, 16.5 van toepassing. |
| 13 | Audit-rij rol | Privacy §6 en DPA 2.3 splitsen: audit van gastdata = processor in opdracht van de venue; audit van accounts/platformintegriteit = controller. |
| 14 | Pilot/comped (ToS 7.8) | Wordt partnerregeling: einddatum, automatisch door naar betaald, tarief vooraf. Tekst van de reviewer overnemen. Code: optioneel `subscriptions.comped_until` + banner → backlog ≥5, niet in dit plan. |
| 15 | Cap bij datalek | Niet in de ToS. Fallback (2–3× jaarfee, vast minimum) bepalen Max en Joeri vooraf; alleen als addendum. Buiten dit plan. |
| 16 | Versies | Alle zes docs naar **v0.3** met dezelfde datum; README-tabel gelijk. |

## 2. Golf-overzicht

| Golf | Workers (parallel) | Model | Wacht op | Exit |
|---|---|---|---|---|
| 0 | L0 — v0.2 landen in repo | Sonnet | niets | PR gemerged; `docs/legal/` = v0.2-set incl. `guest-terms.md` |
| A | A1 docs-tekst v0.3 · A2 Guest Terms EN+NL | A1 Sonnet · A2 Fable | L0 | beide gemerged; `pnpm test` groen (claude-md-references) |
| B | B1 retention + forget · B2 request page · B3 platform_access_log + CLAUDE.md-regel | B1 Opus · B2 Sonnet · B3 Opus | L0 (B2 ook A2 voor de linktekst) | B1 en B3 door reviewer-ronde; B2 bij Max ter test |
| C | E1 export + marketing zichtbaar | Opus | B2 gemerged (deelt `landing.tsx` niet, wel `contacts`-screen met niemand → kan eerder als B2 niet raakt) | gemerged, test-handoff beantwoord |
| D | Publicatie: content.ts op plus-one.io, `TERMS_VERSION` bump, `GUEST_TERMS_URL` | Sonnet | A gemerged **en** advocaat akkoord | live op `plus-one.io/legal`, consent-gate re-prompt werkt |

Golf A en B kunnen tegelijk starten na L0. Drie workers tegelijk is het maximum als Max ook test; aanbevolen volgorde: **L0 → A1 + B1 + B3 → A2 + B2 → E1 → D**.

## 3. Taken

Elke taak krijgt een ClickUp-taak in lijst `901818739469` met `Model:`-regel, branch `claude/<taskid>-<slug>`, PR-titel met taak-id. Migratie-timestamps hieronder zijn **gereserveerd**; de orchestrator checkt `git ls-files supabase/migrations | grep 20261006` tegen `origin/main` bij start.

### L0 — v0.2 landen (Sonnet)
- Kopieer de zes bestanden uit Downloads naar `docs/legal/` (`README.md`, `privacy-policy.md`, `subprocessors.md`, `data-processing-agreement.md`, `terms-of-service.md`, nieuw `guest-terms.md`). Verwijder `docs/privacy.md` niet; voeg bovenaan een regel toe dat `docs/legal/` leidend is.
- Geen inhoudelijke wijziging. Eén PR, `docs(legal): land v0.2 drafts (z8uq9m0w3t, z8uq9m0w3u)`.
- Check: `pnpm test -- claude-md-references` blijft groen.

### A1 — docs-tekst v0.3 (Sonnet, mechanisch, één PR)
Alle wijzigingen zijn tekst; geen oordeel nodig. Per bestand:

**`data-processing-agreement.md`** → v0.3
- §2.3: "platform security/audit integrity" splitsen: audit van gastdata valt onder §2.2 (processor); alleen audit van accounts en platformintegriteit blijft controller.
- §4.4: zin toevoegen: "Access to a Venue by Platform Administrators through the application is logged and made available to the Customer on request." (besluit 3).
- §8.1: toevoegen "login and invitation e-mail via Amazon SES in Ireland" en de Vercel edge-network-zin uit Privacy §9.
- §9.1: "forget contact" dekt ook guest requests (na B1 waar).
- §11 en Annex 1E: back-ups noemen: "Backups are retained by the database provider for [N] days [Max vult in] and are not separately anonymized; anonymization propagates when the backup expires." Plus na §11.2: self-service export tijdens de looptijd (E1).
- Annex 1C: promoters toevoegen als betrokkenen. Annex 1D: rij promoters (naam, handle, notities, gehashte token — Privacy §4.5); requesters: e-mail en telefoon **verplicht**, niet "optionally"; door records: "device identifier (random browser identifier, not anonymized)"; requesters-rij vermeldt dat `dedupe_key` en `birthdate` bij anonimisering worden gewist (na B1).
- Annex 2: Cloudflare Turnstile toevoegen (tabel A); Resend/SES in de controller-side zin; **Anthropic** toevoegen conform de subprocessor-lijst; `[URL]` → `https://plus-one.io/legal#subprocessors`.
- Annex 3, Retentie: "audit records of accounts, memberships, invites and promoters are kept for the life of the Venue and deleted with it".
- §13 ongewijzigd (besluit 15).

**`terms-of-service.md`** → v0.3
- §1 Definities: "Venue" en "Organizer" ongewijzigd; voetnoot bij Guest Terms dat "Venue" daar de Customer-facing term is voor de Customer én zijn Venue (besluit 11 lost de verwarring op aan de bron: de request page toont de venue-naam).
- §7.8 vervangen door de partnerregeling-tekst van de reviewer (besluit 14).
- §7.1: `[confirm URL]` weg, `https://www.plus-one.io/pricing` (D8).
- §11.4: "within 24 hours of receipt, every day"; "on business days" weg (D6).
- §14.2: vloer EUR 5.000 (D5, advocaat kan bijstellen); §14.4 "PlusOne's management" wordt "PlusOne's owner" (§7.2).
- §20.2: Rechtbank Zeeland-West-Brabant (D4).
- Partij-aanduiding conform §7.2 (alle docs, ook DPA kop en Guest Terms §intro).
- §9.5: "exporting anything it needs to keep **using the export function**".
- §10.3: zin over logging van toegang, gelijk aan DPA 4.4.
- §14.3: ongewijzigd (export bestaat na E1).
- §16.2: termination for convenience voor PlusOne (besluit 12), reviewer-tekst letterlijk.
- §16.5: "self-service export is available during the term; after termination on request for 30 days".

**`privacy-policy.md`** → v0.3
- §6 rij "Fraud resistance": splitsen in twee rijen (processor voor gastdata, controller voor accounts/platform).
- §8 "Our own team": toevoegen dat venue-toegang door platform admins via de app gelogd wordt en op verzoek gedeeld.
- §8 subverwerkers-opsomming: Anthropic toevoegen.
- §10 controller-tabel: Account-regel → "on request" (besluit 4); nieuwe regel audit van accounts/memberships/invites/promoters: life of venue; `platform_invites`: 24 maanden na laatste contact (sweep B1); audit-regel beperken tot guests/contacts/requests.
- §10 processor-blok: retentie-zin wordt "the period chosen by the venue, at most 60 months after the event"; erasure-on-request noemt ook requests.
- §12: push-tekst-zin definitief maken conform D12 (haken weg).
- §14: 16 blijft (besluit 7). Geen wijziging.
- Placeholders invullen die al besloten zijn (§7.1): "The Operators, a sole proprietorship (eenmanszaak), owner Max Merlijn Seffelaar, KvK 99992841, Goirkestraat 74-14, 5048 GM Tilburg, the Netherlands"; `privacy@`, `support@`, `legal@plus-one.io`; Sentry 30 dagen; back-ups 7 dagen (DPA §11/Annex 1E/Annex 3 "daily backups, retained 7 days").
- Subprocessors C, Slack-rij: `[confirm digest content before go-live]` weg; bevestigd 2026-10-05 dat de digest alleen aggregaten en venue-namen draagt.

**`subprocessors.md`** → v0.3
- Sectie A: rij **Anthropic, PBC** (US): purpose "engineering and support tooling (Claude Code with MCP connectors to our infrastructure providers); incidental access to production data during support requests and incident response"; data "whatever the support case requires; typically schema, logs and aggregates; guest rows only for a specific case"; location "US; EU–US Data Privacy Framework / SCCs [verify]"; certifications "[verify]"; opmerking "commercial terms; inputs are not used for model training".
- Sectie B, Resend-rij: afzender `@plus-one.io` (D13).
- Sectie C → B: **Attio** en **Slack** verhuizen naar B (besluit Max 2026-10-05: in gebruik door het team, handmatig, geen sync vanuit de app; purpose "manual use by the PlusOne team, no automated sync"). **PostHog** en **FCM/APNs** blijven C: er staat geen PostHog-SDK in app of site, en push verzendt pas na N5. Zodra één van beide code krijgt, verhuist de rij in dezelfde PR (README "Keep in sync").
- Sectie C, FCM/APNs-rij: `[decision pending]` over de eventnaam schrappen zodra D12 besloten is (advies: nooit de eventnaam).
- Versiehistorie: v0.3-regel.

**`guest-terms.md`**: niet aanraken (A2).

**`README.md`**
- Tabel: alle versies v0.3, datum gelijk; Guest Terms-rij toevoegen met `#guest-terms`.
- "Questions for Max" 3, 4, 6, 7, 8 afvinken met het besluit en datum.
- "Code follow-ups": verwijzen naar B1/B3/E1-taaknummers; device_id en inactieve accounts als "accepted/decided" markeren.
- "Keep in sync": export (E1), `platform_access_log`, `GUEST_TERMS_URL`.
- Nieuwe checkbox voor Max: back-up retentietermijn, Anthropic-entiteit/safeguard, cap-fallback (addendum).

Guard: `pnpm test -- claude-md-references`; grep op het oude domein; alle `[…]`-placeholders geteld vóór en na (mag alleen toenemen met de nieuwe Max-items).

### A2 — Guest Terms EN v0.3 + NL (Fable)
- EN: §5 cap schrappen (besluit 10); alleen behouden "PlusOne is not responsible for the event, the guest list decisions or admission. Those are the Venue's." + de bestaande as-is-beschikbaarheidszin. §4 retentie: "the period chosen by the Venue, at most 60 months after the event". §1: "Venue" definitie ongewijzigd, maar het woord "organizer" uit de kop halen ("PlusOne is the Venue's tool, not a party to your visit"). Toevoegen §3: acceptatie gebeurt door verzenden van het formulier (6:234 BW; spiegelt C1).
- NL: `guest-terms.nl.md`, volledige vertaling in de toon van `tone-of-voice.md` (je-vorm, geen juridisch jargon waar het niet hoeft), gelijke paragraafnummers. Kop: "Nederlandse versie; bij verschil geldt [de Nederlandse / Engelse] versie [advocaat]". README-tabel: rij toevoegen.
- Geen code.

### B1 — retention + forget + platform_invites sweep (Opus, high-risk)
Migratie `20261006120000_retention_requests_complete.sql`:
- `run_privacy_retention()` stap 2: ook `dedupe_key = null`, `birthdate = null`. Omdat de partial unique index `(event_id, dedupe_key) where status = 'pending' and dedupe_key is not null` dan geen anonieme pending request meer vangt, is de dedup-lek uit het commentaar bij stap 2b hiermee ook structureel dicht; stap 2b blijft als self-healing sweep staan.
- Nieuwe stap 6: `platform_invites` ouder dan 24 maanden sinds `greatest(created_at, updated_at, <laatste contact-kolom>)`: e-mail en note nullen, `anonymized_at` zetten (kolom toevoegen als die ontbreekt). Return-record uitbreiden met `requests_platform_invites`.
- `forget_contact(p_contact_id)`: extra update op `guest_requests` binnen dezelfde venue met `lower(email) = lower(c.email)` of `phone`-digits gelijk, zelfde scrub als de retention-stap (naam → `Aanvraag #n`, contactvelden/motivatie/decision/token/dedupe_key/birthdate null, `anonymized_at`), plus status-token-mirrors verwijderen zoals stap 2b, plus een `audit_log`-rij `anonymize` per request (zoals stap 5 van retention).
- `supabase/canonical/run_privacy_retention.sql` bijwerken (canonical-regel in `supabase/canonical/README.md`).
- pgTAP in `privacy.test.sql`/`contacts.privacy.test.sql`: (a) na retention zijn `dedupe_key` en `birthdate` null; (b) een nieuwe submission met dezelfde e-mail op een geanonimiseerd event wordt níét gededupet; (c) `forget_contact` anonimiseert de requests van die persoon in alle events van de venue en níét die van een andere venue met dezelfde e-mail; (d) `platform_invites` sweep raakt alleen rijen >24 maanden. Plan-count in `plan()` aanpassen; `pnpm db:test`, nooit bare.
- `src/lib/database.types.ts` regenereren.
- PR-body: security-research-prompt (CLAUDE.md-regel). Reviewer-sessie op Fable vóór Max test.

### B2 — request page: venue-naam, acceptatieregel, links (Sonnet)
- `src/lib/legal.ts`: `GUEST_TERMS_URL` (`https://plus-one.io/legal#guest-terms`, env-override `NEXT_PUBLIC_GUEST_TERMS_URL`).
- `src/lib/i18n/surfaces/landing.ts`: `privacyNote` → "Your details go to {venue} and are anonymized automatically after its retention period."; nieuwe `acceptLine` → "By sending this request you accept the PlusOne Guest Terms and {venue}'s privacy notice."; `formSub` en `emailRequired`: "the organizer" → "{venue}". Interpolatie via het bestaande catalogue-mechanisme in `src/lib/i18n/`.
- `src/components/po/landing.tsx`: venue-naam uit de bestaande public-event-query (check of `venues.name` al in de select zit; anders uitbreiden in de RPC, geen extra query); acceptatieregel direct boven de verzendknop met twee links via de kit's `openExternal()` (Capacitor-checklist); link "How your details are used" → `PRIVACY_URL` + `#guests`-anker (§4).
- Tests: `landing.test.tsx` uitbreiden (venue-naam gerenderd, beide links aanwezig, geen `target="_blank"`); e2e-layout blijft groen op 390px (tekst mag wrappen, knop ≥44px).
- Per-screen test-handoff voor Max.

### B3 — `platform_access_log` + CLAUDE.md-regel (Opus, high-risk door grant-matrix)
Migratie `20261006130000_platform_access_log.sql`:
- Tabel `public.platform_access_log(id uuid pk default gen_random_uuid(), admin_id uuid not null references auth.users, venue_id uuid not null references venues, reason text, created_at timestamptz default now())`. RLS aan. Grant-matrix expliciet: `revoke all from anon, authenticated`; `grant select, insert to authenticated`; policies: insert alleen als `public.is_platform_admin()` en `admin_id = auth.uid()`; select alleen `is_platform_admin()` (besluit 3: klant ziet het niet). Geen update/delete. `grant_matrix.test.sql` moet groen blijven zonder allowlist-wijziging (alleen insert/select).
- Retentie: geen anonimisering (operatorlog), wel in Privacy §10 benoemd via A1 (life of venue).
- App: in de venue-switch-flow (`settings/venue.tsx` + de `po_active_venue`-cookie-actie) één insert als `is_platform_admin` en de gebruiker **geen** eigen membership in die venue heeft; idempotent per (admin, venue, dag) is niet nodig — elke switch is een rij. Platform tab (`platform.tsx`): nieuwe sub-tab "Access log" met de rijen, read-only, filter op venue.
- pgTAP: venue-admin kan niet lezen/inserten; platform admin kan inserten voor zichzelf, niet voor een ander; geen delete-grant.
- `CLAUDE.md` §Platform admins: nieuwe bullet met de werkregel uit besluit 8 (prod-data via MCP/SQL: schema, logs, advisors, aggregaten standaard; gastrijen alleen bij een concreet ticket/incident, verwijzing in de log of ClickUp). "Reads are not audited" aanpassen naar "venue access through the app is logged in `platform_access_log`; direct DB reads are not". `tests/unit/claude-md-references.test.ts` moet groen.
- PR-body: security-research-prompt. Reviewer-sessie op Fable.

### E1 — export + marketing zichtbaar (Opus) — **spec**
Doel: een venue-admin haalt zelf alles wat de venue aan persoonsgegevens heeft als CSV op, zonder tussenkomst van PlusOne. Milestone Now (DPA 11.3, ToS 9.5/16.5).

- **Wie:** rol `admin` (óf `finance`? nee: alleen admin — finance ziet namen maar export is een controller-handeling). Server action `exportVenueData` in `src/features/export/actions.ts`, Zod-input `{ venueId, scope: 'venue' | { eventId } }`, user-scoped client (RLS bevestigt eigendom), `getUser()` server-side.
- **Wat:** één ZIP met vier CSV's, of vier losse downloads — kies ZIP via een kleine streaming-helper zonder nieuwe dependency als dat lukt, anders vier knoppen. Bestanden:
  - `guests.csv`: event_name, event_date, full_name, email, phone, plus_ones, tier, status, note, source, created_at, created_by (naam), checked_in_at.
  - `contacts.csv`: full_name, email, phone, birthdate, preferred_tier, note, **marketing_opt_in** (afgeleid: laatste request van dit contact met `marketing_opt_in = true`, of kolom op contacts als die er is), created_at, last_seen_event.
  - `requests.csv`: event_name, full_name, email, phone, plus_ones, motivation, **marketing_opt_in**, status, decision_reason, decided_by, created_at, request_link_name.
  - `door.csv`: event_name, guest_name, type (check_in/refusal), party_size, reason, acted_by, device_id, created_at.
  Geanonimiseerde rijen gaan mee zoals ze zijn (`Gast #n`), zodat de klant ziet dat ze bestaan maar geen PII meer krijgt.
- **Schaal:** nooit `.in()` met alle event-ids; filter op `venue_id` (alle vier tabellen dragen die). Stream per tabel in pagina's van 1 000 rijen via range; geen in-memory array van het hele venue. Timeout-budget Vercel: bij >50 000 rijen in één tabel een foutmelding "export per event" in plaats van een halve file.
- **Audit:** één `audit_log`-rij `export` per download (entity `venues`, diff `{scope, rows: {guests, contacts, requests, door}}`), via een kleine RPC `log_venue_export(...)`, geen trigger (er is geen row-mutatie). *Gebouwd als `SECURITY DEFINER` (#384): `authenticated` heeft geen INSERT op `audit_log`, en INVOKER zou een INSERT-grant + policy vergen waarmee elk lid audit-rijen kan vervalsen; de functie zet actor = `auth.uid()`, checkt admin-rol en event↔venue zelf, en schrijft voor een platform admin zonder membership ook een `platform_access_log`-rij (reden `export`).* Dit is de ene bewuste uitzondering op "reads worden niet geaudit"; CLAUDE.md-regel 4 krijgt die zin. Migratie `20261006160000_export_audit.sql` (gereserveerd als 140000; hernoemd omdat B2 met 150000 eerder mergde), grant-matrix expliciet.
- **UI:** Settings → Venue → kaart "Export data" (admin only; `finance`/`staff` zien de kaart niet), knop "Export everything" + per-event export vanuit het event-detail-menu. Billing-gate (`gate.ts`): export is **nooit** geblokkeerd, ook niet bij soft block (ToS 6.2 belooft read access). Native shell: gewoon een download via `openExternal()`? Nee — Capacitor-webview kan geen blob-download; in `isNativeShell()` toont de kaart "Export from the web app at app.plus-one.io" (zelfde patroon als billing read-only).
- **Marketing zichtbaar:** request-kaart in de inbox toont een badge "Keep me posted ✓" als `marketing_opt_in`; contact-detail toont dezelfde badge; contacts-lijst krijgt een filter "opted in to venue updates". Geen e-mailfunctie (regel 10).
- **Tests:** Vitest op CSV-escaping (komma's, quotes, newlines in notes), op rol-gate (staff → 403), op de audit-rij; pgTAP op de RPC-grant. E2e-smoke: admin downloadt, bestand bevat de seed-gast.
- **Docs in dezelfde PR:** README "Keep in sync" (E1), Privacy §10/ToS 9.5 kloppen al na A1.
- Per-screen test-handoff.

### D — publicatie (Sonnet, na advocaat)
- `Plus-One.io/src/lib/content.ts`: vier tabs + `#guest-terms` + `#subprocessors`, Markdown → de bestaande LEGAL-structuur; NL Guest Terms als sub-tab of taalwissel.
- Versie: alle docs "Version 1.0, [publicatiedatum]" (D14); README-tabel en versiehistorie.
- PlusOne: `TERMS_VERSION` → publicatiedatum (re-prompt consent-gate), `GUEST_TERMS_URL` controleren, `src/lib/legal.ts` TODO (86ey1vbrj) sluiten.
- Pricing-pagina `www.plus-one.io/pricing` moet bestaan (D8); mailboxen uit D3 moeten bestaan.
- Drive `02_Legal/` mirror (Max).

## 4. Gedeelde bestanden en volgorde

- `docs/legal/*.md`: L0 → A1 → A2 (A2 raakt alleen `guest-terms*.md` en de README-rij; A1 raakt `guest-terms.md` niet). E1 en B3 raken alleen `README.md` "Keep in sync" (één regel elk; rebase op A1).
- `CLAUDE.md`: B3 (§Platform admins) en E1 (regel 4, één zin). E1 rebaset op B3.
- `src/lib/legal.ts`: alleen B2.
- `landing.tsx`/`landing.ts`: alleen B2.
- `settings/venue.tsx`: B3 (venue-switch-log) en E1 (export-kaart). E1 wacht op B3 of werkt in een nieuwe `settings/export.tsx` die `venue.tsx` alleen importeert — voorkeur het laatste, dan parallel.
- `run_privacy_retention` canonical + migraties: alleen B1.
- Migratie-timestamps: B1 `20261006120000`, B3 `20261006130000`, B2 `20261006150000`, E1 `20261006160000` (oorspronkelijk 140000 gereserveerd; hernoemd zodat hij na de al-gemergde 150000 sorteert).

## 5. Review gates

- **B1, B3, E1 (RPC + grants) zijn high-risk** (`SECURITY DEFINER`/grant-matrix/retention). Worker schrijft de security-research-prompt in de PR-body; orchestrator spawnt een reviewer-sessie op Fable (brief: `capacitor-orchestration-claude-code.md` §6, aangepast: foothold = venue-admin van venue X probeert via export/forget/log rijen van venue Y te zien of PII na anonimisering terug te krijgen).
- A1/A2/B2/L0/D: CI is de gate.
- Advocaat-review is de gate vóór D, niet vóór A. A levert de tekst die de advocaat leest.

## 6. Orchestrator-prompt (copy-paste)

```
Je bent de orchestrator voor "Legal v0.3" van PlusOne Guestlist. Model: Fable.
Je bouwt zelf NIETS — je brieft, bewaakt, reviewt en rapporteert.

Lees eerst, in deze volgorde:
1. CLAUDE.md
2. legal-v03-plan-claude-code.md (dit plan; §1 besluiten zijn bindend, §3 taken, §4 volgorde, §5 gates)
3. capacitor-orchestration-claude-code.md §1, §5, §6 (mechaniek, worker-brief, reviewer-brief — identiek hier)
4. .claude/skills/clickup-task/SKILL.md
5. docs/legal/README.md op main (na L0: v0.2; vóór L0: v0.1 — dan eerst L0)

Startcheck, in één blok aan Max:
- staat v0.2 in docs/legal/? (anders eerst L0)
- git ls-files supabase/migrations | grep 20261006 tegen origin/main (moet leeg zijn)
- welke ClickUp-taken bestaan al voor L0/A1/A2/B1/B2/B3/E1/D; maak ontbrekende aan in lijst 901818739469 met Model:-regel en verwijzing naar dit plan
- wie is de DB-eigenaar vandaag (één sessie reset)

Daarna: spawn volgens §2 (max drie workers tegelijk), per worker de brief uit §3 letterlijk plus de
worker-template uit capacitor-orchestration §5. Voor B1/B3/E1: na de PR een reviewer-sessie (§5 hier).
Per PR lever je Max: oordeel, de genummerde test-handoff, en wat Max zelf moet doen (§7 hier).
Je merged niet. Je past het plan niet aan zonder Max; afwijkingen meld je als "plan zegt X, ik zie Y".
```

## 7. Wat Max zelf doet

| Wanneer | Wat |
|---|---|
| Vóór A1 | Anthropic: contracterende entiteit, DPA/commercial terms-link, transfer safeguard — voor de subprocessor-rij |
| Nu | Sentry → Project Settings → Security & Privacy → "Prevent Storing of IP Addresses" aan; screenshot in Drive `02_Legal/` |
| Nu | Vendor-entiteiten en certificeringen (README-lijst) bevestigen: Supabase, Vercel, Sentry, Cloudflare, Resend, Stripe, Google |
| Met Joeri | Cap-fallback bij datalek (§7.3: 3× jaarfee, min EUR 25.000) als intern addendum-sjabloon; partnerregeling-tarief; geheimhoudingsafspraak Joeri (§7.2) |
| Vóór eerste betalende klant | AVB/BAV met cyber- en datalekdekking afsluiten of bevestigen; verzekerde som boven de caps uit §7.3 (§7.2) |
| Na A | Alle `[…]`-placeholders invullen (lijst hieronder); dan naar de advocaat met de NL Guest Terms erbij |
| Na advocaat | D starten; Drive-mirror bijwerken |
| Per PR | Test-handoff beantwoorden ("1 ✅, 2 ❌ — …"); mergen |

### 7.1 Placeholder-besluiten (D-lijst uit de v0.2-sessie, aangevuld)

| # | Placeholder | Waar | Status / advies |
|---|---|---|---|
| D1–D2 | Entiteit: **The Operators, eenmanszaak**, KvK **99992841**, vestigingsadres **Goirkestraat 74-14, 5048 GM Tilburg** | alle zes docs, §1/kop | **Besloten.** Contractspartij is de eigenaar handelend onder de naam The Operators; docs: "The Operators (sole proprietorship, owner Max Merlijn Seffelaar), KvK 99992841". Alleen het KvK-adres is verplicht; Amsterdam alleen als publiek bezoekadres. Gevolgen eenmanszaak: §7.2. |
| D3 | `privacy@plus-one.io`, `support@plus-one.io`, `legal@plus-one.io` | Privacy §1/§16, ToS 11.4/19.2, DPA, Guest Terms §6 | **Besloten (2026-10-05):** deze drie adressen. A1 vult in. |
| D4 | Bevoegde rechtbank | ToS 20.2, DPA 14.3 | **Besloten: Rechtbank Zeeland-West-Brabant.** |
| D5 | Cap: vaste vloer **EUR [bedrag]** in ToS 14.2 | ToS 14.2, 14.4, DPA 13 | Uitleg en advies in §7.3. Voorstel: vloer **EUR 5.000**, te toetsen aan de verzekerde som. |
| D6 | Support-responstijd | ToS 11.4 | **Besloten:** eerste reactie **binnen 24 uur na ontvangst, elke dag** ("business days" uit 11.4 schrappen). Geen SLA-percentage (11.1 blijft). |
| D7 | Opzeg-/aankondigingstermijnen: prijswijziging [30], termswijziging [30], vertrouwelijkheid [2 jaar], PlusOne-opzegging (besluit 12: 3 maanden), restricted-state-beëindiging [90]+[30] | ToS 7.5, 18.1, 13.3, 16.2 | Draft-waarden accepteren tenzij de advocaat anders zegt. |
| D8 | Pricing-URL | ToS 7.1 | **Besloten:** `https://www.plus-one.io/pricing`, bestaat. `[confirm URL]` weg in A1. |
| D9 | Taal: welke versie prevaleert | ToS 19.7, Guest Terms NL-kop (A2) | **Besloten:** ToS/DPA Engels prevaleert; Guest Terms Nederlands prevaleert. Advocaat bevestigt formulering. |
| D10 | Inactieve accounts 24 maanden | Privacy §10 | **Besloten (besluit 4):** zin wordt "on request". A1. |
| D11 | Retentietermijnen controller-side | Privacy §10, DPA §11/Annex 1E, Annex 3 | **Besloten (2026-10-05):** Sentry **30 dagen**; Supabase back-ups **7 dagen**; CRM/prospects 24 maanden en support 2 jaar blijven draft tot de advocaat. A1 vult in. |
| D12 | Push-tekst toont nooit de eventnaam | Privacy §12, Subprocessors C, store-labels M4/S5, `capacitor-plan-claude-code.md` N5 | **Besloten (2026-10-05): nooit de eventnaam.** Generieke tekst, details na tap. A1 schrapt de `[decision pending]`-haken en zet één regel bij N5 in het Capacitor-plan. |
| D13 | Afzenderdomein login-mail | Subprocessors B (Resend-rij), `docs/mail-deliverability.md`, F3 `86ey6b3hv` | **Besloten: afzender is en blijft het apex `plus-one.io`, geen subdomein.** A1 schrijft dat in de Resend-rij en haalt de `theoperators.nl`-verwijzing uit README/subprocessors; `docs/mail-deliverability.md` nalopen (Max bevestigt dat de live SMTP-afzender al `@plus-one.io` is). F3 `86ey6b3hv` sluiten of herformuleren (Max). |
| D14 | Publiceren als **v1.0** na advocaat-OK | alle docs, README versiehistorie | **Besloten.** Repo-drafts v0.3 tot advocaat klaar; D zet "Version 1.0, [datum]". Latere wijzigingen 1.x met versiehistorie per doc. |
| D15 | Melden wanneer de advocaat klaar is, dan publicatie + `TERMS_VERSION` + `GUEST_TERMS_URL` | D | Gedekt door golf D. Max geeft het sein. |

### 7.2 Gevolgen van de eenmanszaak voor de docs

- **Onbeperkte persoonlijke aansprakelijkheid.** Er is geen rechtspersoon tussen de klant en het privévermogen van de eigenaar. De cap in ToS 14.2, de uitsluitingen in 14.3 en de vrijwaring in 15.1 zijn daarmee geen formaliteit maar de enige buffer. Een **bedrijfs-/beroepsaansprakelijkheidsverzekering (AVB/BAV) met cyber- en datalekdekking** is bij deze rechtsvorm een voorwaarde vóór de eerste betalende klant; de cap-bedragen in §7.3 moeten onder de verzekerde som blijven.
- **Partijaanduiding.** De contractspartij is de natuurlijke persoon, handelend onder de naam The Operators. In de docs: "The Operators, a sole proprietorship (eenmanszaak) registered with the Dutch Chamber of Commerce under number 99992841, owner Max Merlijn Seffelaar". ToS 14.4 "PlusOne's management" wordt "PlusOne's owner".
- **Joeri.** Een eenmanszaak heeft één eigenaar; Joeri is dan personeel of opdrachtnemer, geen vennoot. Dat raakt DPA §5 (vertrouwelijkheid: er moet een geheimhoudingsafspraak met Joeri liggen) en Privacy §8 "our own team". Geen tekstprobleem, wel een stuk papier dat moet bestaan.
- **Rechtsvormwissel later** (B.V.) is contractsoverneming; ToS 19.1 laat overdracht aan een opvolger toe met kennisgeving. Zo laten.

### 7.3 De aansprakelijkheidscap, uitgelegd (D5 + besluit 15)

**Hoe 14.2 nu werkt.** Totale aansprakelijkheid per contractjaar = de fees die de klant in de 12 maanden vóór de schadeveroorzakende gebeurtenis betaalde, **of, als dat hoger is, EUR [bedrag]**. Voor een trial- of comped-venue zijn de betaalde fees nul; zonder vloer is de cap dan nul.

**Waarom een cap van nul gevaarlijk is, niet veilig.** Een exoneratie die neerkomt op "wij zijn nergens voor aansprakelijk" ziet een rechter sneller als onredelijk bezwarend of naar maatstaven van redelijkheid en billijkheid onaanvaardbaar (6:248 lid 2 BW; voor kleine venues via 6:233 en de grijze lijst 6:237 sub f, zoals de reviewer aangaf). Dan sneuvelt de hele bepaling en geldt het wettelijke regime: onbeperkt, en bij een eenmanszaak dus privé. Een vloer die tussen "symbolisch" en "pijnlijk maar draagbaar" zit, maakt de clausule verdedigbaar en daarmee juist sterker.

**Hoe hoog.** Gebruikelijk bij SaaS: 1× jaarfee met een vloer van een rond bedrag. Voor PlusOne, met maandtarieven in de lage honderden euro's, is 12× maandtarief alleen (ongeveer EUR 1.000–3.000) te dicht bij symbolisch. Voorstel: **vloer EUR 5.000**. Toets: ligt ruim onder een gewone AVB-dekking (meestal EUR 1–2,5 mln per aanspraak), is voor een club geen lachbedrag, en is voor een eenmanszaak zelf te dragen als de verzekeraar niet uitkeert.

**Wat de cap niet mag raken (14.4).** Opzet of bewuste roekeloosheid, en dwingend recht. Art. 82 AVG: tegenover de **betrokkene** (de gast) kan niemand aansprakelijkheid wegcontracteren; tussen verwerker en verwerkingsverantwoordelijke mag de onderlinge verdeling wel geregeld worden. Dat doet DPA §13 door naar 14.2 te verwijzen. Richting consumenten (Guest Terms) geen cap, zoals besloten (besluit 10).

**Het datalek-scenario (besluit 15).** Een grote organisator accepteert bij een datalek geen cap van 12 maanden fee: zijn schade (meldplicht, communicatie naar gasten, boeterisico) staat los van wat hij ons betaalt. Daarom een vooraf bepaalde **fallback, alleen in een addendum**: aparte cap voor schendingen van de DPA van **3× de jaarfee met een minimum van EUR 25.000**, de rest van 14.2 ongewijzigd. Niet in de standaard-ToS, omdat de meeste venues de standaardcap nooit lezen en je het bedrag anders aan iedereen weggeeft. Max en Joeri stellen het bedrag vast; voorwaarde is dat het onder de verzekerde som ligt.

**Samengevat voor de advocaat:** vloer EUR 5.000 in 14.2; "management" wordt "owner" in 14.4; Guest Terms zonder cap; DPA-addendum-sjabloon met 3× jaarfee / min EUR 25.000; AVB met cyberdekking als voorwaarde.

## 8. Buiten dit plan (backlog, met milestone)

- Support-sessies DB-afgedwongen in de RLS-helpers — ≥25.
- `subscriptions.comped_until` + banner — ≥5.
- Zware audit-retentie (anonimiseren van invites/memberships/influencers-diffs) — niet gepland (besluit 5).
- Inactieve-account sweep — niet gepland (besluit 4).
- Guest-confirmation e-mail (86ey6bn05) en Resend naar sectie A — alleen na expliciet besluit (regel 10).
- PostHog-SDK + cookie-banner (Privacy §5 belooft consent vóór plaatsing) — eigen taak, na G1-PostHog uit CLAUDE.md; FCM/APNs naar sectie A met 30-dagen-notice — in N5.
- Product-MCP voor venues — eigen plan; raakt deze docs alleen als wij de AI-partij leveren.
