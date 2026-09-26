# Screenshot shot-list

Plan decision 10: screenshots for **iPhone 6.7"**, **iPad 13"** and **Android phone**. Max takes these after T1 (tablet layouts, 641–1023px) ships — a screen shot before T1 will show broken/unfinished tablet layout on the iPad set.

For each device class, capture the same five screens so the three listings stay visually consistent. Use a seed/demo venue with realistic-looking data (no real guest PII) — the local seed (`pnpm supabase:start`) or the S3 demo-tenant once it exists.

1. **Home** (`/app`, Home tab) — upcoming events list, quota chip. Shows the app's home base at a glance.
2. **Guest list** (`/app`, an event's guest list) — mixed tiers (VIP/Artist/Guest chips), some checked-in/dimmed, +N badges visible. This is the core "gastenlijst" sell.
3. **Door / check-in** (`/app`, Deur tab, `door.tsx`) — the Onderweg/Ingecheckt toggle, live counters, a check-in bottom-sheet with the stepper mid-action if it frames well statically. This sells the door-speed story.
4. **Requests** (`/app`, Aanvragen tab, `approvals.tsx`) — a guest request and a quota request both visible, Approve/Decline in view. Sells the approvals flow.
5. **Event detail or Stats** (`stats.tsx` or an event's overview) — attendance bar, onderweg/binnen split. Sells "you'll actually know what's happening."

Do not screenshot: Settings, Platform tab (internal/admin-only, not a customer-facing sell), Billing (native shell hides it anyway — Apple IAP).

## Per-device notes

- **iPhone 6.7"** (e.g. iPhone 15 Pro Max simulator/device): portrait only, matches the phone bottom-tab layout.
- **iPad 13"** (e.g. iPad Pro 13" simulator/device): capture at least one screen in landscape (Door or Guest list) to show the tablet-specific layout isn't just a stretched phone view — T1 explicitly targets portrait + landscape.
- **Android phone**: same five screens as iPhone, Play Console wants a minimum of 2 and recommends 4–8 per device class.

## Status

Not yet captured — this file is the shot-list only. Blocked on T1 landing (tablet layouts) per the dependency above.
