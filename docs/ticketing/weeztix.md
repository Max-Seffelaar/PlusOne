# Weeztix adapter — API mapping

What the public documentation (docs.weeztix.com, read 2026-10-07) says, split into verified and assumed. Update this file as answers from apiteam@weeztix.com come in; the assumptions below are the six open questions in `README.md` §10.

## Verified from the docs

| PlusOne concept | Weeztix | Notes |
|---|---|---|
| Connection | OAuth bearer token on `api.weeztix.com` | Flow type, scopes and refresh lifetime not shown on the public pages. Contact: apiteam@weeztix.com. |
| Provider account | Company | One token may span several companies; `ticketing_connections.provider_account_id` stores the chosen company. |
| Provider event | Event (`GET /event`, `GET /event/:guid`) with EventDates and an EventLocation | Events are created through `/location` in Weeztix's own model; we never create events there. |
| Ticket type | "Ticket" (`GET /event/:guid/ticket`) | In Weeztix vocabulary a *ticket* is a ticket type; issued barcodes are *order tickets*. `guest_tiers.ticket_type_external_id` = the ticket GUID. |
| Shop | Shop (`GET /shop`, `GET /shop/:guid/payment_methods`) | Orders are placed inside a shop, so a link stores `shopGuid` in `event_ticketing_links.provider_meta`. |
| Issue tickets | Shop API: `GET https://shop.api.openticket.tech/:shopGUID/reserve/ticket/:ticketGUID` per ticket (8-minute reservation), then `POST https://shop.api.weeztix.com/:shopGUID/order` with `receiver{locale,email,firstname,lastname}`, `paymentProvider`, `currency`, `tickets[{guid,reservation,products[]}]` | Weeztix mails the tickets to the receiver by default. Order and order-ticket GUIDs come back in the response → `guest_tickets.provider_ticket_id`. |
| Webhooks | `POST https://webhooks.weeztix.com` or the dashboard; resources × triggers table includes `ticket: Scan`, `scanner: Scan`, `order: Paid / Placed`, `event: Update`, `ticket_type: Update`, `eventdate: Update` | "Long-term support, not yet complete. Changes can and will be made." |
| Scan feedback | `ticket: Scan` (or `scanner: Scan`) webhook | Maps to `apply_ticket_scan`. |

## Assumed (to verify before Ticketing 2 ships)

1. **Webhook authentication.** The create-webhook page lists a URL and triggers, no signing secret or custom header. Design: per-connection path secret in the URL, sha256 stored. If a signature header exists, `verifyWebhook` is added on top.
2. **Scan payload.** Expected: order-ticket GUID, order GUID, scanner GUID, timestamp, direction (in/out). If only an id arrives, the route stores `needs_fetch` and a `fetch_scan` job reads the scan.
3. **Zero-price order.** `paymentProvider` must be a method that completes a €0 order without a redirect. Resolved at link time from `/shop/:shopGUID/payment_methods` and stored in `provider_meta.paymentProviderGuid`. A dedicated complimentary endpoint would replace the reserve-then-order dance.
4. **Shop per event.** Either the venue creates a "PlusOne guest list" shop containing the guest ticket types (documented onboarding step), or the adapter creates one through `POST /shop`.
5. **OAuth.** Redirect URI `https://app.plus-one.io/api/ticketing/weeztix/callback`; local dev uses the stub adapter unless a sandbox exists.
6. **Rate limits.** Unknown. The worker paces at `TICKETING_ISSUE_RPS` (default 2 orders/s) until confirmed.

## Capabilities declared by the adapter

```ts
{ events: true, ticketTypes: true, issueTickets: true, cancelTickets: true /* verify */, scanWebhook: true, scanPolling: false, webhookSignature: 'path-secret' /* 'hmac' once verified */ }
```

## Sources

- https://docs.weeztix.com/docs/ (process overview, authentication, events, tickets, shops, orders)
- https://docs.weeztix.com/docs/webhooks/overview/ and https://docs.weeztix.com/docs/webhooks/create-webhook/ (resources × triggers)
- https://docs.weeztix.com/api/dashboard/get-events/ (dashboard API reference)
