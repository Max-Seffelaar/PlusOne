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
    rpc: (fn: string, args: unknown) => {
      calls.push({ method: 'rpc', args: [fn, args] });
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

// #35 — guest_id alone is not an identity: check_ins has exactly one row per
// guest, so a queued offline write matched on guest_id lands on whatever
// check-in exists at drain time, including a colleague's newer one.
describe('supabaseGateway row scoping by the observed check_ins id (#35)', () => {
  it('pins a void to the observed row when one is known', async () => {
    const { client, calls } = mockClient();
    await supabaseGateway(client).voidCheckIn('g1', 'uid-1', 'ci-observed');
    expect(has(calls, 'eq', ['id', 'ci-observed'])).toBe(true);
    expect(has(calls, 'is', ['voided_at', null])).toBe(true);
  });

  it('pins a revive to the observed row as well', async () => {
    const { client, calls } = mockClient();
    await supabaseGateway(client).reviveCheckIn('g1', 2, 'uid-1', 'ci-observed');
    expect(has(calls, 'eq', ['id', 'ci-observed'])).toBe(true);
    expect(has(calls, 'not', ['voided_at', 'is', null])).toBe(true);
  });

  it('stays guest-scoped when no row id is known (entries queued pre-fix)', async () => {
    const { client, calls } = mockClient();
    await supabaseGateway(client).voidCheckIn('g1', 'uid-1', null);
    expect(calls.some((c) => c.method === 'eq' && c.args[0] === 'id')).toBe(false);
  });
});

describe('supabaseGateway.checkOutGuest (#34 — one transaction)', () => {
  it('calls the check_out_guest RPC instead of a void/revive pair', async () => {
    const { client, calls } = mockClient();
    await supabaseGateway(client).checkOutGuest('g1', 2, 'ci-observed');
    // Args land as the RPC's named parameters, not a positional array.
    expect(
      has(calls, 'rpc', [
        'check_out_guest',
        { p_guest_id: 'g1', p_remaining_heads: 2, p_check_in_id: 'ci-observed' },
      ]),
    ).toBe(true);
    // No client-side UPDATE may remain — that is the non-atomic path (#34).
    expect(calls.some((c) => c.method === 'update')).toBe(false);
  });
});
