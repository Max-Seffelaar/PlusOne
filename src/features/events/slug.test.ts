import { describe, it, expect } from 'vitest';
import { slugify, buildEventSlug, randomSlugSuffix } from './slug';

describe('slugify (mirrors SQL public.slugify)', () => {
  it('lowercases and dashes non-alphanumerics', () => {
    expect(slugify('PLUSONE Launch Night')).toBe('plusone-launch-night');
    expect(slugify('FRENZY')).toBe('frenzy');
    expect(slugify('VIP + fles op tafel')).toBe('vip-fles-op-tafel');
  });

  it('collapses runs and trims edge dashes', () => {
    expect(slugify('  ---Hello   World!!!  ')).toBe('hello-world');
    expect(slugify('a___b')).toBe('a-b');
  });

  it('drops characters with no ascii-alphanumeric equivalent', () => {
    expect(slugify('Café Brûlé')).toBe('caf-br-l');
    expect(slugify('日本語')).toBe('');
    expect(slugify('!!!')).toBe('');
  });
});

describe('buildEventSlug', () => {
  it('produces {name}-{date}-{suffix}, dated in Europe/Amsterdam', () => {
    // 20:00 UTC = 22:00 CEST — same calendar day in both zones.
    expect(buildEventSlug('FRENZY', '2026-07-15T20:00:00Z', 'x4k9')).toBe('frenzy-2026-07-15-x4k9');
    expect(buildEventSlug('PLUSONE Launch Night', '2026-08-01T20:00:00Z', 'ab12')).toBe(
      'plusone-launch-night-2026-08-01-ab12',
    );
  });

  it('accepts a bare YYYY-MM-DD date string too', () => {
    expect(buildEventSlug('FRENZY', '2026-07-15', 'x4k9')).toBe('frenzy-2026-07-15-x4k9');
  });

  it('uses the Amsterdam day, not the UTC day, for a 00:00–02:00 start (C21)', () => {
    // 23:00 UTC on 2026-07-15 is already 01:00 CEST on 2026-07-16 — the slug
    // must carry the Amsterdam day the doors actually open on.
    expect(buildEventSlug('FRENZY', '2026-07-15T23:00:00Z', 'x4k9')).toBe('frenzy-2026-07-16-x4k9');
    // Winter (CET, UTC+1): 23:30 UTC on 2026-01-15 is 00:30 CET on 2026-01-16.
    expect(buildEventSlug('FRENZY', '2026-01-15T23:30:00Z', 'x4k9')).toBe('frenzy-2026-01-16-x4k9');
  });

  it('falls back to "event" when the name has no usable characters', () => {
    expect(buildEventSlug('!!!', '2026-07-15', 'zzzz')).toBe('event-2026-07-15-zzzz');
    expect(buildEventSlug('', '2026-07-15', 'zzzz')).toBe('event-2026-07-15-zzzz');
  });

  it('uses a random suffix by default', () => {
    const slug = buildEventSlug('Test', '2026-07-15');
    expect(slug).toMatch(/^test-2026-07-15-[a-z0-9]{4}$/);
  });
});

describe('randomSlugSuffix', () => {
  it('produces a lowercase alphanumeric string of the requested length', () => {
    expect(randomSlugSuffix(4)).toMatch(/^[a-z0-9]{4}$/);
    expect(randomSlugSuffix(8)).toMatch(/^[a-z0-9]{8}$/);
  });
});
