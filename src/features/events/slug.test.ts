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
  it('combines the slugified name with the date', () => {
    expect(buildEventSlug('FRENZY', '2026-07-12')).toBe('frenzy-2026-07-12');
    expect(buildEventSlug('PLUSONE Launch Night', '2026-12-31')).toBe('plusone-launch-night-2026-12-31');
    expect(buildEventSlug('Summer Rave', '2026-07-12')).toBe('summer-rave-2026-07-12');
  });

  it('falls back to "event" when the name has no usable characters', () => {
    expect(buildEventSlug('!!!', '2026-07-12')).toBe('event-2026-07-12');
    expect(buildEventSlug('', '2026-07-12')).toBe('event-2026-07-12');
  });
});
