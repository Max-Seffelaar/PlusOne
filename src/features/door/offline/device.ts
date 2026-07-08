/**
 * Per-device identity + a device-scoped Supabase browser client.
 *
 * Every door write carries a stable `device_id` (decision #25, audit §3): the
 * audit trigger reads it from the `x-device-id` request header
 * (`request_device_id()`), and check_ins/refusals also store it on the row. The
 * id is generated once (UUIDv7) and kept in localStorage so it is stable across
 * reloads on the same physical device — critical for "wie checkte in?" at a
 * shared venue device.
 *
 * The client is memoised so there is a single GoTrue/Realtime instance per tab;
 * it reads the logged-in session from the same cookies as the rest of the app.
 */
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { v7 as uuidv7 } from 'uuid';
import type { Database } from '@/lib/database.types';
import { REALTIME_EVENTS_PER_SECOND } from '@/lib/supabase/client';

const DEVICE_KEY = 'plusone-device-id';

// In-memory fallback when localStorage is unavailable (see getDeviceId). Stable
// for the life of the tab; a reload gets a fresh id, which only softens the
// "which device checked in?" audit hint — it never breaks a write.
let memoryDeviceId: string | null = null;

export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'server';
  // localStorage throws (not just returns null) when storage is blocked — Safari
  // "block all cookies", a hardened/embedded webview, private mode at quota. This
  // runs during client construction and inside effects, so an unguarded throw
  // white-screened the whole door surface (C13). Fall back to an in-memory id.
  try {
    let id = window.localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = uuidv7();
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    if (!memoryDeviceId) memoryDeviceId = uuidv7();
    return memoryDeviceId;
  }
}

let cached: SupabaseClient<Database> | null = null;

export function getDoorClient(): SupabaseClient<Database> {
  if (cached) return cached;
  cached = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { 'x-device-id': getDeviceId() } },
      // Raise the realtime throttle (default 10 ev/s drops door bursts) — #0b.
      // See REALTIME_EVENTS_PER_SECOND for the burst-test rationale.
      realtime: { params: { eventsPerSecond: REALTIME_EVENTS_PER_SECOND } },
    },
  );
  return cached;
}
