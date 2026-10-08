/**
 * Team mail templates (Mail-infra F0): injection rules and the facts each mail
 * must carry. The copy itself lives in src/lib/i18n/surfaces/mail.ts.
 */
import { describe, expect, it } from 'vitest';
import { escapeHtml, plainLine, renderTeamMail, type TeamMailContent } from './templates';

const VENUE_ID = '3f1c8a52-9d6b-4f2e-8a11-7c0d5e9b4a63';
const APP = 'https://app.plus-one.io';

const join: TeamMailContent = { template: 'team_join', venueId: VENUE_ID, inviterName: 'Max', companyName: 'Club Vesper' };

describe('renderTeamMail', () => {
  it('team_join: "<inviter> invited you to join <company>" with a plain /login link', () => {
    const m = renderTeamMail(join, APP);
    expect(m.subject).toBe('Max invited you to join Club Vesper');
    expect(m.html).toContain('href="https://app.plus-one.io/login"');
    expect(m.text).toContain('https://app.plus-one.io/login');
    expect(m.html).toContain('support@plus-one.io');
    expect(m.text).toContain('support@plus-one.io');
  });

  it('team_added_to_event: names the inviter and the event', () => {
    const m = renderTeamMail(
      { template: 'team_added_to_event', venueId: VENUE_ID, inviterName: 'Max', companyName: 'Club Vesper', eventName: 'Friday Late' },
      APP
    );
    expect(m.subject).toBe('Max invited you to the crew for Friday Late');
    expect(m.html).toContain('Friday Late at Club Vesper');
  });

  it('team_resend: join and event variants differ', () => {
    const a = renderTeamMail({ template: 'team_resend', kind: 'join', venueId: VENUE_ID, inviterName: 'Max', companyName: 'Club Vesper' }, APP);
    const b = renderTeamMail({ template: 'team_resend', kind: 'event', venueId: VENUE_ID, inviterName: 'Max', companyName: 'Club Vesper' }, APP);
    expect(a.subject).toBe('Reminder: Max invited you to join Club Vesper');
    expect(b.subject).toBe("Reminder: you're on the crew at Club Vesper");
  });

  it('falls back to "an admin at {company}" wherever {inviter} appears', () => {
    const m = renderTeamMail({ ...join, inviterName: null }, APP);
    expect(m.subject).toBe('An admin at Club Vesper invited you to join Club Vesper');
    expect(m.text).toContain('An admin at Club Vesper invited you to join the Club Vesper team on PlusOne.');
    expect(renderTeamMail({ ...join, inviterName: '  \n ' }, APP).subject).toBe(
      'An admin at Club Vesper invited you to join Club Vesper'
    );
    const crew = renderTeamMail(
      { template: 'team_resend', kind: 'event', venueId: VENUE_ID, inviterName: null, companyName: 'Club Vesper' },
      APP
    );
    expect(crew.text).toContain('Ask an admin at Club Vesper. They make the changes.');
  });

  it('HTML-escapes names in the body (no markup injection)', () => {
    const m = renderTeamMail(
      { ...join, inviterName: '<b>Max</b><script>alert(1)</script>', companyName: '<a href="https://evil.test">Win</a>' },
      APP
    );
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<a href="https://evil.test"');
    expect(m.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(m.html).toContain('&lt;a href=&quot;https://evil.test&quot;&gt;Win&lt;/a&gt;');
  });

  it('keeps the subject plain text: no entities, "&" stays "&"', () => {
    const m = renderTeamMail({ ...join, inviterName: 'Max & <Joeri>', companyName: 'Bar & Grill "Vesper"' }, APP);
    expect(m.subject).toBe('Max & <Joeri> invited you to join Bar & Grill "Vesper"');
    expect(m.subject).not.toMatch(/&amp;|&lt;|&quot;|&#/);
  });

  it('strips CR/LF and other control characters from the subject (header injection)', () => {
    const m = renderTeamMail({ ...join, inviterName: 'Max\r\nBcc: victim@evil.test', companyName: 'Club\u2028Vesper\u0000' }, APP);
    expect(m.subject).not.toMatch(/[\r\n\u0000\u2028]/);
    expect(m.subject).toBe('Max Bcc: victim@evil.test invited you to join Club Vesper');
  });

  it('caps a very long name', () => {
    const m = renderTeamMail({ ...join, inviterName: 'x'.repeat(500) }, APP);
    expect(m.subject.length).toBeLessThan(140);
  });

  it('never puts a token or query string on the link, and trims a trailing slash on the app URL', () => {
    const m = renderTeamMail(join, 'https://app.plus-one.io/');
    const hrefs = [...m.html.matchAll(/href="([^"]+)"/g)].map((x) => x[1]);
    expect(hrefs).toEqual(['https://app.plus-one.io/login']);
  });
});

describe('escapeHtml / plainLine', () => {
  it('escapes the five HTML specials', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
  it('collapses whitespace and control characters to single spaces', () => {
    expect(plainLine(' a\t\r\n b\u0085c ')).toBe('a b c');
  });
});

const crewAdded = (quota?: number): TeamMailContent => ({
  template: 'team_added_to_event',
  venueId: VENUE_ID,
  inviterName: 'Max',
  companyName: 'Club Vesper',
  eventName: 'Friday Late',
  quota,
});
const ALL: TeamMailContent[] = [
  join,
  crewAdded(4),
  { template: 'team_resend', kind: 'join', venueId: VENUE_ID, inviterName: 'Max', companyName: 'Club Vesper' },
  { template: 'team_resend', kind: 'event', venueId: VENUE_ID, inviterName: 'Max', companyName: 'Club Vesper' },
];

describe('approved copy structure (Max, 2026-10-07)', () => {
  it.each(ALL.map((c) => [c.template + ('kind' in c ? `/${c.kind}` : ''), c] as const))(
    '%s: has a text version, a real <ol> with 3 steps, numbered text steps, no images, no "venue"',
    (_label, content) => {
      const m = renderTeamMail(content, APP);
      expect(m.text.length).toBeGreaterThan(100);
      expect(m.text).toContain('Getting in\n1. Tap Log in to PlusOne.\n2. Enter this email address.\n3. ');
      expect(m.html.match(/<ol[\s>]/g)).toHaveLength(1);
      expect(m.html.match(/<li[\s>]/g)).toHaveLength(3);
      expect(m.html).not.toMatch(/<img|background-image|url\(/i);
      expect(`${m.subject} ${m.text}`).not.toMatch(/venue/i);
      expect(m.html).toContain('>Log in to PlusOne</a>');
    }
  );

  it('crew added: the guest sentence shows only with a quota', () => {
    expect(renderTeamMail(crewAdded(4), APP).text).toContain(
      'Max invited you to the crew for Friday Late at Club Vesper. Accept the invite in the app to join. You can put up to 4 guests on the list.'
    );
    expect(renderTeamMail(crewAdded(1), APP).text).toContain('You can put up to 1 guest on the list.');
    for (const q of [undefined, 0]) {
      const m = renderTeamMail(crewAdded(q), APP);
      expect(m.text).not.toMatch(/guests? on the list/);
      expect(m.html).not.toMatch(/guests? on the list/);
    }
  });

  it('crew invite (z8uq9m2yvp): accept-in-the-banner + 7-day line, then find-the-event + scope', () => {
    const m = renderTeamMail(crewAdded(), APP);
    expect(m.text).toContain(
      "Log in and tap Accept on the invite. It's in the banner at the top of Home, or on the first screen if you don't have a company yet."
    );
    expect(m.text).toContain('The invite is open for 7 days.');
    expect(m.text).toContain('Find the event. Switch to Club Vesper:');
    expect(m.text).toContain('You only see the events Club Vesper put you on.');
    expect(m.text).not.toMatch(/added you/);
  });

  it('join and join-resend share everything from "Getting in" down', () => {
    const a = renderTeamMail(join, APP).text;
    const c = renderTeamMail(ALL[2], APP).text;
    expect(c).toContain('Max sent your invite again.');
    expect(a.slice(a.indexOf('Getting in'))).toBe(c.slice(c.indexOf('Getting in')));
    expect(a).toContain("Once you're in, tap Accept on the invite. It's in the banner at the top of Home, or on the first screen if you don't have a company yet.");
    expect(a).toContain('The invite is open for 7 days.');
  });

  it('crew resend: reminder intro, find-your-events, no quota, no 7 days', () => {
    const m = renderTeamMail(ALL[3], APP).text;
    expect(m).toContain("Max sent you a reminder. You're still on the crew at Club Vesper.");
    expect(m).toContain('Find your events. Switch to Club Vesper:');
    expect(m).not.toMatch(/guests? on the list|7 days/);
  });
});

describe('bidi controls (review of PR #413)', () => {
  it('strips LRM/RLM, embeddings/overrides and isolates from names', () => {
    const bidi = ['\u200e', '\u200f', '\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2066', '\u2067', '\u2068', '\u2069'];
    const m = renderTeamMail({ ...join, inviterName: `Max${bidi.join('')}`, companyName: 'Club \u202eresseV\u202c' }, APP);
    for (const ch of bidi) {
      expect(m.subject).not.toContain(ch);
      expect(m.text).not.toContain(ch);
      expect(m.html).not.toContain(ch);
    }
    expect(m.subject).toBe('Max invited you to join Club resseV');
  });
});

// One invite mail (z8uq9m2yvp): a new or never-confirmed address gets the same
// mail with a one-time sign-in button instead of the login steps.
describe('renderTeamMail — new address (invite link)', () => {
  const LINK = { tokenHash: 'pkce_0c1d2e3f40516273', verifyType: 'invite' as const };

  it('the button is the /auth/confirm link, with the link steps instead of the code steps', () => {
    const m = renderTeamMail(join, APP, LINK);
    const url = 'https://app.plus-one.io/auth/confirm?token_hash=pkce_0c1d2e3f40516273&type=invite&next=%2Fapp';
    expect(m.text).toContain(url);
    expect(m.html).toContain(`href="${url.replace(/&/g, '&amp;')}"`);
    expect(m.text).not.toContain('https://app.plus-one.io/login');
    expect(m.text).toContain('It logs you straight in, no code needed.');
    expect(m.text).toContain('Expired? Ask Max to send the invite again.');
    expect(m.text).not.toContain('6-digit code');
  });

  it('team_join does not tell a new address it already has a login; the subject stays the same', () => {
    expect(renderTeamMail(join, APP).text).toContain('You already have a login.');
    const m = renderTeamMail(join, APP, LINK);
    expect(m.text).not.toContain('You already have a login.');
    expect(m.subject).toBe(renderTeamMail(join, APP).subject);
  });

  it('a never-confirmed address keeps its token slot (type=signup)', () => {
    expect(renderTeamMail(join, APP, { ...LINK, verifyType: 'signup' }).text).toContain('&type=signup&');
  });

  it('crew: the same crew mail, the accept step unchanged', () => {
    const crew: TeamMailContent = {
      template: 'team_added_to_event',
      venueId: VENUE_ID,
      inviterName: 'Max',
      companyName: 'Club Vesper',
      eventName: 'Friday Late',
    };
    const m = renderTeamMail(crew, APP, LINK);
    expect(m.subject).toBe(renderTeamMail(crew, APP).subject);
    expect(m.text).toContain('tap Accept on the invite');
    expect(m.text).toContain('/auth/confirm?token_hash=');
  });

  it('a hostile inviter name in a link step is escaped', () => {
    const m = renderTeamMail({ ...join, inviterName: '<img src=x>' }, APP, LINK);
    expect(m.html).not.toContain('<img');
    expect(m.html).toContain('&lt;img src=x&gt;');
  });
});
