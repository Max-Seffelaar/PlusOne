// Billing-mail renderer (Billing-mails B1, z8uq9m2z19). Pure: copy in
// (./billing-copy.ts), subject/html/text out. Same injection rules as the team
// mails (../templates.ts), tested in billing-mails.test.ts:
//   * Body: every variable is HTML-escaped AFTER interpolation into plain copy,
//     so a company name like `<a href=…>` renders as text.
//   * Subject: plain text (no entities), control characters stripped
//     (header injection), each name capped in length.
// The button always points at a page of the WEB app (Billing, or new event
// for the welcome mail): /app/* is never claimed by the native shell's
// universal links (src/lib/native/app-links.ts), so the link opens the
// browser, where Billing has its payment buttons. No amounts, no prices.

import { fmt } from '@/lib/i18n';
import { escapeHtml, plainLine, type RenderedMail } from '../templates';
import type { BillingMailType } from '@/features/billing/mail-schedule';
import { billingMailCopy, billingMailShared } from './billing-copy';

/** The sender for billing mail: replyable, answered by the PlusOne team. */
export const BILLING_MAIL_FROM = 'PlusOne <support@plus-one.io>';
export const BILLING_MAIL_REPLY_TO = 'support@plus-one.io';

const NAME_MAX = 80;
const BILLING_TZ = 'Europe/Amsterdam';

export interface BillingMailContent {
  type: BillingMailType;
  firstName: string | null;
  companyName: string;
  /** Effective trial end (ISO). Required by the trial mails; ignored by the Stripe ones. */
  trialEndsAt: string | null;
}

function cleanName(value: string): string {
  const line = plainLine(value);
  return line.length > NAME_MAX ? `${line.slice(0, NAME_MAX - 1)}…` : line;
}

/** "27 October": the calendar day in Amsterdam of the trial end moment. */
export function trialEndDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: BILLING_TZ, day: 'numeric', month: 'long' }).format(d);
}

export function renderBillingMail(content: BillingMailContent, appUrl: string): RenderedMail {
  const copy = billingMailCopy[content.type];
  const shared = billingMailShared;
  const base = appUrl.replace(/\/+$/, '');
  const ctaUrl = `${base}${copy.path}`;
  const firstName = cleanName(content.firstName ?? '');
  const vars: Record<string, string> = {
    first_name: firstName,
    company: cleanName(content.companyName),
    trial_end_date: trialEndDate(content.trialEndsAt),
    cta_url: ctaUrl,
  };
  const fill = (s: string) => fmt(s, vars);

  const subject = plainLine(fill(copy.subject));
  const preheader = plainLine(fill(copy.preheader));
  const heading = fill(copy.heading);
  const greeting = firstName ? fill(shared.greeting) : shared.greetingNoName;
  const paragraphs = copy.paragraphs.map(fill);
  const fallback = fill(shared.linkFallback);
  const footer = [
    fill(shared.footerReason),
    ...(copy.invoicesLine ? [shared.stripeInvoices] : []),
    shared.footerReply,
  ];

  // Plain-text alternative (deliverability): same content, link spelled out.
  const text = [
    heading,
    '',
    greeting,
    ...paragraphs.flatMap((p) => [p, '']),
    `${copy.button}: ${ctaUrl}`,
    '',
    '--',
    ...footer,
  ].join('\n');

  // No images, by decision (deliverability + no remote content). Same frame
  // as the team mails. The preheader is the hidden inbox-preview line.
  const e = escapeHtml;
  const P = 'margin:0 0 16px;font-size:16px;line-height:1.5;';
  const F = 'margin:0 0 8px;font-size:12px;line-height:1.5;color:#77737f;';
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head>
<body style="margin:0;padding:24px;background:#f4f3f8;font-family:'Hanken Grotesk',Helvetica,Arial,sans-serif;color:#0B0B0D;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${e(preheader)}</div>
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
<p style="margin:0 0 24px;font-weight:700;font-size:18px;">PlusOne</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${e(heading)}</h1>
<p style="${P}">${e(greeting)}</p>
${paragraphs.map((p) => `<p style="${P}">${e(p)}</p>`).join('\n')}
<p style="margin:8px 0 12px;"><a href="${e(ctaUrl)}" style="display:inline-block;background:#B5A6FF;color:#0B0B0D;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px;">${e(copy.button)}</a></p>
<p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#55525e;word-break:break-all;overflow-wrap:anywhere;">${e(fallback)}</p>
<hr style="border:none;border-top:1px solid #e6e4ee;margin:8px 0 16px;">
${footer.map((line) => `<p style="${F}">${e(line)}</p>`).join('\n')}
</div>
</body>
</html>`;

  return { subject, html, text };
}
