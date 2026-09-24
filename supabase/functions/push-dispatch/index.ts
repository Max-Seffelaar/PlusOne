// push-dispatch — Supabase Edge Function entry (Deno). All logic lives in
// dispatch.ts so the unit suite can run it under Node/vitest; see that file's
// header for the contract and docs/push-dispatch.md for deploy + secrets.
//
// Deployed with verify_jwt = false (supabase/config.toml): the only caller is
// pg_net (and the pg_cron sweep through it), which holds no user JWT. A
// gateway JWT check would add nothing here — the public anon key passes it —
// so the real gate is the single-use token pg_net sends with each kick,
// consumed inside claim_push_outbox() before a single row is touched.
//
// Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected by the Edge
// runtime (server-side only — this is the documented service_role use: the
// outbox RPCs are granted to service_role alone). FCM_SERVICE_ACCOUNT_JSON +
// FCM_PROJECT_ID are the Edge Function secrets Max sets; nothing else is read.

import { handleDispatch } from './dispatch.ts';

// Minimal ambient declaration so the repo-wide `tsc --noEmit` can check this
// file without Deno's lib types.
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): unknown;
};

Deno.serve((req) =>
  handleDispatch(req, {
    env: {
      SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      FCM_SERVICE_ACCOUNT_JSON: Deno.env.get('FCM_SERVICE_ACCOUNT_JSON'),
      FCM_PROJECT_ID: Deno.env.get('FCM_PROJECT_ID'),
    },
    fetch,
  })
);
