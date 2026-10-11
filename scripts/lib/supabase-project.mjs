// The local Supabase stack's container names, derived from THIS checkout's
// supabase/config.toml instead of hard-coded.
//
// Why: scripts that talk to the stack through two channels — the HTTP API
// (URL + keys from .env.local) and `docker exec` into a container — must hit the
// SAME stack. dev-mfa.mjs hard-coded `supabase_db_PlusOne_Guestlist`, so a
// worktree running its own stack (a different project_id, e.g. an isolated
// integration stack) got its API calls on its own stack but its SQL writes on
// the shared one (found 2026-10-11). The Supabase CLI names containers
// `supabase_<service>_<project_id>`, and .env.local is written from the same
// checkout's `supabase status`, so reading project_id here keeps both channels
// on one stack.
//
// SUPABASE_PROJECT_ID overrides the config (for a stack started elsewhere).

import { readFileSync } from 'node:fs';

/**
 * project_id from a supabase/config.toml body (top-level key, before any [section]).
 * @param {string} toml
 * @returns {string | null}
 */
export function parseProjectId(toml) {
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) break; // project_id is a top-level key
    const m = /^project_id\s*=\s*"([^"]+)"\s*(#.*)?$/.exec(line);
    if (m) return m[1];
  }
  return null;
}

/**
 * The project_id for the checkout that contains `configUrl` (a file URL to supabase/config.toml).
 * @param {URL} configUrl
 * @param {Record<string, string | undefined>} [env]
 */
export function supabaseProjectId(configUrl, env = process.env) {
  if (env.SUPABASE_PROJECT_ID) return env.SUPABASE_PROJECT_ID;
  const id = parseProjectId(readFileSync(configUrl, 'utf8'));
  if (!id) throw new Error(`No project_id in ${configUrl.pathname}`);
  return id;
}

/**
 * `supabase_<service>_<project_id>`, e.g. supabaseContainer('db', url) → supabase_db_PlusOne_Guestlist.
 * @param {string} service
 * @param {URL} configUrl
 * @param {Record<string, string | undefined>} [env]
 */
export function supabaseContainer(service, configUrl, env = process.env) {
  return `supabase_${service}_${supabaseProjectId(configUrl, env)}`;
}
