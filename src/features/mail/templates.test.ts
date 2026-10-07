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
    expect(m.subject).toBe('Max added you to Friday Late');
    expect(m.html).toContain('Friday Late at Club Vesper');
  });

  it('team_resend: join and event variants differ', () => {
    const a = renderTeamMail({ template: 'team_resend', kind: 'join', venueId: VENUE_ID, inviterName: 'Max', companyName: 'Club Vesper' }, APP);
    const b = renderTeamMail({ template: 'team_resend', kind: 'event', venueId: VENUE_ID, inviterName: 'Max', companyName: 'Club Vesper' }, APP);
    expect(a.subject).toBe('Reminder: Max invited you to join Club Vesper');
    expect(b.subject).toBe("Reminder: you're on the crew at Club Vesper");
  });

  it('falls back to a neutral inviter when the profile has no name', () => {
    expect(renderTeamMail({ ...join, inviterName: null }, APP).subject).toBe('A teammate invited you to join Club Vesper');
    expect(renderTeamMail({ ...join, inviterName: '  \n ' }, APP).subject).toBe('A teammate invited you to join Club Vesper');
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
