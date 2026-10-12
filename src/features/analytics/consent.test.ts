// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONSENT_STORAGE_KEY,
  CONSENT_VERSION,
  denyAnalytics,
  hasConsent,
  onConsentChange,
  readConsent,
  saveConsent,
} from './consent';

beforeEach(() => window.localStorage.clear());

describe('consent manager', () => {
  it('no decision: only necessary is granted', () => {
    expect(readConsent()).toBeNull();
    expect(hasConsent('necessary')).toBe(true);
    expect(hasConsent('analytics')).toBe(false);
    expect(hasConsent('marketing')).toBe(false);
  });

  it('stores a decision with version and timestamp, and reads it back', () => {
    saveConsent({ analytics: true, marketing: false });
    const raw = JSON.parse(window.localStorage.getItem(CONSENT_STORAGE_KEY) ?? 'null');
    expect(raw).toMatchObject({ version: CONSENT_VERSION, analytics: true, marketing: false });
    expect(typeof raw.decidedAt).toBe('string');
    expect(hasConsent('analytics')).toBe(true);
    expect(hasConsent('marketing')).toBe(false);
  });

  it.each([
    ['not json', '{oops'],
    ['null', 'null'],
    ['a number', '42'],
    ['an older version', JSON.stringify({ version: '2020-01-01', decidedAt: 'x', analytics: true, marketing: true })],
    ['a wrong type', JSON.stringify({ version: CONSENT_VERSION, decidedAt: 'x', analytics: 'yes', marketing: true })],
    ['missing fields', JSON.stringify({ version: CONSENT_VERSION })],
  ])('treats %s as "no decision yet"', (_label, raw) => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, raw);
    expect(readConsent()).toBeNull();
    expect(hasConsent('analytics')).toBe(false);
  });

  it('tells subscribers, and stops after unsubscribe', () => {
    const cb = vi.fn();
    const off = onConsentChange(cb);
    saveConsent({ analytics: false, marketing: false });
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    saveConsent({ analytics: true, marketing: true });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('denyAnalytics keeps the marketing choice', () => {
    saveConsent({ analytics: true, marketing: true });
    denyAnalytics();
    expect(readConsent()).toMatchObject({ analytics: false, marketing: true });
  });

  it('survives a throwing storage (sandboxed webview)', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readConsent()).toBeNull();
    expect(hasConsent('analytics')).toBe(false);
    spy.mockRestore();
  });
});
