import 'server-only';

// Auto-reply on noreply@ (Gastcommunicatie F, z8uq9m2vpy; decision Max
// 2026-10-09). Guest mail goes out as "{event} via PlusOne"
// <noreply+<key>@plus-one.io> with reply-to = the company's contact address,
// so a normal reply already reaches the company. This handles the rest: a
// mail client that ignores Reply-To, or someone who copies the sender
// address. Resend's inbound routing posts `email.received` to the one webhook
// endpoint (src/app/api/webhooks/resend); after the Svix signature and the
// ledger (a replay never answers twice) this answers ONCE, with fixed copy:
//   * a known, live key  -> "mail {company} at {contact_email}"
//   * anything else      -> "look in the footer of the email you got"
//
// Never an open relay or a mirror: the answer goes only to the inbound
// sender, nothing of the inbound mail (subject, body, other recipients) is
// read or echoed, and the budget is one answer per sender per 24 hours and
// 200 per hour overall (consume_guest_mail_autoreply). Mailer daemons, our
// own domain and no-reply senders get nothing (no loops). Never logged: the
// sender, the key, the company.

import { createServiceClient } from '@/lib/supabase/service';
import { MAIL_DOMAIN } from './config';
import { escapeHtml, plainLine } from './templates';
import { mailProvider, type MailProvider } from './provider';
import { fmt } from '@/lib/i18n';
import { inboundCopy } from './templates/inbound-copy';

export interface InboundData {
  from?: unknown;
  to?: unknown;
}

export interface InboundDeps {
  resolve(key: string): Promise<{ found: boolean; company?: string | null; contactEmail?: string | null } | null>;
  consume(sender: string): Promise<boolean>;
  provider: Pick<MailProvider, 'send'>;
}

export type InboundOutcome = 'answered' | 'ignored' | 'throttled' | 'failed';

const ADDRESS = /<([^<>\s]+@[^<>\s]+)>|([^<>\s"]+@[^<>\s"]+)/;
const NO_ANSWER_LOCAL = /^(mailer-daemon|postmaster|no-?reply|bounces?|abuse|root|daemon)([+._-]|$)/i;

/** The bare address in `Name <a@b.c>` or `a@b.c`, lower-cased; null when there is none. */
export function bareAddress(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 512) return null;
  const m = ADDRESS.exec(value);
  const addr = (m?.[1] ?? m?.[2] ?? '').trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr) ? addr : null;
}

/** The reply key in noreply+<key>@<our domain>, from any of the recipients. */
export function replyKeyFrom(to: unknown): string | null | undefined {
  const list = Array.isArray(to) ? to : typeof to === 'string' ? [to] : [];
  let sawNoreply = false;
  for (const entry of list.slice(0, 50)) {
    const addr = bareAddress(entry);
    if (!addr) continue;
    const [local, domain] = addr.split('@');
    if (domain !== MAIL_DOMAIN) continue;
    const m = /^noreply(?:\+([0-9a-f]{40}))?$/.exec(local);
    if (!m) continue;
    sawNoreply = true;
    if (m[1]) return m[1];
  }
  // undefined: not addressed to noreply@ at all; null: noreply@ without a key.
  return sawNoreply ? null : undefined;
}

export function shouldAnswer(sender: string | null): sender is string {
  if (!sender) return false;
  const [local, domain] = sender.split('@');
  if (!local || !domain) return false;
  if (domain === MAIL_DOMAIN || domain.endsWith(`.${MAIL_DOMAIN}`)) return false;
  return !NO_ANSWER_LOCAL.test(local);
}

export function renderAutoReply(target: { company: string; contactEmail: string } | null): {
  subject: string;
  html: string;
  text: string;
} {
  const c = inboundCopy;
  const lines = target
    ? [fmt(c.known, { company: plainLine(target.company), contact_email: plainLine(target.contactEmail) })]
    : [c.unknown];
  const text = [...lines, '', c.signoff].join('\n');
  const e = escapeHtml;
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${e(c.subject)}</title></head>
<body style="margin:0;padding:24px;background:#f4f3f8;font-family:'Hanken Grotesk',Helvetica,Arial,sans-serif;color:#0B0B0D;">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
${lines.map((l) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;">${e(l)}</p>`).join('\n')}
<p style="margin:0;font-size:12px;line-height:1.5;color:#77737f;">${e(c.signoff)}</p>
</div>
</body>
</html>`;
  return { subject: c.subject, html, text };
}

/** Answer one inbound mail (already signature-checked and ledgered). Never throws. */
export async function answerInbound(eventId: string, data: InboundData, deps: InboundDeps): Promise<InboundOutcome> {
  try {
    const key = replyKeyFrom(data.to);
    if (key === undefined) return 'ignored';
    const sender = bareAddress(data.from);
    if (!shouldAnswer(sender)) return 'ignored';
    if (!(await deps.consume(sender))) return 'throttled';

    let target: { company: string; contactEmail: string } | null = null;
    if (key) {
      const found = await deps.resolve(key);
      if (found?.found && found.company && found.contactEmail) {
        target = { company: found.company, contactEmail: found.contactEmail };
      }
    }
    const reply = renderAutoReply(target);
    const result = await deps.provider.send({
      to: sender,
      ...reply,
      idempotencyKey: `inbound/${eventId}`,
      type: 'guest_autoreply',
      from: `PlusOne <noreply@${MAIL_DOMAIN}>`,
      headers: { 'Auto-Submitted': 'auto-replied', 'X-Auto-Response-Suppress': 'All' },
    });
    return result.ok ? 'answered' : 'failed';
  } catch {
    return 'failed';
  }
}

export function defaultInboundDeps(): InboundDeps {
  const service = createServiceClient();
  const rpc = service.rpc.bind(service) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { code?: string } | null }>;
  return {
    resolve: async (key) => {
      const { data, error } = await rpc('resolve_guest_mail_reply', { p_reply_key: key });
      if (error || !data || typeof data !== 'object') return null;
      const d = data as Record<string, unknown>;
      return {
        found: d.found === true,
        company: typeof d.company === 'string' ? d.company : null,
        contactEmail: typeof d.contact_email === 'string' ? d.contact_email : null,
      };
    },
    consume: async (sender) => {
      const { data, error } = await rpc('consume_guest_mail_autoreply', { p_sender: sender });
      return !error && data === true;
    },
    provider: mailProvider,
  };
}
