import { NextResponse } from 'next/server';
import { appleAppSiteAssociation } from '@/lib/native/app-links';

// iOS universal links (Fase 17 S4). Apple's CDN fetches this over https with no
// session, no redirect allowed, and requires application/json — the middleware
// matcher skips `/.well-known/` so it is never bounced to /login. Content is
// static (constants only), so it is prerendered.
export const dynamic = 'force-static';

export function GET(): NextResponse {
  return NextResponse.json(appleAppSiteAssociation(), {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}
