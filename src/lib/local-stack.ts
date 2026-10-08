import 'server-only';

/**
 * True only for a non-production build running against the LOCAL Supabase
 * stack. The one gate for local-only conveniences that must never work on a
 * hosted deploy: the service-role dev-login route and the stub mailer's
 * hand-off to the stack's Mailpit (which receives sign-in links).
 *
 * Hostname equality, never a substring match on the whole URL: `localhost`
 * anywhere in the string also matches a real host like
 * `https://localhost.attacker.dev` or `https://x.127.0.0.1.nip.io`. Prod is
 * still covered by the NODE_ENV conjunct, but any non-prod deploy running
 * `next dev` would otherwise hand these paths a live host.
 */
export function onLocalDevStack(): boolean {
  let onLocalSupabase = false;
  try {
    const { hostname } = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
    onLocalSupabase = hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    onLocalSupabase = false; // unset or unparseable: not local
  }
  return process.env.NODE_ENV !== 'production' && onLocalSupabase;
}
