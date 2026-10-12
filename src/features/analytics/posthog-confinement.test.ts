import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * posthog-js stays behind the adapter, and only as a DYNAMIC import (plan §1,
 * "Door perf"): a static `import … from 'posthog-js'` anywhere would put the
 * bundle on the critical path of whatever imports it — the door first paint
 * included — and make it download for users who never consented. Type-only
 * imports are fine (erased at build). posthog-node is server-only and lives in
 * one file (src/features/analytics/server.ts, PR 2) or nowhere.
 */
const ROOT = join(__dirname, '..', '..', '..');
const SRC = join(ROOT, 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

const sources = files(SRC).map((p) => ({ path: relative(ROOT, p).split('\\').join('/'), text: readFileSync(p, 'utf8') }));

describe('posthog confinement', () => {
  it('no source imports posthog-js statically (type-only imports excepted)', () => {
    const offenders = sources.filter(({ text }) =>
      /^\s*import\s+(?!type\b)[^;]*from\s+['"]posthog-js(\/[^'"]*)?['"]/m.test(text) ||
      /^\s*import\s+['"]posthog-js/m.test(text) ||
      /require\(\s*['"]posthog-js/.test(text),
    );
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it('the dynamic import of posthog-js lives in posthog-client.ts only', () => {
    const dyn = sources.filter(({ text }) => /import\(\s*['"]posthog-js/.test(text)).map((f) => f.path);
    expect(dyn).toEqual(['src/features/analytics/posthog-client.ts']);
  });

  it('posthog-node is only used by the server-only analytics module', () => {
    const users = sources.filter(({ text }) => /['"]posthog-node['"]/.test(text)).map((f) => f.path);
    for (const p of users) expect(p).toBe('src/features/analytics/server.ts');
  });
});
