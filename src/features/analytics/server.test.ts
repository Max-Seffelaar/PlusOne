import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ph = vi.hoisted(() => ({
  ctor: vi.fn(),
  captureImmediate: vi.fn(async () => undefined),
  shutdown: vi.fn(async () => undefined),
  imported: vi.fn(),
}));
vi.mock('posthog-node', () => {
  ph.imported();
  return {
    PostHog: class {
      constructor(key: string, opts: unknown) {
        ph.ctor(key, opts);
      }
      captureImmediate = ph.captureImmediate;
      shutdown = ph.shutdown;
    },
  };
});

import { captureServerEvent, sendServerEvent } from './server';

function supabaseWith(result: { data: unknown; error: unknown } | 'throw') {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => {
      if (result === 'throw') throw new Error('boom');
      return result;
    },
  };
  return { rpc: vi.fn(() => chain) } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  delete process.env.POSTHOG_KEY;
  delete process.env.POSTHOG_HOST;
});

describe('server analytics', () => {
  it('without POSTHOG_KEY: no read, no import, nothing sent', async () => {
    const sb = supabaseWith({ data: { analytics_opt_out_at: null }, error: null });
    await captureServerEvent(sb, 'u1', { event: 'venue_created', venue_id: 'v1' });
    expect((sb as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled();
    expect(ph.imported).not.toHaveBeenCalled();
    expect(ph.captureImmediate).not.toHaveBeenCalled();
  });

  it('sends immediately to PostHog EU with the user UUID as distinct id', async () => {
    process.env.POSTHOG_KEY = 'phc_server';
    await captureServerEvent(supabaseWith({ data: { analytics_opt_out_at: null }, error: null }), 'u1', {
      event: 'venue_created',
      venue_id: 'v1',
    });
    expect(ph.ctor).toHaveBeenCalledWith('phc_server', expect.objectContaining({ host: 'https://eu.i.posthog.com', flushAt: 1, flushInterval: 0 }));
    expect(ph.captureImmediate).toHaveBeenCalledWith({ distinctId: 'u1', event: 'venue_created', properties: { venue_id: 'v1' } });
    expect(ph.shutdown).toHaveBeenCalled();
  });

  it.each([
    ['opted out', { data: { analytics_opt_out_at: '2026-10-18T10:00:00Z' }, error: null }],
    ['an error (column not pushed yet)', { data: null, error: { code: '42703' } }],
    ['no row', { data: null, error: null }],
    ['a throw', 'throw' as const],
  ])('%s → not sent (fail closed)', async (_l, res) => {
    process.env.POSTHOG_KEY = 'phc_server';
    await captureServerEvent(supabaseWith(res as never), 'u1', { event: 'user_signed_up', via: 'invite' });
    expect(ph.captureImmediate).not.toHaveBeenCalled();
  });

  it('never throws, even when PostHog does', async () => {
    process.env.POSTHOG_KEY = 'phc_server';
    ph.captureImmediate.mockRejectedValueOnce(new Error('network'));
    await expect(sendServerEvent('u1', { event: 'venue_created', venue_id: 'v1' })).resolves.toBeUndefined();
  });
});
