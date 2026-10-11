/**
 * Who-did-what labels (spec #62a): the one rule every company-facing surface
 * uses — a current or former member/crew is named, a PlusOne operator without a
 * tie is "PlusOne support", no actor is "System". The names come from the
 * venue_actor_names RPC, chunked to ≤120 ids per call (CLAUDE.md scale rule).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  ACTOR_ID_CHUNK,
  ActorLabels,
  fetchActorLabels,
  actorRef,
  fetchActorLabelsSafe,
  labelForActorRow,
  refForActorRow,
} from './actor-labels';
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

  it('decides "PlusOne support" from is_support ONLY (review #466 P1-2)', () => {
    // A member who named themselves like the label stays a name, not support…
    expect(labelForActorRow({ user_id: 'u3', display_name: 'PlusOne support', is_support: false })).toBe(
      'PlusOne support',
    );
    // …and a blank name is the neutral "Unnamed", never support.
    expect(labelForActorRow({ user_id: 'u4', display_name: '', is_support: false })).toBe(t.shared.actor.unnamed);
    expect(labelForActorRow({ user_id: 'u4', display_name: '   ', is_support: false })).toBe('Unnamed');
    expect(labelForActorRow({ user_id: 'u4', display_name: null, is_support: false })).toBe('Unnamed');
  });

  it('treats Unicode-space or invisible-only names as blank, like the DB (review #466 N1)', () => {
    const c = String.fromCharCode;
    for (const blank of [c(12288), c(9), c(8203), `${c(160)}${c(8203)}`]) {
      expect(labelForActorRow({ user_id: 'u5', display_name: blank, is_support: false })).toBe('Unnamed');
    }
    // Otherwise the stored name is shown as is (trimmed).
    expect(labelForActorRow({ user_id: 'u6', display_name: ' Anne Marie ', is_support: false })).toBe('Anne Marie');
  });

  it('says "System" for no actor, "Unknown" for an unresolved id (never a raw uuid)', () => {
    const labels = new ActorLabels().setActor('u1', 'Lisa', 'member');
    expect(actorRef(null, labels)).toEqual({ text: t.shared.actor.system, kind: 'system' });
    expect(actorRef('u1', labels)).toEqual({ text: 'Lisa', kind: 'member' });
    expect(actorRef('u-unknown', labels)).toEqual({ text: t.shared.actor.unknown, kind: 'unknown' });
  });
});

describe('typed labels (review #466 round 3): only a member carries user text', () => {
  const lri = String.fromCodePoint(0x2066);

  it.each([`System${lri}`, 'PlusOne support', 'PIusOne support', 'Unknown'])(
    'a member named %j is kind member, never system/support',
    (name) => {
      expect(refForActorRow({ user_id: 'u', display_name: name, is_support: false })).toEqual({
        text: name,
        kind: 'member',
      });
    },
  );

  it('support comes from the flag; blank is unnamed', () => {
    expect(refForActorRow({ user_id: 'u', display_name: null, is_support: true })).toEqual({
      text: 'PlusOne support',
      kind: 'support',
    });
    expect(refForActorRow({ user_id: 'u', display_name: String.fromCodePoint(0x3164), is_support: false }).kind).toBe(
      'unnamed',
    );
  });

  it('actorRef: null → system, missing → unknown, resolved → its kind', () => {
    const labels = new ActorLabels().setActor('u1', `System${lri}`, 'member').setActor('u2', 'PlusOne support', 'support');
    expect(actorRef(null, labels)).toEqual({ text: 'System', kind: 'system' });
    expect(actorRef('u-x', labels)).toEqual({ text: 'Unknown', kind: 'unknown' });
    expect(actorRef('u1', labels)).toEqual({ text: `System${lri}`, kind: 'member' });
    expect(actorRef('u2', labels)).toEqual({ text: 'PlusOne support', kind: 'support' });
    expect(labels.idsOfKind('support')).toEqual(['u2']);
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
    // The flag travels with the label, so the UI never compares text.
    expect(labels).toBeInstanceOf(ActorLabels);
    expect(labels.isSupport('u-op')).toBe(true);
    expect(labels.isSupport('u-former')).toBe(false);
    expect(labels.isSupport(null)).toBe(false);
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

describe('fetchActorLabelsSafe (door, lists: labels are a nicety)', () => {
  it('returns an empty label set instead of throwing, and never widens to user_profiles', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client, profileReads } = fakeClient({ rpcError: { code: '57014', message: 'statement timeout' } });
    const labels = await fetchActorLabelsSafe(client, 'v1', ['u1']);
    expect(labels.size).toBe(0);
    expect(labels.isSupport('u1')).toBe(false);
    expect(profileReads).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('passes the labels through when the RPC works', async () => {
    const { client } = fakeClient({ rows: () => [{ user_id: 'u1', display_name: 'Tom', is_support: false }] });
    expect(Object.fromEntries(await fetchActorLabelsSafe(client, 'v1', ['u1']))).toEqual({ u1: 'Tom' });
  });
});
