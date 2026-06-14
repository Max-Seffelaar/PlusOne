import { describe, it, expect } from 'vitest';
import { slugify, buildEventSlug, isValidCustomSlug, randomSlugSuffix } from './slug';

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
  it('appends the suffix to the slugified name', () => {
    expect(buildEventSlug('FRENZY', 'x4k9')).toBe('frenzy-x4k9');
    expect(buildEventSlug('PLUSONE Launch Night', 'ab12')).toBe('plusone-launch-night-ab12');
  });

  it('falls back to "event" when the name has no usable characters', () => {
    expect(buildEventSlug('!!!', 'zzzz')).toBe('event-zzzz');
    expect(buildEventSlug('', 'zzzz')).toBe('event-zzzz');
  });

  it('uses a random suffix by default', () => {
    const slug = buildEventSlug('Test');
    expect(slug).toMatch(/^test-[a-z0-9]{4}$/);
  });
});

describe('randomSlugSuffix', () => {
  it('produces a lowercase alphanumeric string of the requested length', () => {
    expect(randomSlugSuffix(4)).toMatch(/^[a-z0-9]{4}$/);
    expect(randomSlugSuffix(8)).toMatch(/^[a-z0-9]{8}$/);
  });
});

describe('isValidCustomSlug', () => {
  it('accepts clean lowercase-dash slugs of a sane length', () => {
    expect(isValidCustomSlug('summer-rave')).toBe(true);
    expect(isValidCustomSlug('frenzy')).toBe(true);
    expect(isValidCustomSlug('a-b-c-123')).toBe(true);
  });

  it('rejects bad shapes', () => {
    expect(isValidCustomSlug('Summer-Rave')).toBe(false); // uppercase
    expect(isValidCustomSlug('-leading')).toBe(false);
    expect(isValidCustomSlug('trailing-')).toBe(false);
    expect(isValidCustomSlug('double--dash')).toBe(false);
    expect(isValidCustomSlug('with space')).toBe(false);
    expect(isValidCustomSlug('ab')).toBe(false); // too short
    expect(isValidCustomSlug('x'.repeat(81))).toBe(false); // too long
  });
});
