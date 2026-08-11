import { NextResponse } from 'next/server';
import { createHealthClient } from '@/lib/supabase/health-client';

// Uptime-monitor target (Prod-ready 9/7 — 09). Public route (middleware exempts
// /api/health) — a doorhost's Friday-night outage must page Max, not wait for
// someone to notice at the door. Round-trips the database so a hung Postgres
// connection (not just a running Next.js process) trips the alert. Uses the
// anon key, not the service role (86ey9ea00 #55) — see health-client.ts.
//
// Queries `request_links`, the one table where `anon` holds a genuine
// GRANT SELECT (`20260706103000_submit_via_request_link.sql:426`) with NO RLS
// policy for the anon role at all (`request_links_select` is `for select to
// authenticated` only, `20260706100000_influencers_request_links.sql`). That
// combination is exactly what a probe needs: the ACL grant means the query
// never 42501's, and the policy-less RLS means it always returns zero rows —
// proving the round-trip without ever touching real data.
//
// `venues` does NOT work here — anon has no grant on it at all. Neither does
// `events`: anon briefly had table-level SELECT there, but
// `20260707170000_p0_security_hotfixes.sql` (C3) revoked it after
// `events_select_landing` turned out to let anon list every tenant's active
// events; landing-page reads now go through the SECURITY DEFINER
// `get_landing_event` RPC instead. Before pointing this probe at any other
// table, grep ALL migrations for that table's anon grants/revokes AND its RLS
// policies — a grant from one migration can be revoked by a later one.
export async function GET() {
  try {
    const supabase = createHealthClient();
    const { error } = await supabase
      .from('request_links')
      .select('id', { head: true, count: 'exact' })
      .limit(1);
    if (error) throw error;
    return NextResponse.json({ status: 'ok' });
  } catch {
    return NextResponse.json({ status: 'error' }, { status: 503 });
  }
}
