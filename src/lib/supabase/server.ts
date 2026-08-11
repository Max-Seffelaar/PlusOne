import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '../database.types';
import { AUTH_COOKIE_MAX_AGE } from './cookie-options';
import { requiredServerEnv } from '../env';

/**
 * @param options.headers Extra HTTP headers forwarded on every request this
 *   client makes to Supabase. Used by the dev-login route to pass the browser's
 *   real `User-Agent` through to GoTrue so the created session records a usable
 *   device label (a server-side verifyOtp otherwise stamps the Node UA). Normal
 *   callers omit this.
 */
export const createClient = async (options?: { headers?: Record<string, string> }) => {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    requiredServerEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredServerEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      // Persist the session across browser restarts (ClickUp "30 dagen onthouden").
      cookieOptions: { maxAge: AUTH_COOKIE_MAX_AGE },
      ...(options?.headers ? { global: { headers: options.headers } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: Array<{
            name: string;
            value: string;
            options: CookieOptions;
          }>
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  );
};
