import { describe, it, expect } from 'vitest';
import { isValidEmail } from './validation';

describe('isValidEmail', () => {
  it('accepts well-formed addresses', () => {
    expect(isValidEmail('jip@voorbeeld.nl')).toBe(true);
    expect(isValidEmail('  a.b@c.co  ')).toBe(true);
    expect(isValidEmail('noa.bos+guest@sub.example-club.amsterdam')).toBe(true);
  });

  it('rejects malformed ones', () => {
    expect(isValidEmail('nope')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a @b.nl')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });

  // 86eyd3men: the old regex (`[^\s@]+@[^\s@]+\.[^\s@]+`) let clear nonsense
  // through as long as there was one @ and one dot anywhere in the domain.
  it('rejects shapes the old permissive regex let through', () => {
    expect(isValidEmail('max@hoiu.d')).toBe(false); // 1-char TLD
    expect(isValidEmail('max@hoiu.1')).toBe(false); // numeric TLD
    expect(isValidEmail('max@hoiu..com')).toBe(false); // double dot
    expect(isValidEmail('max@.hoiu.com')).toBe(false); // leading dot in domain
    expect(isValidEmail('max@hoiu.com.')).toBe(false); // trailing dot
    expect(isValidEmail('.max@hoiu.com')).toBe(false); // leading dot in local part
    expect(isValidEmail('ma..x@hoiu.com')).toBe(false); // double dot in local part
    expect(isValidEmail('max@-hoiu.com')).toBe(false); // leading hyphen label
  });
});
