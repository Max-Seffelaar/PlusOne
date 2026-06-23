# PlusOne — Copy deck (English, voice-applied)

> Échte schermcopy in de PlusOne-stem (zie `tone-of-voice.md`). Start met de twee uitersten van de **dial**:
> **Landing = knipoog hoog**, **Deur = knipoog nul (snelheid wint)**. Kolommen: *Element · Oud (NL) · Nieuw (EN)*.
> Dit is de **seed van de centrale message-catalogus** (`ia-audit-claude-code.md` §8) — string-voor-string, klaar om
> te bedraden. Bron-strings uit `landing.tsx` en `src/features/door/components/*`.

## §1 — Landing (`/e/[slug]`) · knipoog HOOG

| Element | Oud (NL) | Nieuw (EN) |
|---|---|---|
| Eyebrow / badge | "Gastenlijst-aanvraag" | `{Event} · guest list` |
| Hero-kop *(nieuw)* | — | `You're almost on the list.` |
| Hero-sub *(nieuw)* | — | `Drop your name and we'll see you at the door. No QR, no screenshots.` |
| Deurtijd | "deur 23:00" | `doors 23:00` |
| Veld — naam | "NAAM" | `Name` |
| Veld — plus-ones | (—) | label `Plus-ones` · placeholder `+2` |
| Veld — telefoon | "TELEFOONNUMMER" | `Phone number` |
| Veld — e-mail | "E-MAIL" | `Email` |
| Veld — bericht | "optioneel" | label `Anything we should know?` · `optional` |
| Marketing opt-in | (—) | `Keep me posted on upcoming nights.` |
| Submit-knop | "Aanmelden" | `Request my spot` |
| Validatie — e-mail | "Vul een geldig e-mailadres in." | `That email doesn't look right. Mind checking it?` |
| Validatie — telefoon | "Controleer je telefoonnummer (incl. landcode)." | `Check your phone number, including the country code.` |
| Success-kop | "Je aanvraag is in behandeling" | `Request sent. You're in the queue.` |
| Success-groet | "Bedankt, {name}…" | `Nice one, {name}.` |
| Success-tekst | "De organisatie van {event} beoordeelt je aanvraag." | `{event} is reviewing your spot. We'll sort the rest at the door.` |
| Info-banner | "Bewaar deze pagina niet als bewijs — check-in loopt op naam aan de deur." | `No need to screenshot this. We check you in by name at the door.` |
| Reset-knop | "Nog iemand aanmelden" | `Add someone else` |
| Gesloten-kop | "Aanvragen gesloten" | `The list is closed.` |
| Gesloten-tekst | "Deze aanmeldlink is niet (meer) actief. Vraag de organisatie om een actuele link." | `This sign-up link isn't active anymore. Ask the organizer for a fresh one.` |
| Footer | "Gastenlijst geregeld via PLUSONE" | `Guest list, handled by PlusOne` |

## §2 — Deur · knipoog NUL (telegrafisch, scanbaar)

### 2a · Check-in (`CheckInList`)
| Element | Oud (NL) | Nieuw (EN) |
|---|---|---|
| Titel | "Check-in" | `Check-in` |
| Stat — onderweg | "gasten onderweg" | `on the way` |
| Stat — binnen | "gasten binnen" | `inside` |
| Headcount-sub | "koppen" | `people` |
| Zoek-placeholder | "Typ de naam van de gast…" | `Search a name…` |
| Toevoeg-knop (aria) | "Gast ter plekke toevoegen" | `Add on the spot` |
| Filter-segmenten | "Beide / Onderweg / Ingecheckt" | `All / On the way / Inside` |
| Resultaat-telling | "{n} gevonden" | `{n} found` |
| Telling — binnen | "ingecheckt" | `checked in` |
| Telling — wachtend | "nog aan de deur" | `still at the door` |
| Lijst-kop | "Volgende aan de deur" | `Next at the door` |
| Sectie-divider | "AL BINNEN · {n}" | `INSIDE · {n}` |
| Leeg — zoeken | "Geen gast gevonden." | `No match. Check the spelling, or add them on the spot.` |
| Leeg — niemand binnen | "Nog niemand ingecheckt." | `No one inside yet.` |
| Leeg — allen binnen | "Iedereen is binnen 🎉" | `Everyone's in.` |
| Dubbel-marker | "DUPLICAAT" | `DUPLICATE` |
| Log-intro | "door" | `by` |
| Deel-party | "nog {n} onderweg" | `{n} still on the way` |

### 2b · Tasks (`Taken`)
| Element | Oud (NL) | Nieuw (EN) |
|---|---|---|
| Titel | "Taken" | `Tasks` |
| Subtitel | "openstaande opdrachten aan de deur" | `open jobs at the door` |
| Stat-labels | "open / belangrijk / klaar" | `open / priority / done` |
| Filter-segmenten | "Open / Klaar / Alle" | `Open / Done / All` |

### 2c · Guest detail (`GuestDetail`)
| Element | Oud (NL) | Nieuw (EN) |
|---|---|---|
| Titel | "Gast" | `Guest` |
| Taak-prio (hoog/normaal) | "Belangrijke opdracht / Opdracht" | `Priority task / Task` |
| Taak-status | "Opgepakt / OPEN" | `Done / OPEN` |
| Taak-acties | "Markeer als opgepakt / Heropenen" | `Mark as done / Reopen` |
| Betaal-banner | "Betaalde gastenlijst — laat afrekenen aan de deur" | `Paid guest list. Collect payment at the door.` |
| Logboek-kop | "Logboek" | `Log` |
| Log — toegevoegd | "Toegevoegd" | `Added` |
| Log — plus-ones | "Meegenomen gasten" | `Plus-ones` |
| Log — ingecheckt | "Ingecheckt · +{n} / Ingecheckt" | `Checked in · +{n} / Checked in` |
| Log — actor fallback | "Deur" | `Door` |
| Log — teruggedraaid | "Check-in teruggedraaid" | `Check-in reversed` |
| Status — onderweg | "onderweg / Nog niet ingecheckt" | `on the way / Not checked in yet` |
| Deel-binnen kop | "Nog niet iedereen binnen" | `Not everyone's in yet` |
| "{x} van {y} binnen" | "van" | `of` ( `{x} of {y} inside` ) |
| Stepper — meer | "Nog inchecken · {n} personen" | `Check in more · {n} people` |
| Stepper — eerste | "Check in · {n} personen" | `Check in · {n} people` |
| Weiger-knop | "Weigeren · reden verplicht" | `Refuse · reason required` |
| Weiger-veld | "Reden voor weigering" | `Reason for refusal` |
| Weiger-placeholder | "bv. 'te veel gasten'" | `e.g. "over capacity"` |

### 2d · Add on the spot (`AddOnSpot`)
| Element | Oud (NL) | Nieuw (EN) |
|---|---|---|
| Titel | "Gast toevoegen" | `Add guest` |
| Sub — geen quota | "geen persoonlijk quotum" | `no personal quota` |
| Sub — quota over | "jouw quotum {n} van {m} over" | `your quota · {n} of {m} left` |
| Sub — fallback | "aan de deur" | `at the door` |
| Invoer-label | "Typ vrij — naam, +gasten, tier" | `Type freely: name, +guests, tier` |
| Invoer-placeholder | 'bv. "Juri Braakman +2 vip"' | `e.g. "Juri Braakman +2 vip"` |
| Tier-fallback | "Regular" | `Regular` |
| Ambiguïteit | '"{x}" herken ik niet. Wat bedoel je?' | `Not sure what you mean by "{x}". Pick one:` |

### 2e · Door shell (`DoorShell`)
| Element | Oud (NL) | Nieuw (EN) |
|---|---|---|
| Tabs | "Check-in / Taken" | `Check-in / Tasks` |
| Terug-knop | "Terug" | `Back` |

---

> Vanaf hier 2 koloms (*Context → EN*); het NL-origineel wordt bij het bedraden 1-op-1 gemapt. **Dial per sectie**
> genoteerd. Geen em-dashes, geen slop-woorden, straight quotes, sentence case, cijfers als cijfers (§ tone-of-voice).
> Actie-paren: gast aan de deur = **Refuse**; een aanvraag in de inbox = **Approve / Decline**; quota-verzoek = **Approve / Deny**.

## §3 — Home (dial: laag-midden)

| Context | EN |
|---|---|
| Groet 05–12 / 12–18 / 18–24 / 00–05 | `Good morning, {name}.` · `Good afternoon, {name}.` · `Good evening, {name}.` · `Working late, {name}?` |
| Actief-event kop (live) | `Live now` |
| Turnout-label | `Turnout` |
| KPI-tiles | `Inside` · `On the way` · `Requests open` · `Quota left` |
| Quick actions | `Add guest` · `Open the door` · `Review requests` |
| Geen event (leeg) | `Nothing on tonight. Create an event and get the list going.` + knop `New event` |
| Activity-feed kop (admin) | `Latest` |
| Feed-regel | `{actor} checked in {guest}.` |
| Link naar reports | `View analytics` |

## §4 — Guests (dial: laag)

**Guest list**
| Context | EN |
|---|---|
| Titel / zoek | `Guests` · placeholder `Search guests…` |
| Filters | `All` · `On the way` · `Inside` · `VIP` |
| Acties | `Add guest` · `Paste list` · `Contacts` |
| Telling | `{n} guests · {m} people` |
| Leeg | `No names yet. Add your first guest and fill the list.` |
| Lijst op slot | `List's locked. Only an admin can unlock it.` |
| Status-chips | `On the way` · `Inside` · `Refused` · `+{n}` |

**Add guests** (Quick-add + Bulk samengevoegd)
| Context | EN |
|---|---|
| Titel / modus | `Add guests` · toggle `One at a time` / `Paste a list` |
| Hint (single) | `Type a name, plus-ones, and a tier.` placeholder `e.g. "Juri Braakman +2 vip"` |
| Hint (paste) | `Paste names, one per line. We'll read the plus-ones and tiers.` |
| Quota-sub | `Your quota · {n} of {m} left` / `No personal quota` |
| Dubbel | `Already on the list` · marker `DUPLICATE` |
| Onduidelijk | `Not sure what you mean by "{x}". Pick one:` |
| Bevestig | `Add guest` / `Add {n} guests` |
| Over quota | `That puts you over your quota for this event. Ask an admin to raise it.` |

**Guest detail** (beheer-context; deur-versie staat in §2c)
| Context | EN |
|---|---|
| Titel / log | `Guest` · `Log` |
| Acties | `Edit` · `Refuse` · `Remove guest` |
| Verwijder-bevestig | `Remove this guest? They'll drop off the list. You can't undo this.` |

**Contacts** (Adresboek + Regulars samengevoegd)
| Context | EN |
|---|---|
| Titel / filter | `Contacts` · `All` / `Regulars` |
| Zoek / toevoegen | placeholder `Search contacts…` · `Add to event` |
| Regular | knop `Make regular` · badge `Regular` · sub `Auto-added to every list` |
| Import-actie | `Import contacts` |
| Leeg | `No contacts yet. Save a guest to reuse them next time.` |

## §5 — Events (dial: laag-midden)

| Context | EN |
|---|---|
| Titel / tabs | `Events` · `Upcoming` / `Past` |
| Nieuw | `New event` |
| Leeg (upcoming/past) | `No upcoming events. Create one and start the list.` · `No past events yet.` |
| Kaart-tijd | `doors {time}` |
| Status-chips | `Draft` · `Open` · `Live` · `Closed` |
| Detail-stats | `On the way` · `Inside` · `Turnout` |
| "Net binnen"-kop | `Just in` |
| Detail-acties | `Open the door` · `Guest list` · `Requests ({n})` · `Edit` · `Tiers` |
| Edit-titel / velden | `New event` / `Edit event` · `Name` · `Date` · `Doors` · `Landing page` · `Auto-lock` · `Lock list` · `Allow check-out` |
| Lock-hint | `Locked lists can't be changed by staff.` |
| Opslaan | `Create event` / `Save event` |
| Tiers | titel `Tiers` · `Add tier` · velden `Tier name` / `Aliases` · leeg `No tiers yet. Add one like "VIP" or "Guest".` |
| Recap (gesloten event) | kop `Recap` · `Turnout {pct}%` · `Checked in {n}` · `No-shows {n}` · `Refused {n}` · `Peak {time}` · `By tier` |

## §6 — Requests (dial: laag)

| Context | EN |
|---|---|
| Titel / tabs | `Requests` · `Guest list` / `Quota` |
| Scope | `All events` / `{event}` |
| Gast-aanvraag | naam `+{n}` · `Set tier` · `Approve` / `Decline` |
| Quota-verzoek | `{user} wants {n} more for {event}.` · `Approve` / `Deny` |
| Toast | `Approved. {name} is on the list.` |
| Leeg | `No requests right now. The line's clear.` |

## §7 — Analytics (was Stats; dial: laag)

| Context | EN |
|---|---|
| Titel | `Analytics` |
| Venue-KPIs | `Turnout` · `Guests added` · `Check-ins` · `Refusals` |
| Event-picker | `Pick an event` |
| Per-event | `Arrivals by 15 min` · `By tier` · `Added by` |
| Leeg | `No numbers yet. They'll show once you run an event.` |
| Refresh | `Refresh` |

## §8 — Audit log (dial: nul, vertrouwen)

| Context | EN |
|---|---|
| Titel / zoek | `Audit log` · placeholder `Search the log…` |
| Filters | `Event` · `Person` · `Action` |
| MFA-gate | `Verify it's you to open the audit log.` · knop `Verify` |
| Regel (feitelijk) | `{actor} {action} {target} · {time}` → bv. `Mara added Juri (+2).` · `Door host checked in Sef.` · `Admin unlocked the list.` |
| Per-gast | kop `Timeline` |
| Leeg | `Nothing logged yet.` |

## §9 — More / Settings (dial: laag)

**Hub**
| Context | EN |
|---|---|
| Titel | `More` |
| Secties (desktop-groepen) | `Account` · `This venue` · `Team & access` · `Insights` · `Switch venue` |

**Account**
| Context | EN |
|---|---|
| Titel / velden | `Profile` · `Name` · `Email` |
| E-mail-noot | `Only you can change your email.` |
| Apparaten | `Your devices` · `This device` · `Log out` · `Log out everywhere` |

**This venue**
| Context | EN |
|---|---|
| Venue settings | titel `Venue settings` · `Venue name` · `City` · `Company (KVK)` · `VAT` · `Billing email` · `Data retention` · `Allow check-out by default` · `Save settings` |
| Quota | titel `Quota` · `Default guests per host, per event` · help `How many guests each host can add to an event.` |
| Billing | titel `Billing` · `Plan` · status `Trial`/`Active`/`Past due`/`Canceled`/`Comped` · `Manage billing` · `Invoices` · past-due-banner `Your payment's overdue. Update it to keep things running.` |
| Import | titel `Import contacts` · `Paste, CSV, or phone contacts` · knop `Import` |

**Team & access**
| Context | EN |
|---|---|
| Team | titel `Team` · `Invite` · `Remove` · invite-form `Email` / `Roles` / `Send invite` · geen-rechten `You don't have rights to manage the team.` |
| Roles & permissions | titel `Roles & permissions` (read-only uitleg) |
| Team sessions | titel `Team sessions` · `Pick a member` · `Log out device` · MFA-gate `Verify it's you.` |

**Switch venue**
| Context | EN |
|---|---|
| Titel | `Switch venue` · `{venue} · current` · `New venue` |

## §10 — Auth & MFA (dial: laag; welcome mag persoonlijkheid)

| Context | EN |
|---|---|
| Welcome | `Welcome to PlusOne` · sub `The guest list that runs the door.` |
| Login | `Log in` · `Email` · `Send code` · help `We'll email you a 6-digit code. No passwords here.` |
| OTP | `Enter your code` · `We sent a 6-digit code to {email}.` · `Verify` · `Resend code` |
| MFA enroll | `Set up two-factor` · `Scan this with your authenticator app, then enter the code.` · `Verify` |
| MFA step-up | `Verify it's you` · `Enter the code from your authenticator app.` · `Verify` |
| Invite | `You're invited to {venue}.` · `Accept invite` |
| Auth-errors | `That code didn't work. Check it or resend.` · `This invite has expired. Ask for a new one.` |

## §11 — Onboarding (venue aanmaken; dial: midden)

| Context | EN |
|---|---|
| Kop | `Set up your venue` · sub `Two minutes and you're running the door.` |
| Velden | `Venue name` · `City` · `Company (KVK)` · `VAT` · `Billing email` · `Data retention` |
| Knop | `Create venue` |

## §12 — Errors & system states (dial: nul; kalm + behulpzaam)

| Context | EN |
|---|---|
| 404 | `This page took the night off. Head back to your dashboard.` · knop `Back to Home` |
| 500 / generiek | `Something broke on our end. Try again in a moment.` |
| Offline | `You're offline. Your check-ins are saved and will sync when you're back.` |
| Geen toegang | `You don't have access to this. Ask an admin if that's wrong.` |
| Leeg generiek | `Nothing here yet.` |

## §13 — Notifications & e-mails (dial: midden; kort, één CTA)

> Let op: géén gast-gerichte mail/WhatsApp (spec #10/#40d, geparkeerd). Alleen team-/auth-transactioneel + push.

**Push**
| Context | EN |
|---|---|
| Deur open | `Doors are open at {event}. 0 inside, {n} on the list.` |
| Nieuwe aanvraag | `New request from the landing page. Tap to review.` |
| Check-in | `{guest} just checked in. {n} inside.` |

**Transactionele e-mail**
| Context | EN |
|---|---|
| Invite | onderwerp `You're on the team at {venue}` · body `{inviter} added you to {venue} on PlusOne. Tap to set up your account.` · CTA `Accept invite` |
| OTP | onderwerp `Your PlusOne code: {code}` · body `Here's your 6-digit code. It expires in 10 minutes.` |

---

**Status:** Landing + Deur + alle bovenstaande schermen gedekt. Dit is nu de **volledige seed van de message-catalogus**
(`ia-audit-claude-code.md` §8). Volgende stap bij het bedraden: keys toekennen per regel en de NL-originelen 1-op-1 mappen.
