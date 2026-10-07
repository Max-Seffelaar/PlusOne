# Ticketing providers — partner brief and outreach

Purpose: one document Max can send, or paste from, when contacting a ticketing provider about an API partnership. It states what PlusOne is, what the integration does, what we need from the provider's API, and what we already know per provider. The seven questions are the same for every provider; a provider that cannot answer 2 and 4 with "yes" cannot close the loop and is not integrated (decision #54).

## What PlusOne is

PlusOne (app.plus-one.io) is a guest-list application for clubs, festivals and event organisers in the Netherlands. Staff of a venue manage their guest lists per event under a quota; the door team checks guests in on a phone or tablet, offline-tolerant; everything is audited. Hosting: Vercel (Frankfurt) and Supabase (Ireland). Data processing agreement and subprocessor list are published at plus-one.io/legal.

## What the integration does

1. A venue admin connects their provider account to PlusOne once (OAuth or an API key).
2. PlusOne shows the provider's events; the admin links a PlusOne event to a provider event, or creates the PlusOne event from the provider's data.
3. A guest-list tier (e.g. "Guestlist", "VIP", "Crew") is linked to one of the provider's ticket types.
4. When staff add a guest to such a tier with first name, last name and e-mail, PlusOne asks the provider to create a **free** order for that person: one ticket plus one per companion, all to the guest's e-mail. Extras such as a parking ticket are separate lines on the same guest. The provider sends the ticket e-mail; PlusOne sends nothing.
5. The provider's scanners validate the ticket at the door. Each scan is delivered to PlusOne (webhook, or polled) and becomes a check-in in the guest list, so the venue sees who is inside in one place.

PlusOne never sells tickets, never touches prices or payments, and never reads paying customers' data. Only the free guest-list orders it created itself are read back (scan status).

## The seven questions for every provider

1. **Events and ticket types.** Can a connected account list its events (name, start, end, location) and the ticket types per event through the API?
2. **Free orders.** Can we create a zero-price order through the API with first name, last name, e-mail address and a quantity per ticket type, and will you e-mail the tickets to that address? Is there a dedicated guest-list or complimentary endpoint, or do we go through the regular order flow with a free payment method?
3. **Cancel.** Can we cancel an order or an individual ticket we created, as long as it has not been scanned?
4. **Scan feedback.** Do you push scan events to a webhook? If so: how is the call authenticated (signature header, shared secret), and what does the payload contain (ticket id, order id, scanner id, timestamp, direction in/out)? If not: which endpoint can we poll for scan status, and at what rate?
5. **Authentication.** Per venue: OAuth (how do we register an app, which redirect URI, which scopes, how long do refresh tokens live, can one account span several organisers) or a per-venue API key the venue pastes into PlusOne?
6. **Sandbox.** Is there a test environment or test account for development and automated tests?
7. **Limits and contact.** Rate limits for order creation (a backfill of a 150-person list is 150 orders) and a technical contact for the partnership.

What we promise in return: an idempotent webhook endpoint (duplicate deliveries answered with 200 and ignored), EU hosting, a signed data processing agreement, the provider listed as a subprocessor, and a named technical contact.

## Per provider — what the public documentation already answers

### Weeztix (formerly Eventix) — first adapter

- Public API docs at docs.weeztix.com: OAuth bearer, events / event dates / ticket types / shops / orders, webhooks with a `ticket: Scan` trigger, orders placed through the shop API with receiver first name, last name and e-mail; Weeztix mails tickets itself.
- Open: webhook signing, exact scan payload, the zero-price payment method or a complimentary endpoint, whether a guest-list shop can be created through the API, OAuth app registration and scopes, rate limits.
- Contact: apiteam@weeztix.com.

### CM.com Ticketing

- General Admission Partner API (developers.cm.com/ticketing): OAuth2 client credentials, `GET /events` (uuid, name, start/end, venue), reservations incl. a free reservation, barcodes. Rate limits: 5/s, 120/min, 3,600/h per key.
- Scan status: no webhook found; `GET /v2.0/export/ticket` with `eventTicket[checkedIn]` returns checked-in tickets, so the loop closes by polling within the rate limit.
- Open: free reservation with per-person e-mail and automatic ticket mail, cancel, per-organiser credentials, sandbox.
- Contact: support@cm.com or the Customer Success Manager (per their docs).

### Paylogic (See Tickets)

- Shopping Service API (shopping-api-docs.paylogic.com): events, products, orders, tickets, personalization, transfers. Authentication via several token types; partner access required.
- Open: zero-price orders, ticket mail by Paylogic, scan status or webhook, OAuth per organiser, sandbox (a sandbox docs host exists).

### Stager

- Push feed (help.stager.co): Stager posts event data to a partner webhook, HMAC-SHA256 signed (`X-Signature`), two permission levels. Guest tickets and a scanner app exist in the product.
- Open: everything on the write side (issuing free tickets through a partner channel) and scan feedback. Partner channels are set up through Stager's team.

### Celebratix

- Product includes guest list, crew access, scanner app, wallet passes. No public API documentation found.
- Open: all seven questions. Contact: hello@celebratix.io.

### WeTicket

- Dutch platform (€0.18 per ticket), guest list and barcode scanning app, a Partners page. No public API documentation found.
- Open: all seven questions. Contact via weticket.com (support for organisers / partners page).

## Draft e-mail (English; adjust the opening per provider)

Subject: API partnership — guest-list tickets and scan feedback

Hi [name],

I'm Max, founder of PlusOne (app.plus-one.io), a guest-list app for clubs and event organisers in the Netherlands. Several of our venues sell their tickets through [Provider], and they have asked us to connect the two.

What we want to build: a venue links their [Provider] account to PlusOne. When their staff put someone on the guest list, PlusOne creates a free ticket in [Provider] for that person (first name, last name, e-mail; one per companion), you send the ticket as usual, your scanners validate it at the door, and the scan comes back to PlusOne so the guest list shows who is inside. We never sell tickets, never touch prices or payments, and only read back the free orders we created ourselves.

To see whether this fits your API, I have seven short questions:

1. Can a connected account list its events and ticket types?
2. Can we create a zero-price order with name, e-mail and quantity, with the ticket e-mailed by you? Is there a dedicated guest-list endpoint?
3. Can we cancel an unscanned ticket we created?
4. Do you push scan events to a webhook (how is it signed, what is in the payload), or is there an endpoint to poll scan status?
5. Authentication per venue: OAuth (app registration, redirect URI, scopes, token lifetime) or an API key?
6. Is there a sandbox or test account?
7. Rate limits for order creation, and who is the technical contact?

We run on Vercel (Frankfurt) and Supabase (Ireland), sign a data processing agreement, list partners as subprocessors, and keep our webhook endpoint idempotent.

Happy to walk through it on a call. Thanks in advance.

Max Seffelaar
PlusOne — plus-one.io
