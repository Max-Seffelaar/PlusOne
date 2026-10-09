// Places proxy (Onboarding A, z8uq9m2vg5; design: spike 9.6). Address
// autocomplete for the company and event forms without a Google key in the
// browser and without the Google JS SDK (webview-safe: a same-origin fetch).
//
// Security checklist (CLAUDE.md):
//  - Session verified server-side with getUser() → 401. The middleware also
//    guards /api/places (only /api/webhooks/ is exempt).
//  - All input through Zod (placesRequestSchema, a discriminated union).
//  - Rate limited per user in the database (consume_places_throttle, 120 per
//    10 minutes) through the user-scoped client, so the key is the caller's
//    own uid. No service role anywhere here.
//  - No PII in logs: the input text is never logged, only status codes.
//  - Generic errors: { ok: false } for every failure. No key on the server is
//    not an error: { enabled: false }, and the client keeps a plain text field.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { placesRequestSchema, type PlacesResponse } from '@/lib/places/schema';
import { placesApiKey, placesAutocomplete, placesDetails } from '@/lib/places/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function reply(body: PlacesResponse, status = 200): NextResponse<PlacesResponse> {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<NextResponse<PlacesResponse>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return reply({ ok: false }, 401);

  const key = placesApiKey();
  if (!key) return reply({ enabled: false });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return reply({ ok: false }, 400);
  }
  const parsed = placesRequestSchema.safeParse(raw);
  if (!parsed.success) return reply({ ok: false }, 400);
  const req = parsed.data;

  const { data: within, error } = await supabase.rpc('consume_places_throttle');
  if (error) {
    console.error('places: throttle failed', { code: error.code });
    return reply({ ok: false }, 503);
  }
  if (within !== true) return reply({ ok: false }, 429);

  if (req.op === 'autocomplete') {
    const suggestions = await placesAutocomplete(key, req.input, req.sessionToken);
    return suggestions ? reply({ ok: true, suggestions }) : reply({ ok: false }, 502);
  }
  const place = await placesDetails(key, req.placeId, req.sessionToken);
  return place ? reply({ ok: true, place }) : reply({ ok: false }, 502);
}
