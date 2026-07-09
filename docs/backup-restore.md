# Backup & Restore — procedure + drill log

_"An untested backup is hope, not a plan."_ This doc covers what backups exist, how
to **prove** they restore (the drill), and how to actually restore in an incident.

## What we have (2026-07-09)

- **Supabase Pro**, project `tolxwgqhppdcvnogdpel`, region `eu-west-1` (Ireland).
- **Automated daily backups, 7-day retention** (included in Pro). Visible in
  Dashboard → **Database → Backups → Scheduled backups**.
- **PITR: intentionally OFF.** ~$100/mo for 7-day point-in-time recovery. Parked
  until **≥25 paying venues** — at a handful of pilots, "lose up to a day" is
  acceptable and daily backups cover it. Revisit at the ≥25 milestone.
- One project, no staging (by decision). Risky data migrations are rehearsed
  against a **restored copy on demand**, not a permanent staging env.

---

## The restore drill

Run this **at least once now**, and again after any change to the DB topology
(new extensions, roles, big migrations). Two methods — prefer A; B is the
always-available fallback.

### Method A — "Restore to a New Project" (preferred, zero prod risk)

Clones the actual daily backup artifact into a **brand-new** project. The source
project (prod) is never touched. The clone inherits prod's compute size, so it
**costs money while it runs** — spin up, verify, **delete immediately**.

1. Supabase Dashboard → prod project `tolxwgqhppdcvnogdpel` → **Database → Backups**.
2. Open the **"Restore to a new project"** tab.
   - If the tab is missing or disabled, this feature isn't available for daily
     backups on this project → use **Method B** instead.
3. Pick the most recent daily backup → **Restore**. Review the cost estimate,
   confirm. A new project provisions (a few minutes).
4. Wait until the new project is **healthy**, then open its **SQL Editor**.
5. Run the **verification block** below in the clone's SQL Editor.
6. Run the same **count query** against **prod** (read-only SELECT — safe) and
   compare. Clone counts should match prod at backup time (minus any writes since).
7. Record the result in the **Drill log** at the bottom of this file.
8. **DELETE the clone project** (Project Settings → General → Delete project).
   Do not leave it running — it bills separately.

What transfers with a clone: schema, data, indexes, **roles**, and **auth user
data**. What does NOT transfer automatically: Storage objects, Edge Functions,
Auth provider settings, Realtime config, extensions. For a data-integrity drill
that's fine — we're proving the *data* is recoverable.

### Method B — logical dump → scratch project (always available)

Proves the recovery path end-to-end with no prod risk and no compute surprise.
Run from the **linked main checkout** (`…/PlusOne Guestlist`), never a worktree.

1. Create a fresh **scratch Supabase project** (free tier is fine), same region
   `eu-west-1`. Note its connection string (Project Settings → Database).
2. Dump prod (schema + data + roles):
   ```bash
   # from the linked main checkout, which is `supabase link`-ed to prod
   supabase db dump --linked -f drill-schema.sql          # schema + roles
   supabase db dump --linked --data-only -f drill-data.sql # data
   ```
3. Load into the scratch project:
   ```bash
   psql "<scratch-project-connection-string>" -f drill-schema.sql
   psql "<scratch-project-connection-string>" -f drill-data.sql
   ```
4. Run the **verification block** below against the scratch project.
5. Record the result in the **Drill log**.
6. **Delete the scratch project** and the local `drill-*.sql` files (they contain
   real guest PII — do not commit, do not keep).

> Note: a live `db dump` tests *dumpability + restorability*, not the daily-backup
> artifact itself. Method A tests the actual artifact; use B only when A is
> unavailable.

### Verification block (run against the restored copy)

```sql
-- 1. Row counts for the tables that matter. Non-zero + matching prod = good.
select 'venues'             as tbl, count(*) from public.venues
union all select 'venue_memberships', count(*) from public.venue_memberships
union all select 'events',            count(*) from public.events
union all select 'guests',            count(*) from public.guests
union all select 'check_ins',         count(*) from public.check_ins
union all select 'refusals',          count(*) from public.refusals
union all select 'guest_tiers',       count(*) from public.guest_tiers
union all select 'event_quotas',      count(*) from public.event_quotas
union all select 'subscriptions',     count(*) from public.subscriptions
union all select 'audit_log',         count(*) from public.audit_log
union all select 'auth.users',        count(*) from auth.users
order by tbl;

-- 2. RLS is still enabled on every public table (security boundary intact).
--    Expect an empty result — any row here is a table with RLS OFF.
select relname
from pg_class
where relnamespace = 'public'::regnamespace
  and relkind = 'r'
  and relrowsecurity = false
  and relname not like 'pg_%';

-- 3. Audit + quota triggers survived the restore.
--    Expect the audit triggers on guests/quotas/check_ins etc. to be present.
select tgrelid::regclass as table, tgname
from pg_trigger
where not tgisinternal
  and tgrelid::regclass::text in
    ('public.guests','public.quotas','public.event_quotas','public.guest_tiers','public.check_ins')
order by 1, 2;

-- 4. Spot-check one real event end-to-end: guests readable, +N math sane.
select e.id, e.name,
       count(g.*)                              as guests,
       coalesce(sum(1 + g.plus_ones), 0)       as slots_consumed
from public.events e
left join public.guests g
  on g.event_id = e.id and g.status <> 'removed'
group by e.id, e.name
order by guests desc
limit 5;
```

Pass criteria: counts non-zero and in line with prod; query 2 returns **no rows**;
query 3 lists the audit/quota triggers; query 4 shows readable guest data with
`slots_consumed ≥ guests`.

---

## Real incident: restoring prod

⚠️ **The "Restore" button on a scheduled backup restores IN-PLACE — it overwrites
the current prod database and causes downtime.** Only do this when prod data is
actually lost/corrupted and you accept rolling back to the backup point. See
[runbook.md](runbook.md) for the decision flow first.

1. Dashboard → prod → **Database → Backups → Scheduled backups**.
2. Pick the backup point **just before** the corruption.
3. Confirm. Prod goes into restore (downtime scales with DB size).
4. After restore: re-check the app, run the **verification block** against prod,
   and note that any writes **after** the backup point are gone — communicate the
   data-loss window to affected pilot venues.

For finer-grained recovery you'd need **PITR** (currently off — see above).

---

## Drill log

Append newest first. One line per drill: date · method · result · who.

- **2026-07-09 · Method A (Restore to new project, BETA) · backup 2026-07-09 00:48 UTC ·
  PASS** — clone provisioned clean; counts intact (5 venues / 8 events / 18 guests /
  10 auth.users / 5 subscriptions / 75 audit_log rows); **RLS enabled on every public
  table** (query 2 empty); full audit + quota trigger stack present in the clone
  (`audit_guests`/`audit_check_ins`/`audit_quotas`/… + `enforce_guest_quota`,
  `enforce_event_capacity`, `check_ins_cap_arrivals`, `guard_guest_attribution`);
  +N math correct on spot-check. Clone deleted right after. · Max + Claude
