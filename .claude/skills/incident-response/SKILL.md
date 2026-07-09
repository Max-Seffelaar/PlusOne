---
name: incident-response
description: Lead triage of a production incident on the Gastenlijst SaaS (PlusOne). Trigger this whenever Max reports something broken in production — "prod is down", "errors in prod", "guests can't check in", "the app is broken", "site is down", "getting 500s", "login is broken", "webhook failing" — or anything else that reads as a live prod problem rather than a local dev bug. Reads docs/runbook.md first, then pulls whatever live diagnostics are actually available (Sentry, Vercel, Supabase) and drives the diagnosis to a recommended first action. Don't wait to be told to "check the runbook" — that's what this skill is for.
---

# Incident response

Max runs this alone at odd hours. The job here is to compress "something's broken" into
a concrete triage summary fast, using the runbook as the map and live data to confirm
or rule out theories — not to replace judgment.

## Steps

1. **Read [`docs/runbook.md`](../../../docs/runbook.md) in full before doing anything else.**
   It has the triage table (symptom → check → fix), the "rollback first, diagnose later"
   default, and the key facts table (Vercel project, Supabase ref, region). Don't
   paraphrase this skill's own copy of that table — read the live file, since it can
   change independently of this skill.

2. **Match what Max described to a row in the triage table.** That tells you where to
   look next. Then pull real data instead of guessing:

   - **Sentry** — check whether Sentry MCP tools are available in this session (they
     show up as `mcp__*sentry*` tools, e.g. `search_issues`, `search_events`,
     `analyze_issue_with_seer`). They need an org slug (and sometimes a region URL)
     before they're useful — call `find_organizations`/`find_projects` first if you
     don't already have those from context, rather than guessing at
     `organizationSlug`. Use them to find recent/unresolved issues and pull a stack
     trace or Seer root-cause for the top one. If the Sentry MCP isn't connected or
     errors with an auth failure, fall back to the `sentry-cli` skill (`sentry issue
     list`, `sentry issue explain`) — don't just give up on Sentry data because the
     first path failed.
   - **Vercel** — check for `mcp__*` tools tied to a Vercel connector first (none was
     installed as of writing, but connectors get added between sessions — don't
     assume). If there isn't one, fall back to the `vercel` CLI: confirm it's actually
     usable first (`vercel whoami`) before relying on it — an unauthenticated or
     unlinked CLI fails silently-ish and you don't want to mistake "command errored"
     for "nothing's wrong". Working CLI → `vercel ls`/`vercel inspect`/`vercel logs` on
     the `plus-one` project (see the runbook's key-facts table) for recent deploys.
     Neither available → tell Max to check the Vercel dashboard instead.
   - **Supabase** — check for Supabase MCP tools (`mcp__*supabase*`, e.g. `get_logs`,
     `get_project`, `list_tables`, `execute_sql`, `get_advisors`). If connected, use
     `get_logs` (service: `api`/`postgres`/`auth`/etc.) against the project ref from
     the runbook's key-facts table for the last 24h, and `get_advisors` for
     security/performance flags — much faster than guessing which table to query. If
     the MCP isn't there, fall back the same way as Vercel: `supabase` CLI if linked
     (`supabase projects list` to check, then `supabase db query --linked`), else
     point Max at Supabase Studio (Database health / Logs / Auth logs).

   None of this tool availability is fixed — it changes as connectors get added or
   authorized between sessions. Always check what's actually there this run rather
   than trusting what a past run (or this skill's wording) assumed.

3. **Lead the diagnosis, don't just dump data.** Synthesize what the runbook says with
   whatever you found into a short triage summary:
   - What's broken, and how confident you are why (cite what you actually found —
     a specific Sentry issue, a specific deploy, a specific log line).
   - Whether this is affecting a live door mid-event (P1, but the door PWA is
     offline-tolerant — never tell staff to stop scanning) or something less urgent.
   - The recommended first action. Per the runbook, that's almost always **roll back
     the last deploy before debugging further**, unless the evidence clearly points
     elsewhere (e.g. a Supabase outage no deploy caused).
   - Who to inform, straight from the runbook's "Who to inform" section — don't
     invent an escalation process, there isn't one beyond that.

   If every source you checked comes back clean — no unresolved Sentry issues, prod
   deploy healthy, Supabase healthy, no 500s reproduced — say exactly that instead of
   forcing a root cause. Don't recommend a rollback with nothing to roll back from.
   Report what you checked and what it showed, and ask Max for a sharper repro (exact
   URL, action taken, screenshot, timestamp) — that's a legitimate and common outcome
   of triage, not a failure to find something.

Keep the summary tight enough to act on in the first 60 seconds, matching the
runbook's own framing — this skill exists to get Max from "something's wrong" to
"here's the first thing to do" as fast as possible, not to write an incident report.
