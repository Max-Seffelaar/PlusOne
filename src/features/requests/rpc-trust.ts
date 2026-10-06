import 'server-only';

/** The request header consume_public_throttle reads (20261006170000). */
export const PUBLIC_RPC_TRUST_HEADER = 'x-plusone-throttle-trust';

/**
 * Headers for a Supabase client that calls the anon throttled RPCs
 * (get_landing_event, record_link_pageview, submit_guest_request,
 * get_request_status, get_influencer_stats).
 *
 * The RPCs throttle on a caller-supplied p_ip_hash. Once the DB holds the sha256
 * of PUBLIC_RPC_TRUST_SECRET (public_throttle_trusted_callers), it honours that
 * hash only for a request that presents the secret — i.e. this server. Anyone
 * else calling PostgREST directly lands in one shared bucket per surface, so
 * rotating p_ip_hash no longer buys a fresh budget.
 *
 * Unset: no header. The DB ignores the header until a secret row exists, so
 * local dev/CI behave as before; in production the build guard
 * (scripts/hooks/lib/required-env.mjs) refuses to build without it, because
 * with enforcement on, a missing header would put every guest in one bucket.
 * Server-only — never log it, never send it to the browser.
 */
export function publicRpcTrustHeaders(): Record<string, string> | undefined {
  const secret = process.env.PUBLIC_RPC_TRUST_SECRET?.trim();
  return secret ? { [PUBLIC_RPC_TRUST_HEADER]: secret } : undefined;
}
