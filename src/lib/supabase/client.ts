import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '../database.types';
import { AUTH_COOKIE_MAX_AGE } from './cookie-options';

export const createClient = () => {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    // Persist the session across browser restarts (ClickUp "30 dagen onthouden").
    { cookieOptions: { maxAge: AUTH_COOKIE_MAX_AGE } }
  );
};
