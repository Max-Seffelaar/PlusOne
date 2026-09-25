import { describe, expect, it } from 'vitest';
import { clientIpFromHeaders } from './ip-hash';

// The one shared client-IP precedence (landing throttle + store-review login).
describe('clientIpFromHeaders', () => {
  it('takes the first x-forwarded-for hop, trimmed', () => {
    expect(clientIpFromHeaders(new Headers({ 'x-forwarded-for': ' 203.0.113.7 , 10.0.0.1' }))).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip, then to empty', () => {
    expect(clientIpFromHeaders(new Headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(clientIpFromHeaders(new Headers())).toBe('');
  });

  it('x-forwarded-for wins over x-real-ip', () => {
    expect(clientIpFromHeaders(new Headers({ 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '198.51.100.2' }))).toBe('203.0.113.7');
  });
});
