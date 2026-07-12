# G3 — Promotion-domein hergroeperen (Promo + Links + Influencers)

> **Status: GEBOUWD (12/7).** G1 was geland (#186); M14 nog niet — conform open vraag 3 is
> M14 (checked-in op de link-kaarten) als onderdeel van G3 meegenomen (event-links.tsx leest
> `usePoLinkFunnel`, dezelfde RPC als het Overzicht). Antwoorden op de open vragen: (1)
> flow-vorm = done-scherm met expliciete copy-stap (de aanbeveling hieronder); (2)
> organizer-toegang = de losse route `/app/events/[id]/links` (ScreenName 'links') blijft
> bestaan buiten het hub-menu-item; (3) volgorde = M14 in dezelfde PR. Doelstructuur en
> PR-volgorde hieronder zijn zoals gebouwd, in één PR met gescheiden commits (G3-0 → G3-1).
> Regelnummers verwijzen naar de staat van 2026-07-10 en zijn historisch.

## Besluiten (Max, 8/7 — `ux-ia-audit-claude-code.md` §5.3 G3 + vraag 6)

- Promo + Links + Influencers → **één Promotion-gebied**: venue-overzicht (funnel/leaderboards) ·
  per-event (links-beheer mét resultaten) · roster (influencers + stats-tokens als sub).
- **Create-link-flow wordt één gedeelde component** — nu 2× gedupliceerd (Links-sheet +
  Promo-modal), plus vergelijkbare tier-picker-UI die niet identiek is.
- **Gating (vraag 6):** het Promotion-dashboard is alleen voor **venue-leden**; een externe
  organizer (event-scoped, `event_organizers`) ziet het niet — die houdt alleen het per-event
  Links-beheer van zíjn event. Gating loskoppelen van `canViewStats` waar nodig.
- M14 (checked-in op Links-kaarten) is de quick-win die hierop vooruitloopt.

## Geverifieerde codebase-feiten (bouw hierop, niet op aannames)

**Schermen — allemaal onder `src/components/po/screens/`:**

| Bestand | LOC | Rol |
|---|---|---|
| `promo.tsx` | 627 | Promotion-dashboard: venue-brede funnel, leaderboard, per-event sectie, opent `CreateLinkModal` |
| `links.tsx` | 659 | Per-event links-beheer: lijst + `LinkSheet` (create/edit), pauzeren, QR |
| `influencers.tsx` | 320 | Venue influencer-roster + stats-tokens |
| `promo-create-link.tsx` | 300 | `CreateLinkModal` — form → done-scherm, gebruikt alleen door `promo.tsx` |

**Navigatie (`src/components/po/app.tsx`):**
- Screen-routing (regels 590–598): `case 'links'` → `<Links eventId={p.id} />`, `case 'influencers'` → `<Influencers />`, `case 'promo'` → `<Promo />`.
- `WIDE_DESKTOP`-set (regel 127) bevat geen van de drie; `promo.tsx` zet zelf een eigen breedte (`max-w-[820px]`, S15-design) los van die set.
- Nav-items (regels 663–668): Stats én Promo hangen **allebei** achter dezelfde `canViewStats`-check (regel 640: `(statsAccess?.venues.length ?? 0) > 0`) — geen aparte gate voor Links/Influencers, die worden elders (More-hub) los ontsloten.
- `ScreenName`-union in `src/components/po/context.tsx` (regels 14–43) bevat `'links' | 'influencers' | 'promo'` als losse keys.

**Create-link duplicatie (bevestigt de ClickUp-aanname):**
- `CreateLinkModal` — `promo-create-link.tsx:21`, aangeroepen vanuit `promo.tsx:624` ("+ New link"). Form → aparte "done"-stap met copy-knop. Tier-picker: horizontale, afgekapte knoppenrij (`promo-create-link.tsx:169-187`), toont alleen `short`-naam.
- `LinkSheet` — `links.tsx:279`, aangeroepen vanuit `links.tsx:242`. Create/edit in één sheet, geen aparte done-stap, keert terug naar de lijst met highlight. Tier-picker: verticale radio-rijen (`links.tsx:468-505`) met kleur-dot + capaciteit-hint.
- Twee visueel en functioneel verschillende tier-pickers voor exact hetzelfde datamodel (`PoTier`) is de kern van de duplicatie — niet alleen "twee keer dezelfde form", maar twee inconsistente patronen voor gebruikers die aan beide kanten (Promo én Links) een link aanmaken.

**Gating-laag (venue-lid vs. externe organizer):**
- `statsAccess` komt van de server (`app/page.tsx`) als whitelist van venue-id's — **geen** rolcheck, een aparte access-laag. Dat is precies waarom Stats én Promo nu gekoppeld zijn: beide gebruiken dezelfde whitelist.
- Externe organizers hebben géén `venue_memberships`-rij, alleen `event_organizers` (event-scoped, "External crew" — zie `[[external-crew-feature]]`). Ze zitten dus per definitie niet in `statsAccess.venues`, dus zien nu al geen Promo-nav-item.
- **Wat nu ontbreekt is het loskoppelen zelf**, niet een gat: Links (per-event) wordt vandaag los van `canViewStats` ontsloten (organizers kunnen al bij hún event-links), maar zodra Links een sub-route van het samengevoegde Promotion-gebied wordt, moet de nieuwe gate expliciet "per-event Links blijft toegankelijk voor de event-organizer, ook als `canViewStats` false is" borgen — anders regresseert vraag-6-gedrag stilzwijgend.
- RLS/RPC-laag is al venue-member-gated (`event_link_funnel`, `venue_influencer_leaderboard`, `venue_label_link_funnel`) — de DB-kant hoeft niet aangepast, dit is een UI/routing-vraagstuk.

**M14-gat (checked-in op Links-kaarten):**
- `LinkCard` (`links.tsx:49-156`) toont `stats = fmt(t.links.stats, { views, requests, approved })` — géén checked-in.
- Data bestaat al: `PoLinkFunnelRow.checkedInHeads` (`src/features/po/queries.ts:1795`), via `usePoLinkFunnel(eventId)` (`src/features/po/hooks.ts:702`), RPC `event_link_funnel`. Nu alleen gebruikt in `promo.tsx` (regels 88/138/298-312/475).
- `usePoRequestLinks(eventId)` (`hooks.ts:660-666`), de hook die `links.tsx` gebruikt, mapt naar `PoRequestLink` — dat type heeft geen `checkedInHeads`-veld.
- M14 is dus: `links.tsx` overzetten van `usePoRequestLinks` naar (of aanvullen met) `usePoLinkFunnel`-data — zelfde RPC die Promo al gebruikt. Dat is precies waarom G3 hierop moet volgen: als M14 dit apart oplost met een eigen merge-van-twee-hooks-aanpak, moet G3 dat straks weer aanpassen.

## Doelstructuur — één Promotion-gebied

```
Promotion (venue-leden only)
├─ Overzicht        venue-brede funnel + leaderboard (huidige promo.tsx-inhoud, minus per-event sectie)
│                    ── nav-gate: canViewStats (ongewijzigd)
├─ Per event         links-beheer mét resultaten (huidige links.tsx + M14 checked-in, nu embedded)
│                    ── nav-gate: venue-lid (canViewStats) VOOR de venue-brede lijst van events;
│                       organizer bereikt zíjn event-sectie via een aparte, ongated deep-link/route
│                       (niet via het Promotion-hub-menu-item)
└─ Roster            influencers + stats-tokens, sub van Promotion (huidige influencers.tsx)
                     ── nav-gate: canViewStats
```

**Routing-keuze (afhankelijk van G1):** als G1 (canonieke `/app`-URL's) al geland is, wordt "per
event" een echte sub-route (`/app/promotion/events/[id]` of vergelijkbaar) en is de
organizer-toegang een aparte URL zonder het Promotion-hub-item in de nav. Als G3 vóór G1 gebouwd
wordt (niet aanbevolen), blijft het de bestaande `ScreenName`-push-aanpak (`context.tsx`) en moet
de organizer-toegang tot "zijn event-links" een aparte `ScreenName` (`'links'` blijft bestaan als
losstaande, ongated ingang) naast het nieuwe `'promotion'`-scherm zijn — **niet** vervangen, om
vraag-6-gedrag niet te breken.

## Gedeelde create-link-component

Eén `CreateLinkFlow`-component die beide aanroeppunten (Promo "+ New link" én per-event
Links-beheer) bedient:
- **Eén tier-picker**: kies de rijkere variant (kleur-dot + capaciteit-hint uit `LinkSheet`,
  `links.tsx:468-505`) als basis — de horizontale afgekapte versie in `promo-create-link.tsx`
  verliest info, niet andersom. Dit raakt ook FE-4-nazorg (kit al gefold: `Seg`, `ConfirmSheet`,
  `Chips` zijn al gepromoot in PR #170 — een nieuwe gedeelde tier-picker hoort in `kit.tsx` als
  primitive, niet als eigen component in een screen-bestand).
- **Eén flow-vorm**: kies tussen "form → done-scherm" (Promo-stijl, expliciete copy-confirmatie)
  of "inline, terug-naar-lijst-met-highlight" (Links-stijl) — dit is een productbeslissing, geen
  technische; vraag Max voordat je bouwt welke UX wint (waarschijnlijk done-scherm, want een
  nieuwe link delen is het hele doel van de actie en verdient een expliciete copy-stap).
- **Component-plek:** niet in `promo.tsx` of `links.tsx` — een nieuw gedeeld bestand, bijv.
  `src/components/po/screens/promotion/create-link-flow.tsx`, geïmporteerd door zowel het
  Overzicht- als het Per-event-scherm.

## LOC-risico

Promo (627) + Links (659) + create-link (300) + Influencers (320) = 1906 LOC totaal vandaag.
Naïef samenvoegen tot één schermbestand overschrijdt de ~800-LOC-richtlijn ruim. **Niet
samenvoegen tot één bestand** — de "één Promotion-gebied" uit het besluit is een IA/nav-groepering
(één plek in het menu, gedeelde sub-navigatie), geen technische merge. Structuur:
- `screens/promotion/overview.tsx` (huidige promo.tsx minus per-event-sectie, minus create-link-logica)
- `screens/promotion/event-links.tsx` (huidige links.tsx + M14 checked-in)
- `screens/promotion/roster.tsx` (huidige influencers.tsx, vrijwel ongewijzigd)
- `screens/promotion/create-link-flow.tsx` (nieuw, gedeeld)
- `screens/promotion/shared.tsx` of toevoegingen aan `kit.tsx` voor de gedeelde tier-picker/funnel-line (`FunnelLine`, `promo.tsx:83`, is ook een kandidaat om te delen tussen overview en event-links)

Elk bestand blijft ruim onder 800 LOC; de sub-navigatie (tabs/segmented control tussen
Overzicht/Per event/Roster) gebruikt de al-gepromote `Seg`-kit-primitive (FE-4, PR #170).

## Openstaande vragen voor Max (vóór bouwen)

1. **Flow-vorm van de gedeelde create-link:** done-scherm (Promo-stijl) of inline-met-highlight (Links-stijl)?
2. **Organizer-toegang tot per-event Links** na G3: blijft dit een aparte route/entry buiten het Promotion-hub-menu-item (zoals dit plan voorstelt), of moet er een lichte "je ziet alleen je eigen event" variant van het Promotion-scherm zelf komen? Vraag 6 zegt "houdt alleen het per-event Links-beheer" — dat leest als: geen toegang tot het hub-item, wel tot de onderliggende event-route.
3. **Volgorde bevestigen:** dit plan gaat ervan uit dat M14 (of op zijn minst de `usePoLinkFunnel`-migratie van Links) eerst landt. Akkoord, of moet G3 dit meenemen als eerste stap van dezelfde PR-reeks?

## Aanbevolen PR-volgorde (ná M14, idealiter ná G1)

1. **PR G3-0:** gedeelde `CreateLinkFlow` + tier-picker-primitive in de kit; vervang de twee bestaande aanroepen (`promo.tsx`, `links.tsx`) zonder verder iets te verplaatsen — bewijst de component werkt in beide contexten voordat de IA verandert.
2. **PR G3-1:** nav/IA-hergroepering — nieuw `Promotion`-hub met Overzicht/Per event/Roster-subnav, gating losgekoppeld van `canViewStats` waar vraag-6 dat vereist, organizer-route apart gehouden.
3. **PR G3-2 (optioneel, kan met G3-1):** bestandssplitsing volgens de structuur hierboven als de gecombineerde LOC dat nodig maakt.

Elke PR volgt de Definition of Done uit `CLAUDE.md` (RLS/pgTAP niet van toepassing — dit is
UI/routing, geen schema-wijziging; wel de per-screen test-handoff, incl. een expliciete
organizer-login-test voor vraag-6-gating).
