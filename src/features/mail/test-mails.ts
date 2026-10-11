import 'server-only';

// Platform test mails (ClickUp z8uq9m49k1, decision Max 2026-10-11 #5): every
// template we send, rendered with made-up data and sent to an address a
// platform admin picks, so Max and Joeri can see each one live in their inbox.
// The real renderers (guest, team notification, team/invite, billing), the
// real provider, "[Test]" in the subject; the mail_log row is marked as a test
// (log_platform_test_mail). Links point at the app but carry no token: no
// test mail can sign anyone in, unsubscribe anyone or open a status page.
// The platform digest is not here: its sender lives in the Edge Function
// (Deno can't import this directory).

import { EVENT_MAIL_TYPES, TRIAL_MAIL_TYPES } from '@/features/billing/mail-schedule';
import { MAIL_DOMAIN, MAIL_FROM } from './config';
import type { OutgoingMail } from './provider';
import { renderTeamMail, type TeamMailContent } from './templates';
import { BILLING_MAIL_FROM, BILLING_MAIL_REPLY_TO, renderBillingMail } from './templates/billing-mails';
import { GUEST_MAIL_TYPES, type GuestMailType } from './templates/guest-copy';
import { renderGuestMail } from './templates/guest-mails';
import { renderTeamNotify, type TeamNotifyType } from './templates/team-notify';

const TEAM_INVITE_TYPES = [
  'team_join',
  'team_added_to_event',
  'team_resend',
  'team_invite_declined',
  'team_invite_declined_confirm',
  'platform_invite',
] as const;
const TEAM_NOTIFY_TYPES = ['team_request', 'team_quota', 'team_decision', 'team_digest'] as const;

/** Every mail type a test can be sent for, grouped as the Platform tab shows them. */
export const TEST_MAIL_GROUPS = {
  guest: GUEST_MAIL_TYPES,
  team: TEAM_NOTIFY_TYPES,
  invite: TEAM_INVITE_TYPES,
  billing: [...TRIAL_MAIL_TYPES, ...EVENT_MAIL_TYPES],
} as const;

export const TEST_MAIL_TYPES: readonly string[] = Object.values(TEST_MAIL_GROUPS).flat();
export type TestMailType = (typeof TEST_MAIL_TYPES)[number];

export function isTestMailType(value: unknown): value is TestMailType {
  return typeof value === 'string' && TEST_MAIL_TYPES.includes(value);
}

const COMPANY = 'Club Demo';
const DEMO_VENUE = '00000000-0000-7000-8000-00000000d3e0';

function demoStart(): string {
  const d = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  d.setUTCHours(21, 0, 0, 0);
  return d.toISOString();
}

function testSubject(subject: string): string {
  return `[Test] ${subject}`;
}

/** The test mail for one type, ready for the provider. */
export function buildTestMail(type: TestMailType, to: string, appUrl: string, mailLogId: string): OutgoingMail {
  const base = appUrl.replace(/\/+$/, '');
  const startsAt = demoStart();
  const common = { to, idempotencyKey: `mail_log/${mailLogId}`, type };

  if ((GUEST_MAIL_TYPES as readonly string[]).includes(type)) {
    const guestType = type as GuestMailType;
    const r = renderGuestMail({
      type: guestType,
      firstName: 'Lotte',
      event: {
        id: '00000000-0000-7000-8000-00000000e7e0',
        name: 'Demo Night',
        startsAt,
        endsAt: null,
        location: 'Demo Hall, Herengracht 1, 1015 BA Amsterdam',
        updatedAt: null,
        houseRules: 'Bring a valid ID. Doors close at 01:00.',
      },
      companyName: COMPANY,
      contactEmail: 'support@plus-one.io',
      plusOnes: 1,
      tiers:
        guestType === 'guest_request_declined' || guestType === 'guest_removed' || guestType === 'guest_event_canceled'
          ? null
          : [{ name: 'Guest list', people: 2, priceCents: null }],
      askedPeople: guestType === 'guest_request_partly' ? 4 : null,
      remark: guestType === 'guest_removed' ? 'The list for this night is smaller than planned, sorry.' : null,
      links: { statusUrl: `${base}/app`, icsUrl: null, unsubscribeUrl: `${base}/app` },
    });
    return {
      ...common,
      subject: testSubject(r.subject),
      html: r.html,
      text: r.text,
      from: `"${r.fromName}" <noreply@${MAIL_DOMAIN}>`,
      replyTo: 'support@plus-one.io',
    };
  }

  if ((TEAM_NOTIFY_TYPES as readonly string[]).includes(type)) {
    const notifyType = type as TeamNotifyType;
    const r = renderTeamNotify({
      type: notifyType,
      firstName: 'Max',
      company: COMPANY,
      event: notifyType === 'team_digest' ? null : { id: '00000000-0000-7000-8000-00000000e7e0', name: 'Demo Night', startsAt },
      count: 1,
      request: { firstName: 'Lotte', plusOnes: 1 },
      quota: { requester: 'Tom Bakker', extra: 3 },
      decision: { status: 'approved', extra: 3 },
      digest: [{ name: COMPANY, events: [{ name: 'Demo Night', startsAt, requests: 4, quota: 1 }] }],
      appUrl: base,
      unsubscribeUrl: `${base}/app/profile`,
    });
    return { ...common, subject: testSubject(r.subject), html: r.html, text: r.text, from: MAIL_FROM };
  }

  if ((TEAM_INVITE_TYPES as readonly string[]).includes(type)) {
    const content: TeamMailContent =
      type === 'team_join'
        ? { template: 'team_join', venueId: DEMO_VENUE, inviterName: 'Max de Vries', companyName: COMPANY }
        : type === 'team_added_to_event'
          ? { template: 'team_added_to_event', venueId: DEMO_VENUE, inviterName: 'Max de Vries', companyName: COMPANY, eventName: 'Demo Night', quota: 3 }
          : type === 'team_resend'
            ? { template: 'team_resend', kind: 'join', venueId: DEMO_VENUE, inviterName: 'Max de Vries', companyName: COMPANY }
            : type === 'team_invite_declined'
              ? { template: 'team_invite_declined', venueId: null, inviteeEmail: 'someone@example.com', companyName: COMPANY, crew: false, eventName: null }
              : type === 'team_invite_declined_confirm'
                ? { template: 'team_invite_declined_confirm', venueId: null, companyName: COMPANY, crew: false, eventName: null }
                : { template: 'platform_invite', venueId: null, inviterName: 'Max de Vries' };
    // No invite link: the button goes to /login, never a one-time sign-in.
    const r = renderTeamMail(content, base);
    return { ...common, subject: testSubject(r.subject), html: r.html, text: r.text, from: MAIL_FROM };
  }

  const r = renderBillingMail(
    {
      type: type as (typeof TEST_MAIL_GROUPS.billing)[number],
      firstName: 'Max',
      companyName: COMPANY,
      trialEndsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      // Made-up company: the button is the plain Billing URL, no ?venue=.
      venueId: null,
    },
    base,
  );
  return {
    ...common,
    subject: testSubject(r.subject),
    html: r.html,
    text: r.text,
    from: BILLING_MAIL_FROM,
    replyTo: BILLING_MAIL_REPLY_TO,
  };
}
