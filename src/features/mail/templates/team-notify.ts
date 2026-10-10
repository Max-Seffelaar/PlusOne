// Team notification mails (Gastcommunicatie F, PR 6b): a guest-list request,
// a quota request, the quota decision and the daily summary. Pure: content in,
// subject/html/text out. Same frame as the guest and billing mails (no
// images); every value is cleaned (plainLine) and escaped after filling.

import { fmt } from '@/lib/i18n';
import { escapeHtml, plainLine } from '../templates';
import { eventDate, eventTime, peopleLabel } from './guest-mails';
import { teamNotifyCopy as c } from './team-notify-copy';

export type TeamNotifyType = 'team_request' | 'team_quota' | 'team_decision' | 'team_digest';

export interface TeamNotifyEvent {
  id: string;
  name: string;
  startsAt: string;
}

export interface TeamDigestCompany {
  name: string;
  events: Array<{ name: string; startsAt: string; requests: number; quota: number }>;
}

export interface TeamNotifyContent {
  type: TeamNotifyType;
  firstName: string | null;
  company: string;
  event: TeamNotifyEvent | null;
  /** Requests in this mail (a bundled hour is more than one). */
  count: number;
  request?: { firstName: string | null; plusOnes: number } | null;
  quota?: { requester: string; extra: number } | null;
  decision?: { status: 'approved' | 'denied'; extra: number } | null;
  digest?: TeamDigestCompany[] | null;
  appUrl: string;
  unsubscribeUrl: string;
}

export interface RenderedTeamNotify {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  buttonUrl: string;
}

const NAME_MAX = 80;

function clean(value: string, max = NAME_MAX): string {
  return plainLine(value).slice(0, max).trim();
}

export function renderTeamNotify(content: TeamNotifyContent): RenderedTeamNotify {
  const base = content.appUrl.replace(/\/$/, '');
  const ev = content.event;
  const eventQuery = ev ? `?event=${encodeURIComponent(ev.id)}` : '';
  const vars: Record<string, string | number> = {
    first_name: clean(content.firstName ?? ''),
    event_name: ev ? clean(ev.name) : '',
    event_date: ev ? eventDate(ev.startsAt) : '',
    event_time: ev ? eventTime(ev.startsAt) : '',
    count: content.count,
  };
  const fill = (s: string, extra: Record<string, string | number> = {}) => fmt(s, { ...vars, ...extra });

  let subject: string;
  let intro: string;
  let button: string;
  let buttonUrl: string;
  const details: string[] = [];
  const digestBlocks: Array<{ company: string; lines: string[] }> = [];

  if (content.type === 'team_request') {
    const r = content.request;
    const guest = r?.firstName ? clean(r.firstName) : '';
    const people = peopleLabel(Math.max(0, Math.trunc(r?.plusOnes ?? 0)) + 1);
    if (content.count > 1) {
      subject = fill(c.request.subjectMany);
      intro = fill(c.request.introMany);
    } else {
      subject = fill(guest ? c.request.subject : c.request.subjectNoName, { guest_first_name: guest });
      intro = fill(guest ? c.request.intro : c.request.introNoName, { guest_first_name: guest, people });
    }
    button = c.request.button;
    buttonUrl = `${base}/app/requests${eventQuery}`;
  } else if (content.type === 'team_quota') {
    const q = content.quota;
    const extra = { requester: clean(q?.requester ?? ''), extra: Math.max(0, Math.trunc(q?.extra ?? 0)) };
    subject = fill(content.count > 1 ? c.quota.subjectMany : c.quota.subject, extra);
    intro = fill(content.count > 1 ? c.quota.introMany : c.quota.intro, extra);
    button = c.quota.button;
    buttonUrl = `${base}/app/requests/quota${eventQuery}`;
  } else if (content.type === 'team_decision') {
    const d = content.decision;
    const extra = { extra: Math.max(0, Math.trunc(d?.extra ?? 0)) };
    const approved = d?.status === 'approved';
    subject = fill(approved ? c.decision.approvedSubject : c.decision.deniedSubject, extra);
    intro = fill(approved ? c.decision.approvedIntro : c.decision.deniedIntro, extra);
    button = c.decision.button;
    buttonUrl = `${base}/app`;
  } else {
    const companies = content.digest ?? [];
    let total = 0;
    for (const company of companies) {
      const lines: string[] = [];
      for (const e of company.events) {
        const parts: string[] = [];
        if (e.requests > 0) parts.push(e.requests === 1 ? c.digest.requestsOne : fmt(c.digest.requestsMany, { n: e.requests }));
        if (e.quota > 0) parts.push(e.quota === 1 ? c.digest.quotaOne : fmt(c.digest.quotaMany, { n: e.quota }));
        if (parts.length === 0) continue;
        total += e.requests + e.quota;
        lines.push(`${fmt(c.digest.eventLine, { event_name: clean(e.name), event_date: eventDate(e.startsAt) })}: ${parts.join(', ')}`);
      }
      if (lines.length > 0) digestBlocks.push({ company: clean(company.name), lines });
    }
    subject = total === 1 ? c.digest.subjectOne : fmt(c.digest.subject, { total });
    intro = c.digest.intro;
    button = c.digest.button;
    buttonUrl = `${base}/app/requests`;
  }

  if (ev && content.type !== 'team_digest') {
    details.push(String(vars.event_name), fill(c.when));
  }

  subject = plainLine(subject);
  const preheader = plainLine(intro);
  const greeting = vars.first_name ? fill(c.greeting) : c.greetingNoName;
  const company = clean(content.company);
  const settingsUrl = `${base}/app/profile`;

  // ---- plain text ----------------------------------------------------------
  const text = [
    company || 'PlusOne',
    '',
    greeting,
    '',
    intro,
    '',
    ...(details.length > 0 ? [...details, ''] : []),
    ...digestBlocks.flatMap((b) => [b.company, ...b.lines, '']),
    `${button}: ${buttonUrl}`,
    '',
    '--',
    c.reason,
    `${c.settings}: ${settingsUrl}`,
    `${c.unsubscribeLead} ${c.unsubscribeLink}: ${content.unsubscribeUrl}`,
    c.trouble,
  ].join('\n');

  // ---- html ------------------------------------------------------------------
  const e = escapeHtml;
  const P = 'margin:0 0 16px;font-size:16px;line-height:1.5;';
  const F = 'margin:0 0 8px;font-size:12px;line-height:1.5;color:#77737f;';
  const A = 'color:#0B0B0D;text-decoration:underline;';
  const detailHtml =
    details.length > 0
      ? `<div style="margin:0 0 16px;padding:16px;border-radius:8px;background:#f4f3f8;"><p style="margin:0 0 4px;font-weight:700;font-size:16px;">${e(details[0])}</p>${details
          .slice(1)
          .map((l) => `<p style="margin:0;font-size:15px;line-height:1.5;">${e(l)}</p>`)
          .join('')}</div>`
      : '';
  const digestHtml = digestBlocks
    .map(
      (b) =>
        `<div style="margin:0 0 16px;padding:16px;border-radius:8px;background:#f4f3f8;"><p style="margin:0 0 6px;font-weight:700;font-size:16px;">${e(b.company)}</p>${b.lines
          .map((l) => `<p style="margin:0 0 4px;font-size:15px;line-height:1.5;">${e(l)}</p>`)
          .join('')}</div>`,
    )
    .join('');
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head>
<body style="margin:0;padding:24px;background:#f4f3f8;font-family:'Hanken Grotesk',Helvetica,Arial,sans-serif;color:#0B0B0D;">
<span style="display:none;max-height:0;overflow:hidden;">${e(preheader)}</span>
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
<p style="margin:0 0 20px;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#77737f;">${e(company || 'PlusOne')}</p>
<p style="${P}">${e(greeting)}</p>
<p style="${P}">${e(intro)}</p>
${detailHtml}${digestHtml}
<p style="margin:8px 0 24px;"><a href="${e(buttonUrl)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#B5A6FF;color:#0B0B0D;font-weight:700;text-decoration:none;">${e(button)}</a></p>
<hr style="border:none;border-top:1px solid #e6e4ee;margin:0 0 16px;">
<p style="${F}">${e(c.reason)} <a href="${e(settingsUrl)}" style="${A}">${e(c.settings)}</a>.</p>
<p style="${F}">${e(c.unsubscribeLead)} <a href="${e(content.unsubscribeUrl)}" style="${A}">${e(c.unsubscribeLink)}</a>.</p>
<p style="${F}">${e(c.trouble)}</p>
</div>
</body>
</html>`;

  return { subject, preheader, html, text, buttonUrl };
}
