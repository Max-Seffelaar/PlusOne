import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import {
  CONTACT_MATCH_MAX_NAMES,
  contactNameMatches,
  distinctContactNames,
  matchContactByName,
  normalizeContactName,
  resolveContactMatches,
  searchContactsForReuse,
  type ContactCandidate,
} from './contact-match';

const c = (id: string, fullName: string): ContactCandidate => ({ id, fullName });

const VENUE = 'aa000000-0000-7000-8000-000000000001';

describe('normalizeContactName', () => {
  it('trims, collapses whitespace and lower-cases', () => {
    expect(normalizeContactName('  Juri   Braakman ')).toBe('juri braakman');
  });

  it('strips diacritics via NFD', () => {
    expect(normalizeContactName('Jerôme Ångström')).toBe('jerome angstrom');
    expect(normalizeContactName('José')).toBe(normalizeContactName('Jose'));
  });

  it('folds a pre-composed and a decomposed spelling to the same key', () => {
    expect(normalizeContactName('Noël')).toBe(normalizeContactName('Noël'));
  });

  it('is empty for a blank name', () => {
    expect(normalizeContactName('   ')).toBe('');
  });
});

describe('matchContactByName', () => {
  const contacts = [c('id-1', 'Juri Braakman'), c('id-2', 'Noor de Wit')];

  it('matches exactly one contact -> its id', () => {
    expect(matchContactByName('Juri Braakman', contacts)).toBe('id-1');
  });

  it('ignores case', () => {
    expect(matchContactByName('juri braakman', contacts)).toBe('id-1');
  });

  it('ignores double spaces and surrounding whitespace', () => {
    expect(matchContactByName('  Juri   Braakman  ', contacts)).toBe('id-1');
  });

  it('ignores diacritics on either side', () => {
    expect(matchContactByName('Jerome Dupont', [c('id-3', 'Jérôme Dupont')])).toBe('id-3');
    expect(matchContactByName('Jérôme Dupont', [c('id-3', 'Jerome Dupont')])).toBe('id-3');
  });

  it('no match -> null', () => {
    expect(matchContactByName('Sem Aaltink', contacts)).toBeNull();
  });

  it('two contacts with the same name -> null (never guess which person)', () => {
    const dupes = [c('id-1', 'Jan de Vries'), c('id-2', 'jan  de vries')];
    expect(contactNameMatches('Jan de Vries', dupes)).toHaveLength(2);
    expect(matchContactByName('Jan de Vries', dupes)).toBeNull();
  });

  it('a partial name is not a match (ilike noise from the RPC is filtered out)', () => {
    expect(matchContactByName('Jan', [c('id-1', 'Jansen'), c('id-2', 'Jana Smit')])).toBeNull();
  });

  it('a blank name never matches', () => {
    expect(matchContactByName('   ', contacts)).toBeNull();
  });
});

describe('distinctContactNames', () => {
  it('dedupes on the normalized key and keeps insertion order', () => {
    expect(distinctContactNames(['Juri Braakman', 'juri  braakman', 'Noor de Wit'])).toEqual([
      'juri braakman',
      'noor de wit',
    ]);
  });

  it('drops blanks and one-character names', () => {
    expect(distinctContactNames(['', '  ', 'X', 'Ab'])).toEqual(['ab']);
  });

  it('caps the batch', () => {
    const many = Array.from({ length: CONTACT_MATCH_MAX_NAMES + 25 }, (_, i) => `Guest ${i}`);
    expect(distinctContactNames(many)).toHaveLength(CONTACT_MATCH_MAX_NAMES);
  });
});

/** Minimal typed stub: only `.rpc()` is ever touched by these helpers. */
function rpcClient(impl: (args: { p_venue_id: string; p_query: string }) => unknown) {
  const rpc = vi.fn(async (_fn: string, args: { p_venue_id: string; p_query: string }) => {
    const out = impl(args);
    if (out instanceof Error) return { data: null, error: { message: out.message } };
    return { data: out, error: null };
  });
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

describe('searchContactsForReuse', () => {
  it('maps the RPC projection to candidates', async () => {
    const { client, rpc } = rpcClient(() => [
      { id: 'id-1', full_name: 'Juri Braakman', preferred_role: 'guest', event_count: 3 },
    ]);
    await expect(searchContactsForReuse(client, VENUE, 'Juri')).resolves.toEqual([
      { id: 'id-1', fullName: 'Juri Braakman' },
    ]);
    expect(rpc).toHaveBeenCalledWith('search_contacts_for_reuse', {
      p_venue_id: VENUE,
      p_query: 'Juri',
    });
  });

  it('throws on an RPC error (the caller decides how to degrade)', async () => {
    const { client } = rpcClient(() => new Error('boom'));
    await expect(searchContactsForReuse(client, VENUE, 'Juri')).rejects.toBeTruthy();
  });
});

describe('resolveContactMatches', () => {
  it('resolves one lookup per distinct name and keys by the normalized name', async () => {
    const { client, rpc } = rpcClient(({ p_query }) =>
      p_query === 'juri braakman'
        ? [{ id: 'id-1', full_name: 'Juri Braakman', preferred_role: 'guest', event_count: 1 }]
        : [],
    );
    const map = await resolveContactMatches(client, VENUE, ['Juri Braakman', 'juri  braakman', 'Noor de Wit']);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(map.get('juri braakman')).toEqual([{ id: 'id-1', fullName: 'Juri Braakman' }]);
    expect(map.get('noor de wit')).toEqual([]);
  });

  it('ambiguous names come back with both hits (the screen shows "2 contacts")', async () => {
    const { client } = rpcClient(() => [
      { id: 'id-1', full_name: 'Jan de Vries', preferred_role: 'guest', event_count: 1 },
      { id: 'id-2', full_name: 'Jan de Vries', preferred_role: 'guest', event_count: 4 },
    ]);
    const map = await resolveContactMatches(client, VENUE, ['Jan de Vries']);
    expect(map.get('jan de vries')).toHaveLength(2);
  });

  it('a failed lookup degrades to "no match", never a failed batch', async () => {
    const { client } = rpcClient(({ p_query }) => (p_query === 'noor de wit' ? new Error('offline') : []));
    const map = await resolveContactMatches(client, VENUE, ['Juri Braakman', 'Noor de Wit']);
    expect(map.get('noor de wit')).toEqual([]);
    expect(map.get('juri braakman')).toEqual([]);
  });

  it('never runs more than `concurrency` lookups at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const rpc = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return { data: [], error: null };
    });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    const names = Array.from({ length: 20 }, (_, i) => `Guest ${i}`);
    await resolveContactMatches(client, VENUE, names, 6);
    expect(rpc).toHaveBeenCalledTimes(20);
    expect(peak).toBeLessThanOrEqual(6);
  });
});
