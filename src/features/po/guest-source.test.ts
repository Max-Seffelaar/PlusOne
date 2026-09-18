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
import { guestSourceLabel } from './format';
import { t } from '@/lib/i18n';

const s = t.guests.source;

describe('flattenGuestSource', () => {
  it('flattens the to-ONE embed shape', () => {
    const out = flattenGuestSource({
      added_by_profile: { full_name: 'Sanne de Vries' },
      request_links: null,
    });
    expect(out).toEqual({ addedByName: 'Sanne de Vries', linkLabel: null });
  });

  it('flattens the to-MANY embed shape (the generated client types it either way)', () => {
    const out = flattenGuestSource({
      added_by_profile: [{ full_name: 'Sanne de Vries' }],
      request_links: [{ label: 'Backstage crew', is_default: false, influencers: null }],
    });
    expect(out).toEqual({ addedByName: 'Sanne de Vries', linkLabel: 'Backstage crew' });
  });

  it('keeps the other row fields untouched', () => {
    const out = flattenGuestSource({
      id: 'g1',
      full_name: 'Noor de Wit',
      added_by_profile: null,
      request_links: null,
    });
    expect(out).toMatchObject({ id: 'g1', full_name: 'Noor de Wit' });
    expect('added_by_profile' in out).toBe(false);
    expect('request_links' in out).toBe(false);
  });

  it('gives the DEFAULT link no label (it is just "the sign-up link")', () => {
    const out = flattenGuestSource({
      added_by_profile: null,
      request_links: { label: 'Default link', is_default: true, influencers: null },
    });
    expect(out.linkLabel).toBeNull();
  });

  it('falls back to the influencer name when a non-default link has no label', () => {
    const out = flattenGuestSource({
      added_by_profile: null,
      request_links: { label: null, is_default: false, influencers: [{ name: 'Joeri' }] },
    });
    expect(out.linkLabel).toBe('Joeri');
  });

  it('yields nulls when RLS hides both embeds (staff reading a landing guest)', () => {
    const out = flattenGuestSource({ added_by_profile: null, request_links: null });
    expect(out).toEqual({ addedByName: null, linkLabel: null });
  });
});

describe('guestSourceLabel', () => {
  it('names the person who put the guest on the list, first name only', () => {
    expect(guestSourceLabel({ source: 'app', addedByName: 'Max Seffelaar' })).toBe('Added by Max');
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
    added_by_profile: null,
    request_links: { label: 'Joeri', is_default: false, influencers: null },
  };

  it('selects source + both provenance embeds', async () => {
    const capture: { select?: string } = {};
    const client = clientReturning({ data: [row], error: null, count: 1 }, capture);
    await fetchVenueGuestsWindow(client, { venueId: 'v1' });

    expect(capture.select).toContain('source');
    expect(capture.select).toContain('user_profiles!guests_added_by_fkey(full_name)');
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
