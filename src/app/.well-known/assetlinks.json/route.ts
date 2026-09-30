import { NextResponse } from 'next/server';
import { androidAssetLinks, parseAndroidFingerprints } from '@/lib/native/app-links';

// Android App Links (Fase 17 S4). The statement is only served once the signing
// fingerprints exist (server env ANDROID_APP_LINK_SHA256, Play Console): absent,
// empty or malformed → 404, never an empty or wildcard statement. Read per
// request so the route never bakes a build-time value.
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  const raw = process.env.ANDROID_APP_LINK_SHA256;
  const fingerprints = parseAndroidFingerprints(raw);
  if (!fingerprints) {
    // Misconfiguration (set but unparseable) goes to the server log only.
    if (raw && raw.trim().length > 0) {
      console.error('[assetlinks] ANDROID_APP_LINK_SHA256 is set but malformed; serving 404');
    }
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json(androidAssetLinks(fingerprints), {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}
