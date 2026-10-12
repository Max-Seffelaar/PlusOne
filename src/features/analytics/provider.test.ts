// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A fake posthog-js: records every call in order. Loaded only through the
// adapter's dynamic import, exactly like the real one.
const calls: string[] = [];
const fake = {
  init: vi.fn(() => calls.push('init')),
  identify: vi.fn((id: string) => calls.push(`identify:${id}`)),
  register: vi.fn(() => calls.push('register')),
  group: vi.fn((t: string, k: string) => calls.push(`group:${t}:${k}`)),
  capture: vi.fn((name: string) => calls.push(`capture:${name}`)),
  opt_out_capturing: vi.fn(() => calls.push('opt_out')),
  opt_in_capturing: vi.fn(() => calls.push('opt_in')),
  has_opted_out_capturing: vi.fn(() => false),
  reset: vi.fn(() => calls.push('reset')),
  debug: vi.fn(),
};
const importSpy = vi.fn();
vi.mock('posthog-js', () => {
  importSpy();
  return { default: fake };
});

let key = '';
vi.mock('./config', async (orig) => {
  const real = await orig<typeof import('./config')>();
  return {
    ...real,
    get POSTHOG_KEY() {
      return key;
    },
    analyticsConfigured: () => key.length > 0,
  };
});

async function fresh() {
  vi.resetModules();
  return (await import('./provider')).analytics;
}

const ID = { userId: 'u-1', venueId: 'v-1', roles: ['admin'], surface: 'po' as const };

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  window.localStorage.clear();
});
afterEach(() => {
  key = '';
});

describe('analytics adapter — no key', () => {
  it('is a no-op: never loads posthog-js, never queues, never stores', async () => {
    key = '';
    const analytics = await fresh();
    analytics.capture({ event: 'screen_viewed', screen: 'home' });
    await analytics.enable(ID);
    analytics.optOut();
    analytics.reset();
    expect(importSpy).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(analytics.state()).toBe('off');
    expect(analytics.isEnabled()).toBe(false);
    expect(window.localStorage.length).toBe(0);
  });
});

describe('analytics adapter — with a key', () => {
  beforeEach(() => {
    key = 'phc_test';
  });

  it('holds a capture made before enable() and sends it only after identify', async () => {
    const analytics = await fresh();
    analytics.capture({ event: 'screen_viewed', screen: 'home' });
    expect(importSpy).not.toHaveBeenCalled(); // queued in memory, nothing loaded
    await analytics.enable(ID);
    expect(calls).toEqual(['init', 'identify:u-1', 'register', 'group:venue:v-1', 'capture:screen_viewed']);
    expect(fake.identify).toHaveBeenCalledWith('u-1', { venue_id: 'v-1', roles: ['admin'] });
    expect(fake.register).toHaveBeenCalledWith({ venue_id: 'v-1', roles: ['admin'], app_surface: 'po' });
    expect(fake.capture).toHaveBeenCalledWith('screen_viewed', { screen: 'home' });
  });

  it('sends straight away once on', async () => {
    const analytics = await fresh();
    await analytics.enable(ID);
    analytics.capture({ event: 'app_opened', surface: 'po' });
    expect(calls.at(-1)).toBe('capture:app_opened');
    expect(analytics.isEnabled()).toBe(true);
  });

  it('disable() drops the queue and sends nothing afterwards', async () => {
    const analytics = await fresh();
    analytics.capture({ event: 'screen_viewed', screen: 'home' });
    analytics.disable();
    analytics.capture({ event: 'screen_viewed', screen: 'events' });
    expect(analytics.state()).toBe('off');
    expect(importSpy).not.toHaveBeenCalled();
    expect(fake.capture).not.toHaveBeenCalled();
  });

  it('a disable() during loading wins over the slower enable()', async () => {
    const analytics = await fresh();
    analytics.capture({ event: 'screen_viewed', screen: 'home' });
    const p = analytics.enable(ID);
    analytics.disable();
    await p;
    expect(analytics.state()).toBe('off');
    expect(fake.identify).not.toHaveBeenCalled();
    expect(fake.capture).not.toHaveBeenCalled();
  });

  it('discardPending() forgets queued events without deciding', async () => {
    const analytics = await fresh();
    analytics.capture({ event: 'landing_viewed' });
    analytics.discardPending();
    expect(analytics.state()).toBe('idle');
    await analytics.enable();
    expect(fake.capture).not.toHaveBeenCalled();
  });

  it('optOut() stops, clears PostHog storage and denies the analytics category', async () => {
    const analytics = await fresh();
    await analytics.enable(ID);
    window.localStorage.setItem('ph_phc_test_posthog', '{"distinct_id":"u-1"}');
    window.localStorage.setItem('__ph_opt_in_out_phc_test', '1');
    window.localStorage.setItem('unrelated', 'keep');
    analytics.optOut();
    expect(fake.opt_out_capturing).toHaveBeenCalled();
    expect(window.localStorage.getItem('ph_phc_test_posthog')).toBeNull();
    expect(window.localStorage.getItem('__ph_opt_in_out_phc_test')).toBeNull();
    expect(window.localStorage.getItem('unrelated')).toBe('keep');
    const { readConsent } = await import('./consent');
    expect(readConsent()?.analytics).toBe(false);
    analytics.capture({ event: 'screen_viewed', screen: 'home' });
    expect(fake.capture).not.toHaveBeenCalled();
  });

  it('re-enabling after an opt-out lifts PostHog\'s own opt-out marker', async () => {
    const analytics = await fresh();
    fake.has_opted_out_capturing.mockReturnValueOnce(true);
    await analytics.enable(ID);
    expect(fake.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: null });
  });

  it('reset() (sign-out) forgets the device identity', async () => {
    const analytics = await fresh();
    await analytics.enable(ID);
    window.localStorage.setItem('ph_phc_test_posthog', '{"distinct_id":"u-1"}');
    analytics.reset();
    expect(fake.reset).toHaveBeenCalled();
    expect(window.localStorage.getItem('ph_phc_test_posthog')).toBeNull();
    expect(analytics.state()).toBe('idle');
  });

  it('reset() works when posthog-js was never loaded on this page', async () => {
    const analytics = await fresh();
    window.localStorage.setItem('ph_phc_test_posthog', '{"distinct_id":"u-1"}');
    analytics.reset();
    expect(importSpy).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('ph_phc_test_posthog')).toBeNull();
  });

  it('an anonymous enable() (public page) identifies nobody', async () => {
    const analytics = await fresh();
    await analytics.enable();
    expect(fake.identify).not.toHaveBeenCalled();
    expect(fake.register).not.toHaveBeenCalled();
    expect(analytics.isEnabled()).toBe(true);
  });

  it('inits with the safe config: /ingest, no autocapture, no pageviews, no replay, no flags', async () => {
    const analytics = await fresh();
    await analytics.enable();
    const [k, cfg] = fake.init.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(k).toBe('phc_test');
    expect(cfg).toMatchObject({
      api_host: '/ingest',
      persistence: 'localStorage',
      person_profiles: 'identified_only',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
    });
  });
});
