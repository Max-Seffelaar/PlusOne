/**
 * /u/[token] (guest mail F): GET never unsubscribes (mail scanners prefetch
 * links), POST does, and the answer never depends on whether the token is
 * valid. The DB side (opt-out row, throttle) is in pgTAP.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ rpc: H.rpc })) }));
vi.mock('@/features/requests/ip-hash', () => ({ landingClientIpHash: async () => 'iphash' }));
vi.mock('@/features/requests/rpc-trust', () => ({ publicRpcTrustHeaders: () => ({ 'x-plusone-throttle-trust': 's' }) }));

import { GET, POST } from './route';

const VALID = 'A'.repeat(43);
const ctx = (token: string) => ({ params: Promise.resolve({ token }) });

beforeEach(() => {
  H.rpc.mockReset();
  H.rpc.mockResolvedValue({ data: { ok: true }, error: null });
});

describe('/u/[token]', () => {
  it('GET shows the confirm button and touches nothing', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<form method="post">');
    expect(H.rpc).not.toHaveBeenCalled();
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it('POST opts out with the token hash only, never the token', async () => {
    const res = await POST(new Request('http://x/u/t', { method: 'POST' }), ctx(VALID));
    expect(res.status).toBe(200);
    const [fn, args] = H.rpc.mock.calls[0] as [string, Record<string, string>];
    expect(fn).toBe('unsubscribe_guest_mail');
    expect(args.p_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(args)).not.toContain(VALID);
  });

  it('a malformed token gets the identical answer (no oracle)', async () => {
    const good = await (await POST(new Request('http://x', { method: 'POST' }), ctx(VALID))).text();
    const bad = await (await POST(new Request('http://x', { method: 'POST' }), ctx('nope'))).text();
    expect(bad).toBe(good);
    expect(H.rpc).toHaveBeenCalledTimes(2);
  });

  it('throttled: 429 with a neutral message, nothing about the token', async () => {
    H.rpc.mockResolvedValue({ data: { ok: false }, error: null });
    const res = await POST(new Request('http://x', { method: 'POST' }), ctx(VALID));
    expect(res.status).toBe(429);
    expect(await res.text()).toContain('Too many tries');
  });
});
