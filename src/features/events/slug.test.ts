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
  it('produces {name}-{date}-{suffix}', () => {
    expect(buildEventSlug('FRENZY', '2026-07-15T22:00:00', 'x4k9')).toBe('frenzy-2026-07-15-x4k9');
    expect(buildEventSlug('PLUSONE Launch Night', '2026-08-01T23:00:00', 'ab12')).toBe(
      'plusone-launch-night-2026-08-01-ab12',
    );
  });

  it('accepts a bare YYYY-MM-DD date string too', () => {
    expect(buildEventSlug('FRENZY', '2026-07-15', 'x4k9')).toBe('frenzy-2026-07-15-x4k9');
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
