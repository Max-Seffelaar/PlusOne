// Team mail templates (Mail-infra F0, z8uq9m2yvt). Pure functions: copy in
// (t.mail, src/lib/i18n/surfaces/mail.ts), subject/html/text out. Two
// injection rules, each tested in templates.test.ts:
//   * Body: every variable is HTML-escaped AFTER interpolation into plain copy,
//     so an inviter or company name like `<a href=…>` renders as text.
//   * Subject: plain text, never HTML entities (spike 9.4: "Bar & Grill" must
//     arrive as "Bar & Grill"). Control characters (CR/LF = header injection)
//     are replaced by a space, and each name is capped in length.
// No login token ever goes in a mail: the link is the bare /login page.

import { fmt, t } from '@/lib/i18n';

export type TeamMailTemplate = 'team_join' | 'team_added_to_event' | 'team_resend';

export type TeamMailContent =
  | { template: 'team_join'; venueId: string; inviterName: string | null; companyName: string }
  | {
      template: 'team_added_to_event';
      venueId: string;
      inviterName: string | null;
      companyName: string;
      eventName: string;
    }
  | {
      template: 'team_resend';
      /** join = resend of a company invite; event = resend to external crew. */
      kind: 'join' | 'event';
      venueId: string;
      inviterName: string | null;
      companyName: string;
    };

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

/** A name never needs more than this in a subject or heading. */
const NAME_MAX = 80;

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

/** One line of plain text: control characters (incl. CR/LF, NUL, DEL, the
 *  Unicode line/paragraph separators) become a space, whitespace collapses. */
export function plainLine(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex -- stripping control chars is the point
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanName(value: string): string {
  const line = plainLine(value);
  return line.length > NAME_MAX ? `${line.slice(0, NAME_MAX - 1)}…` : line;
}

function copyFor(content: TeamMailContent) {
  switch (content.template) {
    case 'team_join':
      return t.mail.teamJoin;
    case 'team_added_to_event':
      return t.mail.teamAddedToEvent;
    case 'team_resend':
      return content.kind === 'event' ? t.mail.teamResendEvent : t.mail.teamResendJoin;
  }
}

export function renderTeamMail(content: TeamMailContent, appUrl: string): RenderedMail {
  const company = cleanName(content.companyName);
  const vars: Record<string, string> = {
    inviter: cleanName(content.inviterName ?? '') || t.mail.inviterFallback,
    company,
    event: content.template === 'team_added_to_event' ? cleanName(content.eventName) : '',
  };
  const copy = copyFor(content);
  const loginUrl = `${appUrl.replace(/\/+$/, '')}/login`;

  const subject = plainLine(fmt(copy.subject, vars));
  const heading = fmt(copy.heading, vars);
  const body = fmt(copy.body, vars);
  const reason = fmt(t.mail.footerReason, { company });
  const fallback = fmt(t.mail.linkFallback, { url: loginUrl });

  const text = [heading, '', body, '', `${t.mail.cta}: ${loginUrl}`, '', '--', reason, t.mail.footerSupport].join(
    '\n'
  );

  const e = escapeHtml;
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head>
<body style="margin:0;padding:24px;background:#f4f3f8;font-family:'Hanken Grotesk',Helvetica,Arial,sans-serif;color:#0B0B0D;">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
<p style="margin:0 0 24px;font-weight:700;font-size:18px;">PlusOne</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${e(heading)}</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:1.5;">${e(body)}</p>
<p style="margin:0 0 24px;"><a href="${e(loginUrl)}" style="display:inline-block;background:#B5A6FF;color:#0B0B0D;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px;">${e(t.mail.cta)}</a></p>
<p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#55525e;">${e(fallback)}</p>
<hr style="border:none;border-top:1px solid #e6e4ee;margin:0 0 16px;">
<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#77737f;">${e(reason)}</p>
<p style="margin:0;font-size:12px;line-height:1.5;color:#77737f;">${e(t.mail.footerSupport)}</p>
</div>
</body>
</html>`;

  return { subject, html, text };
}
