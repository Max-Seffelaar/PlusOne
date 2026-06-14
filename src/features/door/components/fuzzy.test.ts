import { describe, expect, it } from 'vitest';
import { filterBySearch, fuzzyMatch, normalize } from './fuzzy';

describe('normalize', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalize('Aïcha Benali')).toBe('aicha benali');
    expect(normalize('  José  ')).toBe('jose');
  });
});

describe('fuzzyMatch', () => {
  it('matches substrings, case- and diacritic-insensitively', () => {
    expect(fuzzyMatch('juri', 'Juri Braakman')).toBe(true);
    expect(fuzzyMatch('AICHA', 'Aïcha Benali')).toBe(true);
  });
  it('matches as a subsequence for fast typing', () => {
    expect(fuzzyMatch('jrbr', 'Juri Braakman')).toBe(true);
    expect(fuzzyMatch('brak', 'Juri Braakman')).toBe(true);
  });
  it('does not match unrelated input', () => {
    expect(fuzzyMatch('xyz', 'Juri Braakman')).toBe(false);
  });
  it('an empty query matches everything', () => {
    expect(fuzzyMatch('', 'anyone')).toBe(true);
  });
});

describe('filterBySearch', () => {
  const people = [
    { name: 'Juri Braakman', last4: '5678' },
    { name: 'Sanne Mulder', last4: '4321' },
    { name: 'Aïcha Benali', last4: null },
  ];

  it('filters by fuzzy name', () => {
    expect(filterBySearch(people, 'sanne').map((p) => p.name)).toEqual(['Sanne Mulder']);
    expect(filterBySearch(people, 'aicha').map((p) => p.name)).toEqual(['Aïcha Benali']);
  });

  it('filters by last-4 phone digits (#27)', () => {
    expect(filterBySearch(people, '5678').map((p) => p.name)).toEqual(['Juri Braakman']);
  });

  it('returns everything for an empty query', () => {
    expect(filterBySearch(people, '')).toHaveLength(3);
  });
});
