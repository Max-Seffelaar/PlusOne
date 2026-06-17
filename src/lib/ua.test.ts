import { describe, it, expect } from 'vitest';
import { isMobileUA } from './ua';

describe('isMobileUA', () => {
  it('returns true for mobile user-agents', () => {
    // iPhone Safari
    expect(
      isMobileUA(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe(true);
    // Android Chrome phone
    expect(
      isMobileUA(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe(true);
    // Classic iPad (pre-iPadOS-13 desktop UA)
    expect(
      isMobileUA(
        'Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe(true);
    // Generic Android token
    expect(isMobileUA('Mozilla/5.0 (Linux; Android 10)')).toBe(true);
    // Windows Phone
    expect(isMobileUA('Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1) Mobile')).toBe(true);
  });

  it('returns false for desktop user-agents', () => {
    // Windows desktop Chrome
    expect(
      isMobileUA(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ),
    ).toBe(false);
    // macOS desktop Safari
    expect(
      isMobileUA(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      ),
    ).toBe(false);
    // Linux Firefox
    expect(
      isMobileUA('Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0'),
    ).toBe(false);
  });

  it('returns false for empty or missing user-agents', () => {
    expect(isMobileUA('')).toBe(false);
    expect(isMobileUA(null)).toBe(false);
    expect(isMobileUA(undefined)).toBe(false);
  });
});
