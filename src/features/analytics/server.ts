import 'server-only';

/**
 * Server-side product analytics (plan §8): exactly two events are captured here,
 * where the client is mid-redirect and would lose them — `user_signed_up` (first
 * consent write) and `venue_created`. Everything else is client-side.
 *
 * Rules:
 *  - Same typed catalog as the client (events.ts): ids, enums, counts only.
 *  - No key (`POSTHOG_KEY`) = no-op, and posthog-node is never even loaded.
 *  - The caller's own in-app opt-out is honoured: read through `my_profile()`
 *    on the user-scoped client; any doubt (error, missing row, missing column
 *    before the prod push) = not sent.
 *  - Vercel freezes the lambda after the response, so nothing is buffered:
 *    `captureImmediate` + `shutdown`, bounded by a timeout. Never throws —
 *    analytics must never fail a server action.
 *  - The server talks to PostHog EU directly (`POSTHOG_HOST`), not via /ingest.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type { AnalyticsEvent } from './events';
import { toCapture } from './events';

const SERVER_KEY = (): string => (process.env.POSTHOG_KEY ?? '').trim();
const SERVER_HOST = (): string => (process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com').trim();
const TIMEOUT_MS = 2000;

export function serverAnalyticsConfigured(): boolean {
  return SERVER_KEY().length > 0;
}

/** Whether the signed-in caller opted out. Fails closed (true) on any doubt. */
export async function callerOptedOut(supabase: SupabaseClient<Database>, userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .rpc('my_profile')
      .select('analytics_opt_out_at')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) return true;
    return data.analytics_opt_out_at !== null;
  } catch {
    return true;
  }
}

/**
 * Send one event for `userId` (the Supabase user UUID = PostHog distinct id).
 * The caller decides opt-out first (see `captureServerEvent` below for the
 * common path); this function only sends.
 */
export async function sendServerEvent(userId: string, event: AnalyticsEvent): Promise<void> {
  if (!serverAnalyticsConfigured()) return;
  try {
    const { PostHog } = await import('posthog-node');
    const client = new PostHog(SERVER_KEY(), {
      host: SERVER_HOST(),
      flushAt: 1,
      flushInterval: 0,
      disableGeoip: true,
    });
    const { name, props } = toCapture(event);
    const send = client.captureImmediate({ distinctId: userId, event: name, properties: props });
    await Promise.race([send, new Promise((r) => setTimeout(r, TIMEOUT_MS))]);
    await client.shutdown(TIMEOUT_MS).catch(() => undefined);
  } catch {
    // never fail the action over analytics; no details to the log (no PII anyway)
  }
}

/** Opt-out check + send, for a server action holding the user-scoped client. */
export async function captureServerEvent(
  supabase: SupabaseClient<Database>,
  userId: string,
  event: AnalyticsEvent,
): Promise<void> {
  if (!serverAnalyticsConfigured()) return;
  if (await callerOptedOut(supabase, userId)) return;
  await sendServerEvent(userId, event);
}
