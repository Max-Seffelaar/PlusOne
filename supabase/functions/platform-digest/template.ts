// platform-digest mail template (z8uq9m2ybj). Pure: numbers in, subject/html/
// text out. Lives beside the Edge Function rather than in src/features/mail
// because the Deno bundle cannot resolve the app's `@/` alias or its
// `server-only` modules; escapeHtml/plainLine follow
// src/features/mail/templates.ts exactly.
//
// Copy is English (the only locale) and kept here, not in src/lib/i18n: this
// is an internal operations mail to the platform admins, never a venue- or
// guest-facing surface. Chosen variants: see the PR body (docs/copy-prompt.md).
//
// Content rule: aggregates only. The input type has no field that could carry
// a company name, a guest or a contact detail.

export interface DigestSubscriptions {
  total_companies: number;
  trialing: number;
  trial_lapsed: number;
  paid_monthly: number;
  paid_yearly: number;
  paid_unknown: number;
  past_due: number;
  canceled: number;
  comped: number;
  no_subscription: number;
}

export interface DigestFunnel {
  ending_7d: number;
  ended_30d: number;
  converted_30d: number;
  ended_90d: number;
  converted_90d: number;
  canceled_30d: number;
}

export interface DigestUsage {
  active_companies: number;
  events: number;
  check_ins: number;
  dormant_companies: number;
}

export interface DigestNumbers {
  /** Amsterdam calendar date, YYYY-MM-DD. */
  digest_date: string;
  subscriptions: DigestSubscriptions;
  funnel: DigestFunnel;
  usage: DigestUsage;
}

export interface RenderedDigest {
  subject: string;
  html: string;
  text: string;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/** One line of plain text (subject safety: no CR/LF header injection). */
export function plainLine(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex -- stripping control chars is the point
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-08" -> "Thu 8 Oct". Calendar arithmetic only: no time zone involved. */
export function formatDigestDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return 'today';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return 'today';
  return `${WEEKDAYS[date.getUTCDay()]} ${d} ${MONTHS[mo - 1]}`;
}

/** A count from the database, defensively: anything not a whole number >= 0 reads 0. */
function n(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

interface Section {
  heading: string;
  rows: [label: string, value: string][];
  note?: string;
}

function sectionsFor(d: DigestNumbers): Section[] {
  const s = d.subscriptions;
  const f = d.funnel;
  const u = d.usage;
  const paying = n(s.paid_monthly) + n(s.paid_yearly) + n(s.paid_unknown);
  return [
    {
      heading: 'Companies',
      rows: [
        ['All companies', String(n(s.total_companies))],
        ['Paying', String(paying)],
        ['Monthly', String(n(s.paid_monthly))],
        ['Yearly', String(n(s.paid_yearly))],
        ...(n(s.paid_unknown) > 0 ? ([['Paying, interval unknown', String(n(s.paid_unknown))]] as [string, string][]) : []),
        ['In trial', String(n(s.trialing))],
        ['Trial ended, not paying', String(n(s.trial_lapsed))],
        ['Past due', String(n(s.past_due))],
        ['Canceled', String(n(s.canceled))],
        ['Always free', String(n(s.comped))],
        ...(n(s.no_subscription) > 0 ? ([['No subscription', String(n(s.no_subscription))]] as [string, string][]) : []),
      ],
      note: 'Revenue (MRR and ARR) is on the Overview screen. This mail does not read Stripe prices.',
    },
    {
      heading: 'Trials',
      rows: [
        ['Ending in the next 7 days', String(n(f.ending_7d))],
        ['Ended in the last 30 days', `${n(f.ended_30d)}, ${n(f.converted_30d)} now paying`],
        ['Ended in the last 90 days', `${n(f.ended_90d)}, ${n(f.converted_90d)} now paying`],
        ['Canceled in the last 30 days', String(n(f.canceled_30d))],
      ],
    },
    {
      heading: 'Last 30 days',
      rows: [
        ['Companies with an event', String(n(u.active_companies))],
        ['Events', String(n(u.events))],
        ['Check-ins', String(n(u.check_ins))],
        ['Dormant companies', String(n(u.dormant_companies))],
      ],
      note: 'Dormant: no login and no event in the last 30 days.',
    },
  ];
}

export const DIGEST_FOOTER_REASON = 'You get this mail because you are a PlusOne platform admin.';
export const DIGEST_FOOTER_SUPPORT = 'Questions? Mail support@plus-one.io.';

/**
 * @param overviewUrl Absolute URL of Platform > Overview, or null to leave the
 *                    link out (the function never guesses an app origin).
 */
export function renderPlatformDigest(d: DigestNumbers, overviewUrl: string | null): RenderedDigest {
  const day = formatDigestDate(d.digest_date);
  const companies = n(d.subscriptions.total_companies);
  const ending = n(d.funnel.ending_7d);
  const subject = plainLine(
    `PlusOne today: ${plural(companies, 'company', 'companies')}, ${plural(ending, 'trial', 'trials')} ending`
  );
  const heading = `Your platform numbers for ${day}`;
  const intro = 'Counts only. No company names, no guests.';
  const sections = sectionsFor(d);
  const linkLabel = 'Open the Overview';

  const text = [
    heading,
    '',
    intro,
    '',
    ...sections.flatMap((sec) => [
      sec.heading,
      ...sec.rows.map(([label, value]) => `  ${label}: ${value}`),
      ...(sec.note ? [sec.note] : []),
      '',
    ]),
    ...(overviewUrl ? [`${linkLabel}: ${overviewUrl}`, ''] : []),
    '--',
    DIGEST_FOOTER_REASON,
    DIGEST_FOOTER_SUPPORT,
  ].join('\n');

  const e = escapeHtml;
  const sectionHtml = sections
    .map(
      (sec) => `<h2 style="margin:24px 0 8px;font-size:16px;line-height:1.3;">${e(sec.heading)}</h2>
<table role="presentation" style="width:100%;border-collapse:collapse;font-size:15px;line-height:1.5;">
${sec.rows
  .map(
    ([label, value]) =>
      `<tr><td style="padding:4px 0;border-bottom:1px solid #eeedf3;">${e(label)}</td><td style="padding:4px 0;border-bottom:1px solid #eeedf3;text-align:right;font-weight:600;">${e(value)}</td></tr>`
  )
  .join('\n')}
</table>${sec.note ? `\n<p style="margin:8px 0 0;font-size:13px;line-height:1.5;color:#55525e;">${e(sec.note)}</p>` : ''}`
    )
    .join('\n');

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head>
<body style="margin:0;padding:24px;background:#f4f3f8;font-family:'Hanken Grotesk',Helvetica,Arial,sans-serif;color:#0B0B0D;">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
<p style="margin:0 0 24px;font-weight:700;font-size:18px;">PlusOne</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${e(heading)}</h1>
<p style="margin:0 0 8px;font-size:16px;line-height:1.5;">${e(intro)}</p>
${sectionHtml}
${
  overviewUrl
    ? `<p style="margin:24px 0 24px;"><a href="${e(overviewUrl)}" style="display:inline-block;background:#B5A6FF;color:#0B0B0D;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px;">${e(linkLabel)}</a></p>`
    : ''
}
<hr style="border:none;border-top:1px solid #e6e4ee;margin:24px 0 16px;">
<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#77737f;">${e(DIGEST_FOOTER_REASON)}</p>
<p style="margin:0;font-size:12px;line-height:1.5;color:#77737f;">${e(DIGEST_FOOTER_SUPPORT)}</p>
</div>
</body>
</html>`;

  return { subject, html, text };
}
