/**
 * Production env-var build guard (86eyp5w32).
 *
 * Sentry was wired into this repo correctly and still reported nothing for
 * months: the build-time half ran on every deploy (`_sentryDebugIds` and
 * `SENTRY_RELEASE` are in the shipped production bundle, so the webpack plugin
 * had a real SENTRY_AUTH_TOKEN), while `sentry.*.config.ts` initialised with
 * `enabled: Boolean(dsn)` — so a missing NEXT_PUBLIC_SENTRY_DSN switched the
 * runtime half off in silence. Green deploy, source maps uploaded, zero events
 * in 90 days.
 *
 * Two guards here: behavioural tests on the pure predicate, plus a structural
 * test proving `pnpm build` still invokes the runner — a guard nobody calls is
 * exactly the failure mode that produced this task (`idbClearAll()` shipped
 * with zero call sites and a comment claiming otherwise, 86ey9et07).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PROD_REQUIRED_ENV,
  findMissingProdEnv,
  formatMissingEnvReport,
  isVercelProductionBuild,
} from '../../scripts/hooks/lib/required-env.mjs';

const ROOT = process.cwd();

type EnvVar = { name: string; why: string };

const FULL_PROD_ENV: Record<string, string> = Object.fromEntries(
  (PROD_REQUIRED_ENV as EnvVar[]).map((v) => [v.name, 'set']),
);

describe('isVercelProductionBuild', () => {
  it('is true only for VERCEL_ENV=production', () => {
    expect(isVercelProductionBuild({ VERCEL_ENV: 'production' })).toBe(true);
  });

  it('is false for preview deploys', () => {
    expect(isVercelProductionBuild({ VERCEL_ENV: 'preview' })).toBe(false);
  });

  it('is false for a local or CI build, even with NODE_ENV=production', () => {
    // The whole point of keying on VERCEL_ENV: Next sets NODE_ENV=production
    // for `pnpm build` everywhere, so a NODE_ENV gate would fail every
    // contributor's build and every CI run.
    expect(isVercelProductionBuild({ NODE_ENV: 'production' })).toBe(false);
    expect(isVercelProductionBuild({})).toBe(false);
  });
});

describe('findMissingProdEnv', () => {
  it('reports nothing when every required var is set', () => {
    expect(findMissingProdEnv(FULL_PROD_ENV)).toEqual([]);
  });

  it('catches the exact gap that made production run blind', () => {
    const env = { ...FULL_PROD_ENV };
    delete env.NEXT_PUBLIC_SENTRY_DSN;
    const missing = findMissingProdEnv(env) as EnvVar[];
    expect(missing.map((v) => v.name)).toEqual(['NEXT_PUBLIC_SENTRY_DSN']);
  });

  it('catches the salt whose absence 500s /e/[slug]', () => {
    const env = { ...FULL_PROD_ENV };
    delete env.LANDING_IP_SALT;
    const missing = findMissingProdEnv(env) as EnvVar[];
    expect(missing.map((v) => v.name)).toEqual(['LANDING_IP_SALT']);
  });

  it('treats an empty or whitespace-only value as missing', () => {
    // A var "set" to '' is the same blindness as no var at all, and is a
    // realistic way to misconfigure a Vercel dashboard field.
    expect(findMissingProdEnv({ ...FULL_PROD_ENV, NEXT_PUBLIC_SENTRY_DSN: '' })).toHaveLength(1);
    expect(findMissingProdEnv({ ...FULL_PROD_ENV, NEXT_PUBLIC_SENTRY_DSN: '   ' })).toHaveLength(1);
  });

  it('reports every missing var at once, not just the first', () => {
    // One failed build should tell you everything to fix, not send you round
    // the deploy loop once per variable.
    const missing = findMissingProdEnv({}) as EnvVar[];
    expect(missing).toHaveLength((PROD_REQUIRED_ENV as EnvVar[]).length);
  });

  it('gives every required var a reason, not just a name', () => {
    for (const v of PROD_REQUIRED_ENV as EnvVar[]) {
      expect(v.why, `${v.name} needs a \`why\``).toBeTruthy();
      expect(v.why.length).toBeGreaterThan(20);
    }
  });
});

describe('formatMissingEnvReport', () => {
  it('returns null when nothing is missing, so the runner can exit 0', () => {
    expect(formatMissingEnvReport([])).toBeNull();
  });

  it('names each missing var and explains the consequence', () => {
    const report = formatMissingEnvReport(findMissingProdEnv({ ...FULL_PROD_ENV, LANDING_IP_SALT: '' }));
    expect(report).toContain('LANDING_IP_SALT');
    expect(report).toContain('/e/[slug]');
  });
});

describe('the guard is actually wired into the build', () => {
  it('pnpm build runs check-required-env before next build', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const build = pkg.scripts.build;
    expect(
      build,
      'package.json `build` must invoke scripts/hooks/check-required-env.mjs — ' +
        'a production deploy that skips this guard is exactly how Sentry ran dead for 90 days',
    ).toContain('check-required-env.mjs');
    expect(
      build.indexOf('check-required-env.mjs'),
      'the guard must run BEFORE next build, so a misconfigured deploy fails fast',
    ).toBeLessThan(build.indexOf('next build'));
  });
});
