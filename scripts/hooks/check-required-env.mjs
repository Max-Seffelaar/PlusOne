#!/usr/bin/env node
// Build guard: fails a Vercel PRODUCTION build when a required env var is
// missing, so a deploy that would run blind never becomes a running deploy
// (86eyp5w32). Rationale and the choice of build-time over boot-time live in
// ./lib/required-env.mjs.
//
// Wired as the first half of `pnpm build`. Local and CI builds are untouched:
// the guard no-ops unless VERCEL_ENV=production.
import {
  PROD_REQUIRED_ENV,
  findMissingProdEnv,
  formatMissingEnvReport,
  isVercelProductionBuild,
} from './lib/required-env.mjs';

function main() {
  if (!isVercelProductionBuild(process.env)) return 0;

  const missing = findMissingProdEnv(process.env, PROD_REQUIRED_ENV);
  const report = formatMissingEnvReport(missing);
  if (!report) return 0;

  process.stderr.write(report);
  return 1;
}

process.exit(main());
