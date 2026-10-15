// Decision half of `node scripts/linear-auto-done.mjs` (PLU-125), split out so it
// can be unit-tested without a network, GitHub or Linear — see
// tests/unit/linear-auto-done.test.ts. Nothing here does I/O: the runner gathers
// the merged PR's title, body and changed files, planAutoDone() decides, the
// runner talks to Linear.
//
// The rule it encodes (Max, 2026-10-15): the merged-AND-tested gate stays, but
// Max never moves an issue to Done by hand.
//   - `Test: auto` — CI plus the review gates ARE the test. The issue goes to Done
//     at merge, unless the PR carries a migration: there is no staging, so schema
//     work is only tested once it reached prod (CLAUDE.md "Prod-push flow").
//   - `Test: Max`  — the per-screen handoff has questions only Max can answer. The
//     issue stays in Merged - Testen and is assigned to Max, so his "My issues"
//     view is the test queue; the session he answers in sets Done.
//   - no Test line — treated as `Test: Max`. Forgetting the line must never skip
//     the gate.

// Keys come from the PR title and from `Linear: PLU-123` lines only — never from
// free text in the body, which routinely names related issues that this PR does
// not finish.
const TITLE_KEY_RE = /\b(PLU-\d+)\b/gi;
const LINEAR_LINE_RE = /^\s*Linear:\s*(.+)$/gim;
const TEST_LINE_RE = /^\s*\**Test\**:\s*\**\s*(auto|max)\b/im;
const MIGRATION_PATH = 'supabase/migrations/';

export function issueKeys(title = '', body = '') {
  const keys = new Set();
  for (const m of title.matchAll(TITLE_KEY_RE)) keys.add(m[1].toUpperCase());
  for (const line of body.matchAll(LINEAR_LINE_RE)) {
    for (const m of line[1].matchAll(TITLE_KEY_RE)) keys.add(m[1].toUpperCase());
  }
  return [...keys];
}

export function testMode(body = '') {
  const m = TEST_LINE_RE.exec(body);
  if (!m) return 'missing';
  return m[1].toLowerCase() === 'auto' ? 'auto' : 'max';
}

export function hasMigration(files = []) {
  return files.some((f) => f.startsWith(MIGRATION_PATH));
}

// States the runner must never move an issue out of: work that is already
// finished, or that Max closed on purpose.
export const TERMINAL_STATES = ['Done', 'Canceled', 'Duplicate'];

/**
 * @param {{ title?: string, body?: string, files?: string[], prNumber: number }} pr
 * @returns {{ keys: string[], mode: 'auto'|'max'|'missing', action: 'done'|'wait-prod'|'assign-max'|'none', comment: string }}
 */
export function planAutoDone({ title = '', body = '', files = [], prNumber }) {
  const keys = issueKeys(title, body ?? '');
  const mode = testMode(body ?? '');
  if (!keys.length) return { keys, mode, action: 'none', comment: '' };

  if (mode === 'auto' && !hasMigration(files)) {
    return {
      keys,
      mode,
      action: 'done',
      comment:
        `Automatisch op Done: PR #${prNumber} is gemerged met \`Test: auto\` ` +
        '(CI en review gates zijn de test, geen migratie).',
    };
  }
  if (mode === 'auto') {
    return {
      keys,
      mode,
      action: 'wait-prod',
      comment:
        `PR #${prNumber} is gemerged met \`Test: auto\`, maar bevat een migratie. ` +
        'Blijft op Merged - Testen tot de prod-push (`Push-PlusOneProd`) gedaan is; ' +
        'zeg daarna in een sessie "prod gepusht", dan gaat dit issue naar Done.',
    };
  }
  return {
    keys,
    mode,
    action: 'assign-max',
    comment:
      `PR #${prNumber} is gemerged en wacht op jouw test` +
      (mode === 'missing' ? ' (geen `Test:`-regel in de PR, dus de veilige standaard)' : '') +
      '. Beantwoord de testvragen uit de PR in een willekeurige sessie, bv. ' +
      '"getest ✅" of "1 ✅ 2 ❌ …"; die sessie zet het issue op Done of maakt een bug-issue.',
  };
}
