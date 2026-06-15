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

const DEVICE_KEY = 'plusone-device-id';

export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'server';
  let id = window.localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = uuidv7();
    window.localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

let cached: SupabaseClient<Database> | null = null;

export function getDoorClient(): SupabaseClient<Database> {
  if (cached) return cached;
  cached = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { 'x-device-id': getDeviceId() } } },
  );
  return cached;
}
