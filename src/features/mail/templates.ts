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
      /** Crew guest quota on the event; the quota sentence shows only when > 0. */
      quota?: number;
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
 *  Unicode line/paragraph separators, and the bidi controls LRM/RLM,
 *  U+202A–U+202E and U+2066–U+2069 that can reorder a name) become a space,
 *  whitespace collapses. */
export function plainLine(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex -- stripping control chars is the point
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanName(value: string): string {
  const line = plainLine(value);
  return line.length > NAME_MAX ? `${line.slice(0, NAME_MAX - 1)}…` : line;
}

/** Upper-cases the first letter: the inviter fallback ("an admin at …") can
 *  open a sentence or a subject. */
function capFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

interface MailParts {
  subject: string;
  heading: string;
  intro: string[];
  after: string[];
}

function partsFor(content: TeamMailContent): MailParts {
  const m = t.mail;
  switch (content.template) {
    case 'team_join':
      return { ...m.teamJoin, intro: [m.teamJoin.intro], after: [m.joinBanner, m.joinSwitch, m.joinOpenFor] };
    case 'team_added_to_event': {
      const quota = content.quota;
      const quotaLine =
        typeof quota === 'number' && Number.isInteger(quota) && quota > 0
          ? [quota === 1 ? m.crewQuotaOne : m.crewQuota]
          : [];
      return {
        ...m.teamAddedToEvent,
        intro: [[m.teamAddedToEvent.intro, ...quotaLine].join(' ')],
        after: [m.crewAccept, m.joinOpenFor, m.crewFindEvent, m.crewScope],
      };
    }
    case 'team_resend':
      return content.kind === 'event'
        ? { ...m.teamResendEvent, intro: [m.teamResendEvent.intro], after: [m.crewFindEvents, m.crewScope] }
        : {
            ...m.teamResendJoin,
            intro: [m.teamResendJoin.intro],
            after: [m.joinBanner, m.joinSwitch, m.joinOpenFor],
          };
  }
}

export function renderTeamMail(content: TeamMailContent, appUrl: string): RenderedMail {
  const company = cleanName(content.companyName);
  const vars: Record<string, string | number> = {
    inviter: cleanName(content.inviterName ?? '') || fmt(t.mail.inviterFallback, { company }),
    company,
    event: content.template === 'team_added_to_event' ? cleanName(content.eventName) : '',
    n: content.template === 'team_added_to_event' && typeof content.quota === 'number' ? content.quota : '',
  };
  const parts = partsFor(content);
  const fill = (s: string) => capFirst(fmt(s, vars));
  const loginUrl = `${appUrl.replace(/\/+$/, '')}/login`;

  const subject = plainLine(fill(parts.subject));
  const heading = fill(parts.heading);
  const intro = parts.intro.map(fill);
  const steps = t.mail.loginSteps;
  const after = parts.after.map(fill);
  const reason = fmt(t.mail.footerReason, { company });
  const fallback = fmt(t.mail.linkFallback, { url: loginUrl });

  // Plain-text alternative (deliverability): same content, steps numbered.
  const text = [
    heading,
    '',
    ...intro.flatMap((p) => [p, '']),
    t.mail.gettingIn,
    ...steps.map((step, i) => `${i + 1}. ${step}`),
    '',
    `${t.mail.cta}: ${loginUrl}`,
    '',
    ...after.flatMap((p) => [p, '']),
    '--',
    reason,
    t.mail.footerSupport,
  ].join('\n');

  // No images, by decision (deliverability + no remote content).
  const e = escapeHtml;
  const P = 'margin:0 0 16px;font-size:16px;line-height:1.5;';
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head>
<body style="margin:0;padding:24px;background:#f4f3f8;font-family:'Hanken Grotesk',Helvetica,Arial,sans-serif;color:#0B0B0D;">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
<p style="margin:0 0 24px;font-weight:700;font-size:18px;">PlusOne</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${e(heading)}</h1>
${intro.map((p) => `<p style="${P}">${e(p)}</p>`).join('\n')}
<h2 style="margin:24px 0 8px;font-size:16px;line-height:1.3;">${e(t.mail.gettingIn)}</h2>
<ol style="margin:0 0 20px;padding-left:22px;font-size:16px;line-height:1.5;">
${steps.map((step) => `<li style="margin:0 0 4px;">${e(step)}</li>`).join('\n')}
</ol>
<p style="margin:0 0 12px;"><a href="${e(loginUrl)}" style="display:inline-block;background:#B5A6FF;color:#0B0B0D;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px;">${e(t.mail.cta)}</a></p>
<p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#55525e;">${e(fallback)}</p>
${after.map((p) => `<p style="${P}">${e(p)}</p>`).join('\n')}
<hr style="border:none;border-top:1px solid #e6e4ee;margin:8px 0 16px;">
<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#77737f;">${e(reason)}</p>
<p style="margin:0;font-size:12px;line-height:1.5;color:#77737f;">${e(t.mail.footerSupport)}</p>
</div>
</body>
</html>`;

  return { subject, html, text };
}
