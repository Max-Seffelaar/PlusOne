/**
 * The pgTAP plan/run gate (86eykjgrb) is only worth having where it actually
 * runs. `scripts/db-test.mjs` wraps `supabase test db` and turns pgTAP's
 * plan/run drift — and a run that executed nothing — into a red build; bare
 * `supabase test db` does neither.
 *
 * When the gate landed it was wired into CI and `pnpm db:test` and nowhere else,
 * so every documented human workflow still bypassed it — including CLAUDE.md's
 * prod-push flow, which is the LAST verification before a schema reaches the one
 * prod project (there is no staging behind it). A gate absent from the path the
 * schema actually travels is the same failure it was built to prevent.
 *
 * This guard keeps that sweep from silently rotting. The rule: a live instruction
 * doc may name the bare command only on a line that also points at the wrapper —
 * so an explanation ("`pnpm db:test` = `supabase test db` + the gate") is fine and
 * a fresh `run: supabase test db` instruction is not.
 *
 * Historical records are deliberately out of scope: docs/changelog.md,
 * docs/security-audit.md and docs/plan-*.md report what past runs did, and
 * rewriting them would falsify the record.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoFile = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

// Docs that tell a human or an agent what to run *now*.
const LIVE_INSTRUCTION_DOCS = [
  'CLAUDE.md',
  'README.md',
  'docs/ARCHITECTURE.md',
  'bouwplan-claude-code.md',
  'launchplan-claude-code.md',
];

describe('the gate is on the path the schema actually travels', () => {
  it.each(LIVE_INSTRUCTION_DOCS)('%s never instructs a bare `supabase test db`', (doc) => {
    const offenders = repoFile(doc)
      .split('\n')
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => line.includes('supabase test db') && !line.includes('pnpm db:test'));

    expect(offenders).toEqual([]);
  });

  it('CLAUDE.md prod-push flow runs the wrapper before `supabase db push`', () => {
    const claude = repoFile('CLAUDE.md');
    const step2 = claude.slice(claude.indexOf('**Prod-push flow**')).split('\n')[2];

    expect(step2).toContain('pnpm db:test');
  });

  it('`pnpm db:test` and CI both point at the wrapper', () => {
    expect(JSON.parse(repoFile('package.json')).scripts['db:test']).toBe('node scripts/db-test.mjs');
    expect(repoFile('.github/workflows/ci.yml')).toContain('run: node scripts/db-test.mjs');
  });
});
