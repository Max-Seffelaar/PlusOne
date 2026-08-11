/**
 * Guards the #0b fix: BOTH browser clients must raise the realtime throttle to
 * REALTIME_EVENTS_PER_SECOND (200), or busy-door check-in bursts get silently
 * dropped at supabase-js's default of 10 ev/s.
 *
 * We mock `@supabase/ssr` so `createBrowserClient` is a spy and assert the exact
 * option path it receives: `options.realtime.params.eventsPerSecond`. The door
 * client is a memoised singleton, so each case runs after `vi.resetModules()` to
 * re-import a fresh factory + a fresh, un-cached door client.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Typed so `.mock.calls[0][2]` (the options arg) is well-typed under strict TS.
type BrowserClientOptions = {
  global?: { headers?: Record<string, string> };
  realtime?: { params?: { eventsPerSecond?: number } };
};
const createBrowserClient = vi.fn(
  (_url: string, _key: string, _options?: BrowserClientOptions) => ({ __fake: 'client' }),
);

vi.mock('@supabase/ssr', () => ({ createBrowserClient }));

beforeEach(() => {
  vi.resetModules();
  createBrowserClient.mockClear();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('realtime throttle is raised on both browser clients (#0b)', () => {
  it('the generic createClient passes eventsPerSecond = REALTIME_EVENTS_PER_SECOND', async () => {
    const mod = await import('./client');
    mod.createClient();

    expect(createBrowserClient).toHaveBeenCalledTimes(1);
    const options = createBrowserClient.mock.calls[0][2];
    expect(options?.realtime?.params?.eventsPerSecond).toBe(200);
    expect(options?.realtime?.params?.eventsPerSecond).toBe(mod.REALTIME_EVENTS_PER_SECOND);
  });

  // Timeout raised off the 5s default: `vi.resetModules()` forces this case to
  // re-import the door client's whole graph, which drags the ~2300-line
  // generated database.types.ts through the transform pipeline. On a cold Vite
  // cache (every CI run, and locally right after the types are regenerated) that
  // alone can exceed 5s and fail a test that is only asserting one option value.
  it('the door getDoorClient passes eventsPerSecond = REALTIME_EVENTS_PER_SECOND', { timeout: 30_000 }, async () => {
    // The door client reads getDeviceId() from localStorage; stub a browser env.
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => 'device-test-id',
        setItem: () => undefined,
      },
    });

    const constMod = await import('./client');
    const deviceMod = await import('@/features/door/offline/device');
    deviceMod.getDoorClient();

    expect(createBrowserClient).toHaveBeenCalledTimes(1);
    const options = createBrowserClient.mock.calls[0][2];
    // Raised throttle…
    expect(options?.realtime?.params?.eventsPerSecond).toBe(200);
    expect(options?.realtime?.params?.eventsPerSecond).toBe(constMod.REALTIME_EVENTS_PER_SECOND);
    // …without clobbering the existing device header (audit #25).
    expect(options?.global?.headers?.['x-device-id']).toBe('device-test-id');
    // `vi.resetModules()` + this cold dynamic import transforms the whole door
    // device graph inside the test body, which lands within a few hundred ms of
    // the 5s default while the rest of the suite is transforming in parallel —
    // an assertion about an options object should never be decided by machine
    // load, so give it room via the `{ timeout }` option above (86ey9e9p5 + 86ey9e9q2).
  });
});
