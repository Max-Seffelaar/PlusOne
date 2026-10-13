/**
 * Guest provenance (ADE round, item J): the embed flattener + the display helper.
 *
 * Two things are worth pinning here. First, `request_links` is readable only by
 * admin/finance/organizer (RLS, migration 20260706100000), so a staff member's
 * row comes back with a NULL embed — the label has to degrade to the plain
 * "Sign-up link" instead of rendering "Sign-up link · null" or tempting anyone
 * into widening the policy. Second, the DEFAULT link is "the sign-up link": it
 * carries no label worth printing, and a venue with one link would otherwise get
 * a redundant suffix on every landing row.
 */
import { describe, it, expect, vi } from 'vitest';
import { flattenGuestSource, fetchVenueGuestsWindow, VENUE_GUESTS_WINDOW } from './queries';
import { guestSourceLabel, guestSourceParts, firstName } from './format';
import { t } from '@/lib/i18n';
import { ActorLabels } from '@/features/audit/actor-labels';

const s = t.guests.source;

// added_by → label comes from the venue's actor labels (venue_actor_names, #64a).
const labels = new ActorLabels()
  .setActor('u-sanne', 'Sanne de Vries', 'member')
  .setActor('u-op', t.shared.actor.support, 'support')
  // A member who NAMED themselves like the label: just a name, kind member.
  .setActor('u-spoof', 'PlusOne support', 'member');

describe('flattenGuestSource', () => {
  it('labels the adder through the venue actor labels', () => {
    const out = flattenGuestSource({ added_by: 'u-sanne', request_links: null }, labels);
    expect(out).toEqual({ addedByName: 'Sanne de Vries', addedByKind: 'member', linkLabel: null });
  });

  it('carries "PlusOne support" for an operator as kind support', () => {
    const out = flattenGuestSource({ added_by: 'u-op', request_links: null }, labels);
    expect(out.addedByName).toBe('PlusOne support');
    expect(out.addedByKind).toBe('support');
  });

  it('a member whose name merely reads "PlusOne support" stays kind member', () => {
    expect(flattenGuestSource({ added_by: 'u-spoof', request_links: null }, labels).addedByKind).toBe('member');
  });

  it('an adder without a label is kind unknown; no adder is no kind', () => {
    expect(flattenGuestSource({ added_by: 'u-unknown', request_links: null }, labels).addedByKind).toBe('unknown');
    expect(flattenGuestSource({ added_by: null, request_links: null }, labels).addedByKind).toBeNull();
  });

  it('yields null for an adder the venue has no label for, and without labels', () => {
    expect(flattenGuestSource({ added_by: 'u-unknown', request_links: null }, labels).addedByName).toBeNull();
    expect(flattenGuestSource({ added_by: 'u-sanne', request_links: null }).addedByName).toBeNull();
  });

  it('flattens the to-MANY link embed shape (the generated client types it either way)', () => {
    const out = flattenGuestSource(
      {
        added_by: 'u-sanne',
        request_links: [{ label: 'Backstage crew', is_default: false, influencers: null }],
      },
      labels,
    );
    expect(out).toEqual({ addedByName: 'Sanne de Vries', addedByKind: 'member', linkLabel: 'Backstage crew' });
  });

  it('keeps the other row fields untouched', () => {
    const out = flattenGuestSource({
      id: 'g1',
      full_name: 'Noor de Wit',
      added_by: null,
      request_links: null,
    });
    expect(out).toMatchObject({ id: 'g1', full_name: 'Noor de Wit' });
    expect('added_by' in out).toBe(false);
    expect('request_links' in out).toBe(false);
  });

  it('gives the DEFAULT link no label (it is just "the sign-up link")', () => {
    const out = flattenGuestSource({
      added_by: null,
      request_links: { label: 'Default link', is_default: true, influencers: null },
    });
    expect(out.linkLabel).toBeNull();
  });

  it('falls back to the influencer name when a non-default link has no label', () => {
    const out = flattenGuestSource({
      added_by: null,
      request_links: { label: null, is_default: false, influencers: [{ name: 'Joeri' }] },
    });
    expect(out.linkLabel).toBe('Joeri');
  });

  it('yields nulls when RLS hides both embeds (staff reading a landing guest)', () => {
    const out = flattenGuestSource({ added_by: null, request_links: null });
    expect(out).toEqual({ addedByName: null, addedByKind: null, linkLabel: null });
  });
});

describe('firstName (label-like first words keep the full name)', () => {
  it('cuts an ordinary name to the first name', () => {
    expect(firstName('Max Seffelaar')).toBe('Max');
  });

  it.each(['System Smith', 'unknown Person', 'Unnamed X', 'PlusOne Fan'])('keeps %j whole', (name) => {
    expect(firstName(name)).toBe(name);
  });

  it('splits on U+2800 too, and a styled label-like first word keeps the full name (review #466 r4)', () => {
    const braille = String.fromCodePoint(0x2800);
    expect(firstName(`Anna${braille}Bakker`)).toBe('Anna');
    const mathBoldSystem = [...'System']
      .map((ch) => String.fromCodePoint((ch === 'S' ? 0x1d400 + 18 : 0x1d41a + ch.charCodeAt(0) - 97)))
      .join('');
    expect(firstName(`${mathBoldSystem} Smith`)).toBe(`${mathBoldSystem} Smith`);
  });
});

describe('guestSourceLabel', () => {
  it('names the person who put the guest on the list, first name only', () => {
    expect(guestSourceLabel({ source: 'app', addedByName: 'Max Seffelaar' })).toBe('Added by Max');
  });

  it('keeps "PlusOne support" whole and typed when the KIND says so', () => {
    expect(guestSourceLabel({ source: 'app', addedByName: t.shared.actor.support, addedByKind: 'support' })).toBe(
      'Added by PlusOne support',
    );
    expect(guestSourceLabel({ source: 'door', addedByName: t.shared.actor.support, addedByKind: 'support' })).toBe(
      'At the door by PlusOne support',
    );
    expect(guestSourceParts({ source: 'app', addedByName: t.shared.actor.support, addedByKind: 'support' })).toEqual({
      template: s.addedBy,
      name: 'PlusOne support',
      kind: 'support',
    });
  });

  it('a member NAMED like a label stays kind member (rendered plain), never support/system (review #466 r3)', () => {
    const lri = String.fromCodePoint(0x2066);
    for (const name of ['PlusOne support', `System${lri}`, 'System Smith']) {
      const parts = guestSourceParts({ source: 'app', addedByName: name, addedByKind: 'member' });
      expect(parts).toMatchObject({ kind: 'member' });
    }
    // …and a label-like first word keeps the full name, so it can't read as a bare label.
    expect(guestSourceLabel({ source: 'app', addedByName: 'System Smith', addedByKind: 'member' })).toBe(
      'Added by System Smith',
    );
  });

  it('says the door added them', () => {
    expect(guestSourceLabel({ source: 'door', addedByName: 'Sanne de Vries' })).toBe('At the door by Sanne');
  });

  it('falls back to "a colleague" when RLS hides the actor profile', () => {
    expect(guestSourceLabel({ source: 'app', addedByName: null })).toBe(s.addedByColleague);
    expect(guestSourceLabel({ source: 'door', addedByName: null })).toBe(s.atDoorByColleague);
  });

  it('names the sign-up link, and the specific link when it is not the default', () => {
    expect(guestSourceLabel({ source: 'landing', linkLabel: null })).toBe(s.signUpLink);
    expect(guestSourceLabel({ source: 'landing', linkLabel: 'Joeri' })).toBe('Sign-up link · Joeri');
  });

  it('ignores the adder for a landing sign-up (the guest signed themselves up)', () => {
    expect(guestSourceLabel({ source: 'landing', addedByName: 'Max Seffelaar', linkLabel: null })).toBe(
      s.signUpLink,
    );
  });

  it('calls a permanent guest a Regular (glossary term, not "auto-added")', () => {
    expect(guestSourceLabel({ source: 'permanent', addedByName: 'Max Seffelaar' })).toBe('Regular');
  });

  it('never leaks a raw placeholder into the copy', () => {
    for (const source of ['app', 'landing', 'door', 'permanent'] as const) {
      const label = guestSourceLabel({ source, addedByName: 'Max Seffelaar', linkLabel: 'Joeri' });
      expect(label).not.toContain('{');
      expect(label.trim()).not.toBe('');
    }
  });
});

// ── The read actually ASKS for the provenance ────────────────────────────────
// `flattenGuestSource` is only as good as the select that feeds it: the PostgREST
// result is cast, not inferred, so dropping `source` or an embed from the select
// string type-checks fine and shows up as a blank caption in production. This
// pins the select itself, end to end through the flattener.

interface Terminal {
  ilike: (col: string, pat: string) => Promise<unknown>;
  then: (resolve: (v: unknown) => unknown) => Promise<unknown>;
}
interface Chain {
  select: (select: string) => Chain;
  eq: () => Chain;
  in: () => Chain;
  order: () => Chain;
  range: () => Terminal;
}

function clientReturning(result: unknown, capture: { select?: string }) {
  const terminal: Terminal = {
    ilike: vi.fn(() => Promise.resolve(result)),
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  const chain: Chain = {
    select: vi.fn((select: string) => {
      capture.select = select;
      return chain;
    }),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    range: vi.fn(() => terminal),
  };
  return { from: vi.fn(() => chain) } as never;
}

describe('the venue-wide guest read carries provenance', () => {
  const row = {
    id: 'g1',
    full_name: 'Noor de Wit',
    plus_ones: 0,
    status: 'approved',
    tier_id: 't1',
    note: null,
    note_priority: 'none',
    note_acknowledged_at: null,
    created_at: '2026-09-14T00:00:00Z',
    contact_id: null,
    event_id: 'e1',
    guest_tiers: { name: 'Guest', color: '#9DE0C0' },
    source: 'landing',
    added_by: null,
    request_links: { label: 'Joeri', is_default: false, influencers: null },
  };

  it('selects source + added_by + the request-link embed', async () => {
    const capture: { select?: string } = {};
    const client = clientReturning({ data: [row], error: null, count: 1 }, capture);
    await fetchVenueGuestsWindow(client, { venueId: 'v1' });

    expect(capture.select).toContain('source');
    expect(capture.select).toContain('added_by');
    // The adder is labelled via venue_actor_names (#64a), never an RLS-scoped
    // user_profiles embed (it hid former members and named operators).
    expect(capture.select).not.toContain('user_profiles');
    expect(capture.select).toContain('request_links(label, is_default, influencers(name))');
    // Still ONE bounded page — the embeds must not turn this into a venue dump.
    expect(VENUE_GUESTS_WINDOW).toBe(200);
  });

  it('hands the row back flattened, ready for guestSourceLabel', async () => {
    const client = clientReturning({ data: [row], error: null, count: 1 }, {});
    const { rows } = await fetchVenueGuestsWindow(client, { venueId: 'v1' });

    expect(rows[0]).toMatchObject({ source: 'landing', addedByName: null, linkLabel: 'Joeri' });
    expect(guestSourceLabel(rows[0])).toBe('Sign-up link · Joeri');
  });
});
