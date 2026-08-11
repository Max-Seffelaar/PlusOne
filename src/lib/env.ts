import 'server-only';

/**
 * Reads a required server-side env var, throwing immediately — naming the
 * var — if it's missing, instead of letting a lazy `!` assertion (compile-
 * time only) hand `undefined` to whatever's constructed next.
 *
 * Server-only: every one of these factories runs where `process.env` is the
 * real environment (Node/edge), so no build-time inlining is at stake here —
 * unlike `NEXT_PUBLIC_*` reads in a CLIENT-BUNDLED file (e.g.
 * `src/lib/supabase/client.ts`), which must stay literal `process.env.X`
 * access. Next only inlines that exact static-member-access pattern at build
 * time; routing it through a function call like this one breaks the inlining
 * and the var reads as `undefined` in the browser bundle. Never use this
 * helper from a Client Component or any module a Client Component imports.
 */
export function requiredServerEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}
