// Guest-mail opt-out (/u/[token], guest mail F, z8uq9m2vpy). Public, no session.
//
//   GET   a confirm page with one button. GET never unsubscribes: mail
//         scanners (Outlook Safe Links, corporate gateways) prefetch every
//         link in a mail, and a GET that acted would opt guests out unasked.
//   POST  opt out: the page's button, and RFC 8058 one-click from the
//         List-Unsubscribe-Post header every guest mail carries (Gmail/Yahoo).
//
// No oracle: the token's validity changes nothing a caller can see. Both
// methods answer the same page whether the token is live, expired, unknown or
// malformed; the page names no company, event or address. The only other
// answer is "too many tries" when the 'st' throttle (shared with the status
// pages, 30 per 15 minutes per IP) refuses, which says nothing about the token.
// Only the sha256 of the token reaches the database (unsubscribe_guest_mail).
// The guest stays on the list: this only records a company + address-hash
// opt-out that the mail job honours before every send.

import { landingClientIpHash } from '@/features/requests/ip-hash';
import { publicRpcTrustHeaders } from '@/features/requests/rpc-trust';
import { STATUS_TOKEN, tokenHash } from '@/features/mail/guest-status-fetch';
import { escapeHtml } from '@/features/mail/templates';
import { createClient } from '@/lib/supabase/server';
import { t } from '@/lib/i18n';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
  'X-Frame-Options': 'DENY',
  // No script at all; the form posts to this same URL.
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

function page(title: string, body: string, form: boolean): string {
  const e = escapeHtml;
  const u = t.guestStatus.unsubscribe;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${e(u.pageTitle)}</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px 18px;background:#0B0B0D;color:#F4F3F8;font-family:'Hanken Grotesk',Helvetica,Arial,sans-serif;">
<main data-testid="unsubscribe" style="width:100%;max-width:420px;border:1px solid #2a2833;border-radius:24px;background:#16151c;padding:32px 26px;text-align:center;">
<h1 style="margin:0 0 12px;font-size:24px;line-height:1.2;">${e(title)}</h1>
<p style="margin:0 0 22px;font-size:15px;line-height:1.55;color:#b9b6c4;">${e(body)}</p>
${form ? `<form method="post"><button type="submit" style="min-height:48px;width:100%;border:0;border-radius:12px;background:#B5A6FF;color:#0B0B0D;font-size:16px;font-weight:700;cursor:pointer;">${e(u.confirm)}</button></form>` : ''}
</main>
</body>
</html>`;
}

export async function GET(): Promise<Response> {
  const u = t.guestStatus.unsubscribe;
  return new Response(page(u.title, u.body, true), { status: 200, headers: HEADERS });
}

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const u = t.guestStatus.unsubscribe;
  const { token } = await params;
  const supabase = await createClient({ headers: publicRpcTrustHeaders() });
  const { data, error } = await supabase.rpc('unsubscribe_guest_mail', {
    // A malformed token still goes through the RPC (with a hash nothing
    // matches), so it costs the same budget and answers the same way.
    p_token_hash: tokenHash(STATUS_TOKEN.test(token) ? token : `invalid:${token.slice(0, 64)}`),
    p_ip_hash: await landingClientIpHash(),
  });
  const ok = !error && data && typeof data === 'object' && (data as { ok?: unknown }).ok === true;
  if (error) console.error('unsubscribe_guest_mail failed', { code: error.code });
  if (!ok) {
    return new Response(page(u.title, u.throttled, false), { status: 429, headers: HEADERS });
  }
  return new Response(page(u.doneTitle, u.doneBody, false), { status: 200, headers: HEADERS });
}
