/**
 * Company invite mail (Onboarding A, z8uq9m2vg5): the platform invite sent
 * through our own path. Facts it must carry (who invited, three steps, one
 * button, the link fallback, honest validity) and the two injection rules of
 * the team templates: the inviter's name is escaped in HTML, the subject is
 * fixed plain text. It never mentions a price or "free": comped lives on the
 * invite row only.
 */
import { describe, expect, it } from 'vitest';
import { renderTeamMail, type InviteLink, type TeamMailContent } from './templates';

const APP = 'https://app.plus-one.io/';
const LINK: InviteLink = { tokenHash: 'pkce_abc123', verifyType: 'invite' };
const invite = (inviterName: string | null): TeamMailContent => ({ template: 'platform_invite', venueId: null, inviterName });

describe('renderTeamMail — platform_invite (company invite)', () => {
  it('a new address: fixed subject, the inviter, three steps, the one-time link and its 24-hour validity', () => {
    const m = renderTeamMail(invite('Joeri de Vries'), APP, LINK);
    expect(m.subject).toBe("You've been invited to try PlusOne");
    expect(m.text).toContain('Joeri de Vries invited you to run your guest lists on PlusOne.');
    const url = 'https://app.plus-one.io/auth/confirm?token_hash=pkce_abc123&type=invite&next=%2Fapp';
    expect(m.html).toContain(`href="${url.replace(/&/g, '&amp;')}"`);
    expect(m.text).toContain(`Get started: ${url}`);
    expect(m.text).toMatch(/1\. Tap Get started\. It signs you in/);
    expect(m.text).toMatch(/2\. Add your company/);
    expect(m.text).toMatch(/3\. Create your first event/);
    expect(m.text).toContain('expires after 24 hours');
    expect(m.text).toContain("Don't forward this email");
    expect(m.html).toContain('Button not working? Open');
    expect(m.text).toContain('support@plus-one.io');
    // Exactly one button.
    expect(m.html.match(/<a /g)?.length).toBe(1);
  });

  it('an account that can already log in: the /login button and no link warnings', () => {
    const m = renderTeamMail(invite('Joeri'), APP);
    expect(m.html).toContain('href="https://app.plus-one.io/login"');
    expect(m.text).toMatch(/1\. Tap Get started and enter this email address/);
    expect(m.text).not.toContain('24 hours');
    expect(m.text).not.toContain("Don't forward");
  });

  it('never mentions free, price or a trial (comped is the invite row, not the mail)', () => {
    for (const m of [renderTeamMail(invite('Joeri'), APP, LINK), renderTeamMail(invite('Joeri'), APP)]) {
      expect(m.text).not.toMatch(/free|price|€|trial|plan/i);
    }
  });

  it('escapes the inviter in HTML and keeps the subject free of the name', () => {
    const evil = '<a href="https://evil.test">Win</a> & "Co"';
    const m = renderTeamMail(invite(evil), APP, LINK);
    expect(m.html).not.toContain('<a href="https://evil.test">');
    expect(m.html).toContain('&lt;a href=&quot;https://evil.test&quot;&gt;Win&lt;/a&gt; &amp; &quot;Co&quot;');
    expect(m.subject).toBe("You've been invited to try PlusOne");
  });

  it('strips control characters and caps the name', () => {
    const m = renderTeamMail(invite(`Joeri\r\nBcc: x@evil.test${'x'.repeat(200)}`), APP);
    expect(m.text).not.toContain('\r');
    expect(m.text).toContain('Joeri Bcc: x@evil.test');
    expect(m.text).toContain('…');
  });

  it('falls back to "The PlusOne team" without an inviter name', () => {
    const m = renderTeamMail(invite(null), APP, LINK);
    expect(m.text).toContain('The PlusOne team invited you');
    expect(m.text).toContain('Ask The PlusOne team to send the invite again');
  });
});
