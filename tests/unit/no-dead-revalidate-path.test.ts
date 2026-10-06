import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Snelheid P1 (perf audit 2026-10 finding 3). A `revalidatePath` in a server
 * action re-renders the WHOLE `/app` layout in the action response — the auth +
 * membership chain, on the user's critical path — whatever path it names: Next
 * flags the revalidation, and an action request carries no router state, so
 * the response renders from the root. The po surface reads its data through
 * React Query and invalidates its own keys after every mutation, so in these
 * domains the calls only cost time (they named `/events/*` and `/admin/*`,
 * routes that no longer exist).
 *
 * Guard: no `revalidatePath` in the guest/event/contact/quota/request actions,
 * and in the venue actions only layout revalidations, which are the ones that
 * change what the `/app` layout itself renders (active venue, venue name, the
 * caller's own memberships). Consent and profile name live in features/auth
 * and are out of this guard's scope on purpose.
 */
const ROOT = join(__dirname, '..', '..');
const NONE_ALLOWED = ['guests', 'events', 'contacts', 'quotas', 'requests'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe('no dead revalidatePath in po-facing server actions (Snelheid P1)', () => {
  it.each(NONE_ALLOWED)('src/features/%s calls no revalidatePath', (domain) => {
    const offenders = sourceFiles(join(ROOT, 'src', 'features', domain))
      .filter((f) => /\brevalidatePath\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));
    expect(offenders, 'po invalidates its own React Query keys; see the comment above').toEqual([]);
  });

  it('venue actions only revalidate the layout', () => {
    const src = readFileSync(join(ROOT, 'src', 'features', 'venues', 'actions.ts'), 'utf8');
    const calls = [...src.matchAll(/\brevalidatePath\s*\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) {
      expect(["'/', 'layout'", "'/app', 'layout'", "'/app'"]).toContain(args);
    }
  });
});
