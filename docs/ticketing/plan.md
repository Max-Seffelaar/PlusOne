# Ticketing integration — what we are going to build

Plain-language plan, written 2026-10-07. The technical plan (tables, routes, tests) lives in `docs/ticketing/README.md`; the outreach material for the providers in `docs/ticketing/partner-brief.md`. Decision #54 in `gastenlijst-app-spec.md` is the formal record.

## The idea in one paragraph

A venue connects its ticketing provider (Weeztix first) to PlusOne once. From then on an event in PlusOne can be linked to the event in the provider, and a tier (VIP, Guestlist, Crew, …) can be linked to one of the provider's ticket types. When a guest is added to such a tier with a first name, last name and e-mail address, PlusOne asks the provider to create a free ticket for them. The provider mails the ticket, the provider's scanners scan it at the door, and the scan comes back to PlusOne as a check-in. The guest list and the ticketing system stay in sync without anyone exporting spreadsheets.

## What a venue will see

**Settings → Integrations.** A card per provider. "Connect Weeztix" sends the admin to Weeztix to approve the link and straight back to PlusOne. The card then shows the connected account, the date, and a Disconnect button. The same screen has "Import an event": a list of the provider's upcoming events, pick one, and PlusOne creates the event with the right name, date, time and location, already linked.

**Event → Ticketing.** For an existing event: "Link to a Weeztix event". After linking, the screen shows how many guests have a ticket, how many are waiting, how many failed, and how many have no e-mail yet. A button "Issue missing tickets" shows a preview ("38 guests have an e-mail, 4 don't. Issue 38 tickets now?") before anything is sent.

**Tier settings.** Once the event is linked, every tier gets a ticket setting:

- **None** — tier works as today, no tickets.
- **Optional** — when someone adds a guest to this tier, they are asked "Also send a ticket, or list only?". The switch is on by default when an e-mail is known.
- **Required** — everyone in this tier gets a ticket. First name, last name and e-mail are mandatory. A guest without an e-mail cannot be added from the app or from a bulk import.

Which ticket type the tier maps to (e.g. "Guestlist ticket") is picked from a list that comes from the provider.

**Adding a guest.** The add sheet asks for first name and last name separately when the tier needs a ticket. A guest with +3 gets one order with four tickets, all sent to their e-mail. Extras such as a parking ticket are added per guest: "Add extra ticket → Parking × 1". This matches how venues already deliver imports: one line per ticket type per person.

**The door.** Nothing changes for the doorhost. When the provider scans the guest's ticket, the guest turns green in the PlusOne door app within seconds, labelled "Ticket scan" instead of a doorhost name. Each further scan of the same guest's tickets counts one more +N as arrived. If the doorhost already checked the guest in by hand, the scan only tops up the +N count. A doorhost walking someone in at the door without an e-mail is still allowed, even in a "required" tier: the guest gets a "needs e-mail" flag and the ticket is issued as soon as someone adds the address.

**The guest row.** A small badge per guest: waiting, issued (2), failed (with retry), needs e-mail. Removing a guest cancels their unscanned tickets.

## What the venue will not see

- No ticket prices, payments or refunds in PlusOne. Only free tickets are ever created.
- No e-mail sent by PlusOne for Weeztix tickets. Weeztix mails them, with its own branding and wallet passes.
- No automatic creation of events from the provider. An admin always picks.
- No reading of paid ticket buyers into the guest list. That was the original "read-only" idea and stays parked.

## Which providers, in which order

| Provider | What we know today | Verdict |
|---|---|---|
| Weeztix | Public API, OAuth, webhooks with a ticket-scan trigger, orders with first/last name + e-mail. Six details unverified (see below). | **Build first.** |
| CM.com | Partner API with events and free reservations. Scan status only by polling an export every few minutes, 5 requests per second. | Second. Loop closes with polling instead of a webhook. |
| Paylogic | Shopping API with orders and ticket personalisation. Partner access needed. No scan feedback found. | Needs a conversation first. |
| Stager | Sends event data to partners. Issuing tickets or getting scans back is not documented. | Needs a partner deal first. |
| Celebratix | No public API documentation. | Outreach only. |
| WeTicket | No public API documentation. Guestlist and scanner app exist. | Outreach only. |

Rule agreed: a provider that cannot close the loop (issue → scan → back to us) is not integrated. Everything is built behind one interface, so a second provider is one adapter, not a rebuild.

## The build, step by step

Each step is one pull request and one ClickUp task.

0. **Decision and outreach material.** Spec decision #54, the project rules updated, this plan, the technical plan, and a one-page brief per provider with the seven questions we need answered. You can send the brief the same day.
1. **Database groundwork.** New tables for connections and event links, the ticket setting on tiers, first/last name columns, and a way for the system to record a check-in that no doorhost made. Reviewed as a security-sensitive change.
2. **Connecting Weeztix.** The provider interface, the Weeztix adapter, a fake provider for local testing, the Connect/Disconnect flow, secure storage of the provider's keys, and the Integrations screen.
3. **Linking events and tiers.** The event Ticketing screen, the event import, and the ticket setting in the tier form.
4. **Issuing tickets.** The queue that creates orders at the provider, retries on failure, the guest-add changes, the badges, and the "issue missing tickets" preview.
5. **Scans coming back.** The webhook that receives scans and turns them into check-ins, including all the edge cases (doorhost first, scan first, duplicate deliveries, unknown tickets, refused guests).
6. **Extras and bulk import.** Parking-style extra tickets per guest, and bulk paste that understands "name, e-mail, ticket type, quantity" lines and groups them per person.
7. **Switching it on in production.** Weeztix app credentials, environment setup, enabling the first venue, and a real-scanner test at that venue.

Steps 1 to 5 follow each other; 6 can start after 4. Every step ends with a test handoff you can tick off.

## What we need from Weeztix before step 2 is finished

These six questions go in the first mail to apiteam@weeztix.com. Steps 0 and 1 do not wait for the answers.

1. How are webhook calls authenticated (signature header, or none)?
2. What exactly is in a ticket-scan webhook: ticket id, order id, scanner, timestamp, in/out?
3. How do we create a zero-price order through the API, or is there a dedicated guest-list endpoint?
4. Can PlusOne create a hidden "guest list" shop per event through the API, or does the venue set one up in the dashboard?
5. OAuth app credentials, redirect URL registration, scopes, token lifetime, and how accounts with several companies behave.
6. Rate limits for creating orders (a backfill of 150 guests is 150 orders).

## Risks worth knowing

- **Weeztix unknowns.** If zero-price orders need a manual dashboard step per event, onboarding gets one extra instruction. The design does not depend on the answers; the adapter does.
- **Key storage.** Provider keys go in Supabase Vault. App roles cannot read them. The database superuser (SQL editor) can; that is documented and already covered by the operator rules.
- **Audit trail.** A check-in from a scan has no user behind it. It is recorded as a system action with the scanner's id, the same way auto-approved requests already are.
- **Scale.** Every ticket is one API call to the provider. The worker paces itself (two orders per second by default) until Weeztix confirms its limits.

## Parked, with the milestone that unparks it

- CM.com, Paylogic, Stager, Celebratix, WeTicket adapters — from 5 venues.
- PlusOne mailing tickets itself for providers that return a barcode but do not mail — from 5 venues.
- Matching the guest list against paid ticket buyers — from 25 venues.
- Scan-out / re-entry handling — from 5 venues.
- Ticket settings on event templates — from 5 venues.
- Several providers per venue or per event — from 25 venues.
