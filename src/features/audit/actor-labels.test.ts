/**
 * Who-did-what labels (spec #61a): the one rule every company-facing surface
 * uses — a current or former member/crew is named, a PlusOne operator without a
 * tie is "PlusOne support", no actor is "System". The names come from the
 * venue_actor_names RPC, chunked to ≤120 ids per call (CLAUDE.md scale rule).
 */
import { describe, it, expect, vi } from 'vitest';
import { ACTOR_ID_CHUNK, actorLabel, fetchActorLabels, labelForActorRow } from './actor-labels';
import { t } from '@/lib/i18n';

type Row = { user_id: string; display_name: string | null; is_support: boolean };

function fakeClient(opts: {
  rows?: (ids: string[]) => Row[];
  rpcError?: { code: string; message?: string } | null;
  profiles?: { id: string; full_name: string }[];
}) {
  const rpcCalls: { venue: string; ids: string[] }[] = [];
  const profileReads: string[][] = [];
  const client = {
    rpc: vi.fn((name: string, args: { p_venue_id: string; p_ids: string[] }) => {
      expect(name).toBe('venue_actor_names');
      rpcCalls.push({ venue: args.p_venue_id, ids: args.p_ids });
      if (opts.rpcError) return Promise.resolve({ data: null, error: opts.rpcError });
      return Promise.resolve({ data: (opts.rows ?? (() => []))(args.p_ids), error: null });
    }),
    from: vi.fn((table: string) => {
      expect(table).toBe('user_profiles');
      return {
        select: () => ({
          in: (_col: string, ids: string[]) => {
            profileReads.push(ids);
            return Promise.resolve({
              data: (opts.profiles ?? []).filter((p) => ids.includes(p.id)),
              error: null,
            });
          },
        }),
      };
    }),
  };
  return { client: client as never, rpcCalls, profileReads };
}

describe('the label rule', () => {
  it('names a current or former member', () => {
    expect(labelForActorRow({ user_id: 'u1', display_name: 'Lisa van den Berg', is_support: false })).toBe(
      'Lisa van den Berg',
    );
  });

  it('never names an operator without a tie: "PlusOne support"', () => {
    expect(labelForActorRow({ user_id: 'u2', display_name: null, is_support: true })).toBe(t.shared.actor.support);
    // Even if a name ever came along with is_support, the flag wins.
    expect(labelForActorRow({ user_id: 'u2', display_name: 'Secret Operator', is_support: true })).toBe(
      'PlusOne support',
    );
  });

  it('says "System" for no actor', () => {
    expect(actorLabel(null, new Map())).toBe('System');
    expect(actorLabel(undefined, new Map([['u1', 'Lisa']]))).toBe(t.shared.actor.system);
  });

  it('uses the resolved label, else the caller fallback (never a raw uuid)', () => {
    const labels = new Map([['u1', 'Lisa']]);
    expect(actorLabel('u1', labels)).toBe('Lisa');
    expect(actorLabel('u-unknown', labels)).toBe('');
    expect(actorLabel('u-unknown', labels, 'Door')).toBe('Door');
  });
});

describe('fetchActorLabels', () => {
  it('asks the venue once for the distinct non-null ids and applies the rule', async () => {
    const { client, rpcCalls } = fakeClient({
      rows: (ids) =>
        ids.flatMap((id): Row[] =>
          id === 'u-former'
            ? [{ user_id: id, display_name: 'Former Floor', is_support: false }]
            : id === 'u-op'
              ? [{ user_id: id, display_name: null, is_support: true }]
              : [],
        ),
    });
    const labels = await fetchActorLabels(client, 'v1', ['u-former', null, 'u-op', 'u-former', '', undefined, 'u-x']);
    expect(rpcCalls).toEqual([{ venue: 'v1', ids: ['u-former', 'u-op', 'u-x'] }]);
    expect(Object.fromEntries(labels)).toEqual({ 'u-former': 'Former Floor', 'u-op': 'PlusOne support' });
  });

  it('chunks to ≤120 ids per call', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `u${i}`);
    const { client, rpcCalls } = fakeClient({
      rows: (chunk) => chunk.map((id) => ({ user_id: id, display_name: `N ${id}`, is_support: false })),
    });
    const labels = await fetchActorLabels(client, 'v1', ids);
    expect(ACTOR_ID_CHUNK).toBe(120);
    expect(rpcCalls.map((c) => c.ids.length)).toEqual([120, 120, 10]);
    expect(labels.size).toBe(250);
  });

  it('makes no call without ids or without a venue', async () => {
    const { client, rpcCalls } = fakeClient({});
    expect((await fetchActorLabels(client, 'v1', [null, undefined, ''])).size).toBe(0);
    expect((await fetchActorLabels(client, '', ['u1'])).size).toBe(0);
    expect(rpcCalls).toEqual([]);
  });

  it('falls back to the RLS profile read only while the RPC is not deployed (PGRST202)', async () => {
    const { client, profileReads } = fakeClient({
      rpcError: { code: 'PGRST202' },
      profiles: [{ id: 'u1', full_name: 'Tom Bakker' }],
    });
    const labels = await fetchActorLabels(client, 'v1', ['u1', 'u2']);
    expect(profileReads).toEqual([['u1', 'u2']]);
    expect(Object.fromEntries(labels)).toEqual({ 'u1': 'Tom Bakker' });
  });

  it('throws any other RPC error (no silent widening, no silent blank)', async () => {
    const { client, profileReads } = fakeClient({ rpcError: { code: '22023', message: 'too many' } });
    await expect(fetchActorLabels(client, 'v1', ['u1'])).rejects.toMatchObject({ code: '22023' });
    expect(profileReads).toEqual([]);
  });
});
