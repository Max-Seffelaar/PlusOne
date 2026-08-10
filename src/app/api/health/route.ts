import { NextResponse } from 'next/server';
import { createHealthClient } from '@/lib/supabase/health-client';

// Uptime-monitor target (Prod-ready 9/7 — 09). Public route (middleware exempts
// /api/health) — a doorhost's Friday-night outage must page Max, not wait for
// someone to notice at the door. Round-trips the database so a hung Postgres
// connection (not just a running Next.js process) trips the alert. Uses the
// anon key, not the service role (86ey9ea00 #55) — see health-client.ts.
export async function GET() {
  try {
    const supabase = createHealthClient();
    const { error } = await supabase
      .from('venues')
      .select('id', { head: true, count: 'exact' })
      .limit(1);
    if (error) throw error;
    return NextResponse.json({ status: 'ok' });
  } catch {
    return NextResponse.json({ status: 'error' }, { status: 503 });
  }
}
