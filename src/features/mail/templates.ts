// Team mail templates (Mail-infra F0, z8uq9m2yvt). Pure functions: copy in
// (t.mail, src/lib/i18n/surfaces/mail.ts), subject/html/text out. Two
// injection rules, each tested in templates.test.ts:
//   * Body: every variable is HTML-escaped AFTER interpolation into plain copy,
//     so an inviter or company name like `<a href=…>` renders as text.
//   * Subject: plain text, never HTML entities (spike 9.4: "Bar & Grill" must
//     arrive as "Bar & Grill"). Control characters (CR/LF = header injection)
//     are replaced by a space, and each name is capped in length.
// The button is the bare /login page for an account that can already log in.
// For a new or never-confirmed address (one invite mail, z8uq9m2yvp) it is a
// one-time sign-in link through our own /auth/confirm route, the same shape
// as the Supabase invite template it replaces: a bearer credential that only
// ever exists in the rendered mail, never in a log.

import { fmt, t } from '@/lib/i18n';

export type TeamMailTemplate =
  | 'team_join'
  | 'team_added_to_event'
  | 'team_resend'
  | 'team_invite_declined'
  | 'team_invite_declined_confirm'
  | 'platform_invite';

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
    }
  // Decline mails (z8uq9m2yvp). The invitee causes them, not the company, so
  // they carry no venue (no company mail cap) and no login steps.
  | {
      /** To the inviter: which address declined. */
      template: 'team_invite_declined';
      venueId: null;
      /** The address as typed on the invite, never a profile name. */
      inviteeEmail: string;
      companyName: string;
      /** A crew invite names its event; a team invite has none. */
      crew: boolean;
      eventName: string | null;
    }
  | {
      /** To the decliner: the confirmation. */
      template: 'team_invite_declined_confirm';
      venueId: null;
      companyName: string;
      crew: boolean;
      eventName: string | null;
    }
  // Company invite (Onboarding A, z8uq9m2vg5): a platform admin invites someone
  // to set up their own company. No company exists yet, so no venue (no
  // company mail cap; consume_platform_invite_throttle is its budget) and no
  // company name. Display data only: whether the company starts comped is
  // read from platform_invites.comped, never from this mail.
  | {
      template: 'platform_invite';
      venueId: null;
      /** The platform admin's profile name; null = "The PlusOne team". */
      inviterName: string | null;
    };

/** The one-time sign-in token for a new or never-confirmed address, as GoTrue's
 *  generateLink returns it: the hashed token and the slot it was filed in. */
export interface InviteLink {
  tokenHash: string;
  verifyType: 'invite' | 'signup';
}

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
  /** False for the decline mails: nothing to log in for, so no steps or button. */
  login?: false;
  /** Replaces the default footer reason (which says the address was added to a company). */
  footer?: string;
}

function partsFor(content: Exclude<TeamMailContent, { template: 'platform_invite' }>, newAccount: boolean): MailParts {
  const m = t.mail;
  switch (content.template) {
    case 'team_join':
      return {
        ...m.teamJoin,
        intro: [newAccount ? m.teamJoinNewIntro : m.teamJoin.intro],
        after: [m.joinBanner, m.joinSwitch, m.joinOpenFor],
      };
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
    case 'team_invite_declined': {
      const declined = content.crew ? m.inviteDeclinedCrew : m.inviteDeclinedTeam;
      return { ...declined, intro: [declined.intro], after: [], login: false, footer: m.footerDeclinedInviter };
    }
    case 'team_invite_declined_confirm': {
      const confirm = content.crew ? m.inviteDeclinedConfirmCrew : m.inviteDeclinedConfirmTeam;
      return { ...confirm, intro: [confirm.intro], after: [], login: false, footer: m.footerDeclinedInvitee };
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

/** The invite link: our /auth/confirm route (server-side session on click),
 *  exactly as the Supabase invite template builds it. */
function inviteUrl(base: string, link: InviteLink): string {
  const q = new URLSearchParams({ token_hash: link.tokenHash, type: link.verifyType, next: '/app' });
  return `${base}/auth/confirm?${q.toString()}`;
}

export function renderTeamMail(content: TeamMailContent, appUrl: string, invite?: InviteLink): RenderedMail {
  if (content.template === 'platform_invite') return renderCompanyInviteMail(content, appUrl, invite);
  const company = cleanName(content.companyName);
  const inviterName = 'inviterName' in content ? content.inviterName : null;
  const eventName =
    content.template === 'team_added_to_event'
      ? content.eventName
      : content.template === 'team_invite_declined' || content.template === 'team_invite_declined_confirm'
        ? (content.eventName ?? t.mail.eventFallback)
        : '';
  const vars: Record<string, string | number> = {
    inviter: cleanName(inviterName ?? '') || fmt(t.mail.inviterFallback, { company }),
    invitee: content.template === 'team_invite_declined' ? cleanName(content.inviteeEmail) : '',
    company,
    event: cleanName(eventName),
    n: content.template === 'team_added_to_event' && typeof content.quota === 'number' ? content.quota : '',
  };
  const parts = partsFor(content, Boolean(invite));
  // Only the inviter fallback ("an admin at ...") can open a sentence in lower
  // case. Never capitalise anything else: a decline mail opens with an e-mail address.
  const fill = (s: string) => (s.startsWith('{inviter}') ? capFirst(fmt(s, vars)) : fmt(s, vars));
  const base = appUrl.replace(/\/+$/, '');
  const loginUrl = invite ? inviteUrl(base, invite) : `${base}/login`;

  const subject = plainLine(fill(parts.subject));
  const heading = fill(parts.heading);
  const intro = parts.intro.map(fill);
  const steps = (invite ? t.mail.inviteLinkSteps : t.mail.loginSteps).map(fill);
  const after = parts.after.map(fill);
  const reason = fill(parts.footer ?? t.mail.footerReason);
  const withLogin = parts.login !== false;
  const fallback = fmt(t.mail.linkFallback, { url: loginUrl });

  // Plain-text alternative (deliverability): same content, steps numbered.
  const text = [
    heading,
    '',
    ...intro.flatMap((p) => [p, '']),
    ...(withLogin
      ? [t.mail.gettingIn, ...steps.map((step, i) => `${i + 1}. ${step}`), '', `${t.mail.cta}: ${loginUrl}`, '']
      : []),
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
${
  withLogin
    ? `<h2 style="margin:24px 0 8px;font-size:16px;line-height:1.3;">${e(t.mail.gettingIn)}</h2>
<ol style="margin:0 0 20px;padding-left:22px;font-size:16px;line-height:1.5;">
${steps.map((step) => `<li style="margin:0 0 4px;">${e(step)}</li>`).join('\n')}
</ol>
<p style="margin:0 0 12px;"><a href="${e(loginUrl)}" style="display:inline-block;background:#B5A6FF;color:#0B0B0D;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px;">${e(t.mail.cta)}</a></p>
<p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#55525e;word-break:break-all;overflow-wrap:anywhere;">${e(fallback)}</p>`
    : ''
}
${after.map((p) => `<p style="${P}">${e(p)}</p>`).join('\n')}
<hr style="border:none;border-top:1px solid #e6e4ee;margin:8px 0 16px;">
<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#77737f;">${e(reason)}</p>
<p style="margin:0;font-size:12px;line-height:1.5;color:#77737f;">${e(t.mail.footerSupport)}</p>
</div>
</body>
</html>`;

  return { subject, html, text };
}

/**
 * The company invite (z8uq9m2vg5). Same page skin and the same two injection
 * rules as renderTeamMail: the inviter's name is HTML-escaped in the body and
 * reduced to one plain line (control characters out, length capped). The
 * subject is fixed copy, no name in it. A new or never-confirmed address gets
 * the one-time sign-in link and the honest 24-hour validity; an address that
 * can already log in gets the plain /login button and no link warnings.
 */
function renderCompanyInviteMail(
  content: Extract<TeamMailContent, { template: 'platform_invite' }>,
  appUrl: string,
  invite?: InviteLink,
): RenderedMail {
  const m = t.mail.companyInvite;
  const vars = { inviter: cleanName(content.inviterName ?? '') || m.inviterFallback };
  const fill = (s: string) => fmt(s, vars);
  const base = appUrl.replace(/\/+$/, '');
  const url = invite ? inviteUrl(base, invite) : `${base}/login`;

  const subject = plainLine(m.subject);
  const heading = m.heading;
  const intro = fill(m.intro);
  const steps = [invite ? m.stepAccountLink : m.stepAccountLogin, m.stepCompany, m.stepEvent];
  const notes = invite ? [fill(m.linkValidity), m.linkForward] : [];
  const reason = fill(m.footerReason);
  const fallback = fmt(t.mail.linkFallback, { url });

  const text = [
    heading,
    '',
    intro,
    '',
    m.howItWorks,
    ...steps.map((step, i) => `${i + 1}. ${step}`),
    '',
    `${m.cta}: ${url}`,
    '',
    ...notes.flatMap((p) => [p, '']),
    m.whyTitle,
    ...m.benefits.map((b) => `- ${b}`),
    '',
    '--',
    reason,
    t.mail.footerSupport,
  ].join('\n');

  const e = escapeHtml;
  const P = 'margin:0 0 16px;font-size:16px;line-height:1.5;';
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head>
<body style="margin:0;padding:24px;background:#f4f3f8;font-family:'Hanken Grotesk',Helvetica,Arial,sans-serif;color:#0B0B0D;">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
<p style="margin:0 0 24px;font-weight:700;font-size:18px;">PlusOne</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${e(heading)}</h1>
<p style="${P}">${e(intro)}</p>
<h2 style="margin:24px 0 8px;font-size:16px;line-height:1.3;">${e(m.howItWorks)}</h2>
<ol style="margin:0 0 20px;padding-left:22px;font-size:16px;line-height:1.5;">
${steps.map((step) => `<li style="margin:0 0 4px;">${e(step)}</li>`).join('\n')}
</ol>
<p style="margin:0 0 12px;"><a href="${e(url)}" style="display:inline-block;background:#B5A6FF;color:#0B0B0D;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px;">${e(m.cta)}</a></p>
<p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#55525e;word-break:break-all;overflow-wrap:anywhere;">${e(fallback)}</p>
${notes.map((p) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#55525e;">${e(p)}</p>`).join('\n')}
<h2 style="margin:24px 0 8px;font-size:16px;line-height:1.3;">${e(m.whyTitle)}</h2>
<ul style="margin:0 0 20px;padding-left:22px;font-size:16px;line-height:1.5;">
${m.benefits.map((b) => `<li style="margin:0 0 4px;">${e(b)}</li>`).join('\n')}
</ul>
<hr style="border:none;border-top:1px solid #e6e4ee;margin:8px 0 16px;">
<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#77737f;">${e(reason)}</p>
<p style="margin:0;font-size:12px;line-height:1.5;color:#77737f;">${e(t.mail.footerSupport)}</p>
</div>
</body>
</html>`;

  return { subject, html, text };
}
