// Shared logic for the production env-var guard (86eyp5w32). Pure functions
// only — no process/fs access — so they stay unit-testable without faking a
// real Vercel build (see tests/unit/required-prod-env.test.ts).
//
// Why this exists at BUILD time and not at boot:
//
// Sentry was wired into this repo correctly and still reported nothing for
// months. The build-time half worked on every deploy (`_sentryDebugIds` and
// `SENTRY_RELEASE` are in the shipped bundle, so the webpack plugin ran with a
// real SENTRY_AUTH_TOKEN), but `sentry.*.config.ts` initialises with
// `enabled: Boolean(dsn)` — so a missing NEXT_PUBLIC_SENTRY_DSN turned the
// runtime half off silently. Green deploy, source maps uploaded, zero events.
// The Vercel marketplace integration injects SENTRY_ORG/SENTRY_PROJECT/
// SENTRY_AUTH_TOKEN but NOT the DSN under this app's variable name, so nothing
// ever pointed at the gap.
//
// Throwing at runtime boot instead would be worse than the disease: a
// misconfigured monitoring var would take the door offline, and the door is the
// one surface that must keep working (CLAUDE.md: door speed, offline-tolerant
// check-in). Failing the BUILD keeps the loudness without ever risking a live
// venue — a bad deploy never becomes a running deploy.

/**
 * Vars that must be present for a Vercel PRODUCTION build. Each entry carries
 * the failure mode it prevents, because a guard that only prints a name teaches
 * the next person nothing about why it matters.
 */
export const PROD_REQUIRED_ENV = [
  {
    name: 'NEXT_PUBLIC_SENTRY_DSN',
    why: 'Sentry initialises with `enabled: Boolean(dsn)` — without it error monitoring is silently off and production runs blind (86eyp5w32).',
  },
  {
    name: 'LANDING_IP_SALT',
    why: 'landingIpSalt() throws in production without it, so every visit to /e/[slug] 500s — but only once a guest actually tries to sign up (86ey9e9my, 86eykdzf1).',
  },
  {
    name: 'NEXT_PUBLIC_SUPABASE_URL',
    why: 'Every data read and write goes through this client; the app is non-functional without it.',
  },
  {
    name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    why: 'Every data read and write goes through this client; the app is non-functional without it.',
  },
];

/**
 * True only for a Vercel PRODUCTION build.
 *
 * Deliberately keyed on VERCEL_ENV, never NODE_ENV: Next sets NODE_ENV to
 * 'production' for preview deploys AND for a plain local `pnpm build`, so
 * gating on it would fail every contributor's build and every CI run. That
 * exact conflation is what made the /e/[slug] incident ambiguous for weeks —
 * "it must have been throwing on preview too" was never verifiable.
 *
 * Preview deliberately stays unguarded: a preview without a DSN is a smaller
 * problem than a preview that refuses to build, and previews are where you
 * often WANT to deploy before every var is wired up.
 */
export function isVercelProductionBuild(env) {
  return env.VERCEL_ENV === 'production';
}

/** The required vars missing (unset or empty) from `env`. Empty string counts as missing — an env var set to '' is the same blindness as no var at all. */
export function findMissingProdEnv(env, required = PROD_REQUIRED_ENV) {
  return required.filter((v) => {
    const value = env[v.name];
    return value === undefined || value === null || String(value).trim() === '';
  });
}

/** Human-readable failure report for the runner. Returns null when there is nothing to report. */
export function formatMissingEnvReport(missing) {
  if (missing.length === 0) return null;
  const lines = [
    '',
    '  Production build blocked — required environment variables are missing:',
    '',
  ];
  for (const v of missing) {
    lines.push(`  ✗ ${v.name}`);
    lines.push(`      ${v.why}`);
    lines.push('');
  }
  lines.push('  Set them in the Vercel project (Settings → Environment Variables,');
  lines.push('  scope: Production), then redeploy. This guard runs only for');
  lines.push('  VERCEL_ENV=production — local and CI builds are unaffected.');
  lines.push('');
  return lines.join('\n');
}
