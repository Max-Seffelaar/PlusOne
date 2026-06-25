import { describe, it, expect } from 'vitest';
import { slugify, buildEventSlug } from './slug';

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
  it('appends the UTC date to the slugified name', () => {
    expect(buildEventSlug('FRENZY', '2026-07-12T22:00:00Z')).toBe('frenzy-2026-07-12');
    expect(buildEventSlug('PLUSONE Launch Night', '2026-07-12T22:00:00Z')).toBe('plusone-launch-night-2026-07-12');
    expect(buildEventSlug('Summer Rave', new Date('2026-07-12T22:00:00Z'))).toBe('summer-rave-2026-07-12');
  });

  it('falls back to "event" when the name has no usable characters', () => {
    expect(buildEventSlug('!!!', '2026-07-12T00:00:00Z')).toBe('event-2026-07-12');
    expect(buildEventSlug('', '2026-07-12T00:00:00Z')).toBe('event-2026-07-12');
  });

  it('uses UTC date from the timestamp', () => {
    // 23:59:59Z is still the same UTC day
    expect(buildEventSlug('Test', '2026-07-12T23:59:59Z')).toBe('test-2026-07-12');
    // 00:00:01Z on the 13th flips to the next day
    expect(buildEventSlug('Test', '2026-07-13T00:00:01Z')).toBe('test-2026-07-13');
  });
});
