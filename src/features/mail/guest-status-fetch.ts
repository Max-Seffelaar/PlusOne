import 'server-only';

// Server-side read for the public guest status page and its .ics
// (Gastcommunicatie F, z8uq9m2vpy). The /r/[token] pattern: only the sha256
// of the bearer token reaches the database, through the anon RPC on a client
// that carries the throttle trust header, with this server's salted IP hash.

import { createHash } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { landingClientIpHash } from '@/features/requests/ip-hash';
import { publicRpcTrustHeaders } from '@/features/requests/rpc-trust';
import { toGuestStatusView, type GuestStatusView } from './guest-status-view';

/** Tokens are 43 base64url characters; anything else is not-found before any I/O. */
export const STATUS_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function loadGuestStatus(token: string): Promise<GuestStatusView | null> {
  if (!STATUS_TOKEN.test(token)) return null;
  const supabase = await createClient({ headers: publicRpcTrustHeaders() });
  const { data } = await supabase.rpc('get_guest_status', {
    p_token_hash: tokenHash(token),
    p_ip_hash: await landingClientIpHash(),
  });
  return toGuestStatusView(data);
}
