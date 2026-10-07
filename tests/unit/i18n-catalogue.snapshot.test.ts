/**
 * The whole English catalogue (src/lib/i18n), flattened to `key.path = "value"`
 * lines and snapshotted, so a copy sweep (the Venue → Company rename,
 * z8uq9m2vqc) shows up in review as one readable diff of every user-visible
 * string that moved, and an accidental copy change elsewhere fails CI until the
 * snapshot is updated on purpose (`pnpm vitest -u tests/unit/i18n-catalogue`).
 *
 * The second test is the rename's own guard: no catalogue VALUE says "venue"
 * any more, except the "Venue" Type option (a kind of company, decision Max +
 * Joeri 2026-10-06) and `{venue}` interpolation keys (identifiers, not copy).
 */
import { describe, expect, it } from 'vitest';
import { t } from '@/lib/i18n';

function flatten(node: unknown, path: string, out: string[]): string[] {
  if (typeof node === 'string') {
    out.push(`${path} = ${JSON.stringify(node)}`);
  } else if (node && typeof node === 'object') {
    for (const key of Object.keys(node).sort()) flatten((node as Record<string, unknown>)[key], path ? `${path}.${key}` : key, out);
  }
  return out;
}

const lines = flatten(t, '', []);

describe('i18n catalogue', () => {
  it('matches the reviewed snapshot', () => {
    expect(lines.join('\n')).toMatchSnapshot();
  });

});
