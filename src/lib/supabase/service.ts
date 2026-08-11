import 'server-only';

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';

/**
 * Checked eagerly, as the function's first statement — not via the old `!`
 * assertions, which are compile-time-only and let a missing var flow through
 * as `undefined` at runtime. That surfaced as an opaque error from whatever
 * Supabase network call happened to run first, in whatever route reached it
 * first, possibly hours after the env actually broke. This throws immediately
 * and by name instead, before any network call is attempted.
 *
 * Deliberately not a module-top-level check: several tests (e.g.
 * stripe-webhook.test.ts's `mapStripeEvent` cases) import modules that pull
 * this one in transitively without ever calling createServiceClient() — a
 * top-level throw broke that import path even though the client was never
 * needed, which module-load timing shouldn't do.
 */
export const createServiceClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — the service-role client cannot be created.'
    );
  }
  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};
