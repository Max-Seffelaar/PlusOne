import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { supabaseGateway } from './gateway';

interface Call {
  method: string;
  args: unknown[];
}

/**
 * A chainable PostgREST-builder stand-in that records every call and resolves to
 * `{ error: null }` when awaited. Lets us assert the FILTERS a gateway method
 * applies without a live database — which is exactly what enforces the safety
 * guards (a missing `.not()` / `.is()` is the bug we're testing for).
 */
function mockClient(): { client: SupabaseClient<Database>; calls: Call[] } {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ['update', 'insert', 'select', 'eq', 'is', 'not']) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return builder;
    };
  }
  // Awaiting the builder resolves to a PostgREST-style result.
  (builder as { then: unknown }).then = (resolve: (v: { error: null }) => unknown) => resolve({ error: null });
  const client = {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] });
      return builder;
    },
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

function has(calls: Call[], method: string, args: unknown[]): boolean {
  return calls.some((c) => c.method === method && JSON.stringify(c.args) === JSON.stringify(args));
}

describe('supabaseGateway.reviveCheckIn (C10 — never overwrite an active check-in)', () => {
  it('scopes the UPDATE to a genuinely voided row via .not(voided_at, is, null)', async () => {
    const { client, calls } = mockClient();
    await supabaseGateway(client).reviveCheckIn('g1', 2, 'uid-1');
    // The voided-only guard is the fix: without it a stale cockpit's revive
    // fallback would overwrite a peer's active checked_by/checked_at.
    expect(has(calls, 'not', ['voided_at', 'is', null])).toBe(true);
    expect(has(calls, 'eq', ['guest_id', 'g1'])).toBe(true);
    expect(calls.some((c) => c.method === 'update')).toBe(true);
  });
});

describe('supabaseGateway.voidCheckIn (idempotent re-void)', () => {
  it('only voids a currently-active row via .is(voided_at, null)', async () => {
    const { client, calls } = mockClient();
    await supabaseGateway(client).voidCheckIn('g1', 'uid-1');
    expect(has(calls, 'is', ['voided_at', null])).toBe(true);
    expect(has(calls, 'eq', ['guest_id', 'g1'])).toBe(true);
  });
});
