# PLUSONE — Design System (bron: Claude Design handoff)

De visuele bron van waarheid is de design-bundle in `docs/design/` (uit claude.ai/design). De prototypes zijn HTML/CSS/JS — **recreëer de visuele output pixel-perfect in onze stack (Next.js/Tailwind/shadcn), kopieer nooit de interne structuur van het prototype**. Lees bij twijfel het bronbestand; het transcript in `docs/design/chats/chat1.md` bevat de ontwerpintentie.

Primair bestand: `PlusOne Gastenlijst.html` (mobile app). Secundair: `Mainstage HQ.html` (desktop-dashboard — nog niet omgezet naar de PLUSONE-stijl; bij dashboardschermen de PLUSONE-tokens gebruiken, niet de oude neon-stijl).

## Identiteit

- Naam: **PLUSONE** ("+1"-wordmark). Toon: menselijk maar strak. Microcopy warm en kort: "Zet ze op de lijst. Wij doen de deur."
- Eén accent, hoog contrast, geen kleurenregenboog. Statussen leven van wit/grijs + het ene accent.
- Initialen-avatars, geen foto's.

## Tokens (uit `po-kit.jsx` — exact overnemen als CSS-variabelen/Tailwind-theme)

```
--bg:      #0B0B0D        achtergrond (bijna-zwart)
--elev:    #161618        kaarten / velden
--elev2:   #1E1E21        verhoogde elementen, avatars, knoppen-dark
--line:    rgba(255,255,255,0.10)   randen
--line2:   rgba(255,255,255,0.06)   subtiele scheidingen
--text:    #FFFFFF
--dim:     rgba(255,255,255,0.58)
--faint:   rgba(255,255,255,0.40)
--ghost:   rgba(255,255,255,0.26)
--acc:     #B5A6FF        lavendel-accent (CTA's, "binnen"-status, badges)
--acc-soft:#C9BEFF
--acc-dim: rgba(181,166,255,0.16)   accent-achtergrondvlakken
--on-acc:  #16132B        tekst op accent
```

Typografie: **Bricolage Grotesque** (600/700/800) voor display/koppen/knoppen, letter-spacing -0.01 à -0.02em; **Hanken Grotesk** (400–700) voor body/UI. Labels: 12px, 700, uppercase, letter-spacing 0.04em, kleur `--faint`.

Vormtaal: ruime radii — knoppen 14px, velden 14px, kaarten/sheets 20–26px, avatars ~32% van hun maat. Geen harde schaduwen op kaarten; diepte via `--elev`-lagen en 1px `--line`-randen. Bottom-sheets voor modals (slide-up, 26px radius). Toast: accent-achtergrond, onderin.

Interactie: hover `brightness(1.07)`, active `scale(0.975)`; entrance-animaties alleen `translateY` (opacity altijd 1 — geleerde les uit het prototype) en achter `prefers-reduced-motion`.

## Kerncomponenten (1-op-1 uit het prototype)

- **RoleChip** — tier met icoon (VIP=kroon, All Access=schild, Artist=ster, Pers=notitie, Crew=users, Gast=user), uppercase, `--elev2` + `--line`.
- **StatusDot** — "Binnen" = gevulde accent-cirkel met check; "Onderweg" = lege ghost-ring.
- **PayChip** — "€ MOET BETALEN" in dashed border (alleen tonen bij deurbetaling).
- **Stepper** — grote +/− (52px tikdoelen) op `--acc-dim`-vlak, teller in display-font, "N personen".
- **Btn**-varianten: primary (accent), dark, ghost, quiet.
- **Row** — lijstregel met icoonblok, titel/sub, chevron.

## Schermgedrag dat in de bouw moet landen

- **Check-in (deur):** toggle **Beide / Onderweg / Ingecheckt**. Ingecheckte gasten verdwijnen níet: ze dimmen (opacity ~0.55) en zakken bij "Beide" naar onderen, achter een **"AL BINNEN · N"**-divider. Live tellers onderweg/binnen. Check-in via bottom-sheet met stepper → "Check in · N personen".
- **Gast-detail:** **Logboek**-blok — toegevoegd door wie + wanneer, meegenomen +N, en na check-in: hoe laat + door welke gebruiker (rendert het audit log per gast).
- **"Let op!"-popup:** notitie met prioriteitsvlag → bottom-sheet bij het openen van de gast, expliciet afvinken met **"Gezien & opgepakt"** (acknowledgement wordt gelogd). Status deelt met de Taken-tab.
- **Taken-tab:** per-gast-opdrachten met prioriteitsvlag (BELANGRIJK eerst), tellers open/belangrijk/klaar, filter Open/Klaar/Alle, badge met aantal open op de tab.
- **Events:** gegroepeerd per maand met datumchips; event-overzicht met onderweg/binnen, opkomstbalk en alerts.
- **Toelages:** "7/10"-weergave bij de eigen gastenteller; teamleden met allowance en per-event override.

## Scherm-inventaris: gedekt vs. ontbrekend

**Gedekt door het prototype (mobiel):** welcome/login-frame, events per maand, event-overzicht, gastenlijst met filters/rollen, gast-detail + logboek + check-in-sheet, deur-modus (toggle, AL BINNEN-divider), Let op!-popup, Taken-tab, vaste gasten, contacten, rollen & toelages, import, instellingen.

**Nog te ontwerpen (design-sprint, parallel aan fase 0–3 — zie ClickUp-taak "Design-sprint"):** hi-fi: quick-add-veld met preview-chips + bulk-paste (#33), publieke landingpage (fase 8), dashboard-home desktop, statistieken + audit log desktop (fase 10). Wireframe-niveau volstaat: login/OTP/invite/MFA-flows, userbeheer, event-CRUD + tier-beheer met aliassen, goedkeuringsschermen. `Mainstage HQ.html` is oude stijl — niet als referentie gebruiken.

**Regel voor Claude Code:** bestaat er geen ontwerp voor een scherm, bouw het dan met de tokens en componenten uit dit document als enige bron — introduceer nooit nieuwe kleuren, fonts of vormtaal.

## Afwijkingen prototype ↔ spec (spec wint)

- Prototype kent betaalstatus per gást; ons model hangt `door_price` aan de **tier** (#34). UI-patroon (PayChip, waarschuwing in de check-in-sheet) overnemen, datamodel volgen.
- Prototype-rollen (VIP/All Access/…) zijn voorbeelden van **tiers** (#8), geen vaste lijst.
- "Vaste gasten" (ster) = `fixed_members`, fase 2 (#18).
- Adresboek/contacten = fase 2-kandidaat (venue-contacten, hergebruik over events); niet in MVP.
