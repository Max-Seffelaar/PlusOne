import { describe, it, expect } from 'vitest';
import { isValidEmail } from './validation';

describe('isValidEmail', () => {
  it('accepts well-formed addresses', () => {
    expect(isValidEmail('jip@voorbeeld.nl')).toBe(true);
    expect(isValidEmail('  a.b@c.co  ')).toBe(true);
  });

  it('rejects malformed ones', () => {
    expect(isValidEmail('nope')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a @b.nl')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
});
