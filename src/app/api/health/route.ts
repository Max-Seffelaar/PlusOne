import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

// Uptime-monitor target (Prod-ready 9/7 — 09). Public route (middleware exempts
// /api/health) — a doorhost's Friday-night outage must page Max, not wait for
// someone to notice at the door. Round-trips the database so a hung Postgres
// connection (not just a running Next.js process) trips the alert.
export async function GET() {
  try {
    const supabase = createServiceClient();
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
