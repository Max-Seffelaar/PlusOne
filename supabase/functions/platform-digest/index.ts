// platform-digest — Supabase Edge Function entry (Deno). All logic lives in
// digest.ts so the unit suite can run it under Node/vitest; see that file's
// header for the contract and docs/mail-deliverability.md ("Platform digest")
// for deploy + secrets.
//
// Deployed with verify_jwt = false (supabase/config.toml), like push-dispatch:
// the only caller is pg_net (platform_digest_tick, daily via pg_cron), which
// holds no user JWT, and the public anon key would pass a gateway JWT check
// anyway. The real gate is the single-use token consumed inside
// platform_digest_begin() before anything is read.
//
// Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected by the Edge
// runtime (server-side only; the digest RPCs are granted to service_role
// alone). RESEND_API_KEY + APP_URL are Edge Function secrets Max sets;
// PLATFORM_DIGEST_MAIL_CATCHER_URL is for the local stack only.

import { handleDigest } from './digest.ts';

// Minimal ambient declaration so the repo-wide `tsc --noEmit` can check this
// file without Deno's lib types.
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): unknown;
};

Deno.serve((req) =>
  handleDigest(req, {
    env: {
      SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      RESEND_API_KEY: Deno.env.get('RESEND_API_KEY'),
      APP_URL: Deno.env.get('APP_URL'),
      PLATFORM_DIGEST_MAIL_CATCHER_URL: Deno.env.get('PLATFORM_DIGEST_MAIL_CATCHER_URL'),
    },
    fetch,
  })
);
