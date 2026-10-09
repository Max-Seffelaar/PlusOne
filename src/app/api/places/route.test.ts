/**
 * Places proxy route (Onboarding A, z8uq9m2vg5; spike 9.6). Proves the order
 * of the gates (session → key → Zod → throttle → Google), the shapes the
 * client relies on, the cheap field masks, and that the input text never
 * reaches a log.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const H = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  throttle: { data: true as boolean | null, error: null as { code: string } | null },
  rpc: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: H.user } }) },
    rpc: H.rpc,
  }),
}));

import { POST } from './route';
import { mapAddress } from '@/lib/places/server';

const TOKEN = '0b7f5a8e-3c1d-4e2f-9a6b-1c2d3e4f5a6b';
const KEY_ENV = ['GOOGLE', 'PLACES', 'API', 'KEY'].join('_');
const SECRET_INPUT = 'Keizersgracht 123 secret-home';

function post(body: unknown): Request {
  return new Request('http://localhost/api/places', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

let fetchMock: Mock;

beforeEach(() => {
  H.user = { id: 'u1' };
  H.throttle = { data: true, error: null };
  H.rpc.mockReset().mockImplementation(async () => H.throttle);
  process.env[KEY_ENV] = 'test-key';
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  delete process.env[KEY_ENV];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/places — gates', () => {
  it('401 without a session, before anything else', async () => {
    H.user = null;
    const res = await POST(post({ op: 'autocomplete', input: 'Wibaut', sessionToken: TOKEN }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false });
    expect(H.rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no key: 200 { enabled: false }, no throttle spent, no Google call', async () => {
    delete process.env[KEY_ENV];
    const res = await POST(post({ op: 'autocomplete', input: 'Wibaut', sessionToken: TOKEN }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false });
    expect(H.rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['not JSON', '{nope'],
    ['an unknown op', { op: 'nearby', input: 'abc', sessionToken: TOKEN }],
    ['too short an input', { op: 'autocomplete', input: 'ab', sessionToken: TOKEN }],
    ['a non-uuid token', { op: 'autocomplete', input: 'Wibaut', sessionToken: 'x' }],
    ['a place id with a path in it', { op: 'details', placeId: '../v1/x', sessionToken: TOKEN }],
  ])('400 for %s, no throttle spent', async (_label, body) => {
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(H.rpc).not.toHaveBeenCalled();
  });

  it('429 when the per-user budget is spent, no Google call', async () => {
    H.throttle = { data: false, error: null };
    const res = await POST(post({ op: 'autocomplete', input: 'Wibaut', sessionToken: TOKEN }));
    expect(res.status).toBe(429);
    expect(H.rpc).toHaveBeenCalledWith('consume_places_throttle');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/places — Google', () => {
  it('autocomplete: Essentials field mask, the key in a header, only id + texts back', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          suggestions: [
            {
              placePrediction: {
                placeId: 'ChIJ123',
                structuredFormat: { mainText: { text: 'Shelter' }, secondaryText: { text: 'Overhoeksplein 3, Amsterdam' } },
                types: ['night_club'],
              },
            },
            { queryPrediction: { text: { text: 'shelter amsterdam' } } },
          ],
        }),
        { status: 200 },
      ),
    );
    const res = await POST(post({ op: 'autocomplete', input: 'Shelter', sessionToken: TOKEN }));
    expect(await res.json()).toEqual({
      ok: true,
      suggestions: [{ placeId: 'ChIJ123', mainText: 'Shelter', secondaryText: 'Overhoeksplein 3, Amsterdam' }],
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://places.googleapis.com/v1/places:autocomplete');
    expect(init.headers['X-Goog-Api-Key']).toBe('test-key');
    expect(init.headers['X-Goog-FieldMask']).toBe(
      'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat',
    );
    expect(JSON.parse(init.body)).toEqual({
      input: 'Shelter',
      sessionToken: TOKEN,
      languageCode: 'en',
      includedRegionCodes: ['nl', 'be', 'de'],
    });
  });

  it('details: no displayName in the mask, the session token on the URL, mapped address back', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          formattedAddress: 'Overhoeksplein 3, 1031 KS Amsterdam, Netherlands',
          addressComponents: [
            { longText: '3', shortText: '3', types: ['street_number'] },
            { longText: 'Overhoeksplein', shortText: 'Overhoeksplein', types: ['route'] },
            { longText: 'Amsterdam', shortText: 'Amsterdam', types: ['locality', 'political'] },
            { longText: 'Netherlands', shortText: 'NL', types: ['country', 'political'] },
            { longText: '1031 KS', shortText: '1031 KS', types: ['postal_code'] },
          ],
        }),
        { status: 200 },
      ),
    );
    const res = await POST(post({ op: 'details', placeId: 'ChIJ123', sessionToken: TOKEN }));
    expect(await res.json()).toEqual({
      ok: true,
      place: {
        addressLine: 'Overhoeksplein 3',
        postalCode: '1031 KS',
        city: 'Amsterdam',
        country: 'NL',
        formattedAddress: 'Overhoeksplein 3, 1031 KS Amsterdam, Netherlands',
      },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://places.googleapis.com/v1/places/ChIJ123?sessionToken=${TOKEN}&languageCode=en`);
    expect(init.headers['X-Goog-FieldMask']).toBe('addressComponents,formattedAddress');
    expect(init.headers['X-Goog-FieldMask']).not.toMatch(/displayName/);
  });

  it('a Google error is a generic 502, and neither the input nor the key is logged', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValue(new Response(`bad request for ${SECRET_INPUT}`, { status: 400 }));
    const res = await POST(post({ op: 'autocomplete', input: SECRET_INPUT, sessionToken: TOKEN }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false });
    fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    expect((await POST(post({ op: 'autocomplete', input: SECRET_INPUT, sessionToken: TOKEN }))).status).toBe(502);
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain('Keizersgracht');
    expect(logged).not.toContain('test-key');
  });
});

describe('mapAddress', () => {
  it('falls back to postal_town and drops a malformed country code', () => {
    expect(
      mapAddress({
        addressComponents: [
          { longText: 'Bergen op Zoom', types: ['postal_town'] },
          { longText: 'Neverland', shortText: 'neverland', types: ['country'] },
        ],
      }),
    ).toEqual({ addressLine: null, postalCode: null, city: 'Bergen op Zoom', country: null, formattedAddress: null });
  });
});
