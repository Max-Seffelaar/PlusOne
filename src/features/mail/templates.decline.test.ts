/**
 * Decline mails (z8uq9m2yvp): the inviter hears WHICH ADDRESS declined (as typed
 * on the invite, never a profile name), the decliner gets a confirmation. Neither
 * carries login steps or a login button, and both are venue-less (no company cap).
 */
import { describe, expect, it } from 'vitest';
import { renderTeamMail, type TeamMailContent } from './templates';

const APP = 'https://app.plus-one.io';

const teamToInviter: TeamMailContent = {
  template: 'team_invite_declined',
  venueId: null,
  inviteeEmail: 'tom@crew.test',
  companyName: 'Club Vesper',
  crew: false,
  eventName: null,
};
const crewToInviter: TeamMailContent = { ...teamToInviter, crew: true, eventName: 'Friday Late' };
const teamConfirm: TeamMailContent = {
  template: 'team_invite_declined_confirm',
  venueId: null,
  companyName: 'Club Vesper',
  crew: false,
  eventName: null,
};
const crewConfirm: TeamMailContent = { ...teamConfirm, crew: true, eventName: 'Friday Late' };

describe('decline mail to the inviter', () => {
  it('team: names the typed address and the company', () => {
    const m = renderTeamMail(teamToInviter, APP);
    expect(m.subject).toBe('tom@crew.test declined your invite to Club Vesper');
    expect(m.text).toContain('tom@crew.test declined your invite to join Club Vesper on PlusOne.');
    expect(m.text).toContain('You got this email because you invited tom@crew.test to Club Vesper on PlusOne.');
  });

  it('crew: names the event too', () => {
    const m = renderTeamMail(crewToInviter, APP);
    expect(m.subject).toBe('tom@crew.test declined your crew invite for Friday Late');
    expect(m.html).toContain('the crew for Friday Late at Club Vesper');
  });

  it('crew without a readable event falls back, never a blank', () => {
    const m = renderTeamMail({ ...crewToInviter, eventName: null }, APP);
    expect(m.subject).toBe('tom@crew.test declined your crew invite for an event');
  });
});

describe('decline confirmation to the decliner', () => {
  it('team and crew read differently and say the company sees nothing', () => {
    const a = renderTeamMail(teamConfirm, APP);
    const b = renderTeamMail(crewConfirm, APP);
    expect(a.subject).toBe('You declined the invite to Club Vesper');
    expect(b.subject).toBe('You declined the crew invite for Friday Late');
    expect(a.text).toContain("Club Vesper can't see your details.");
    expect(b.text).toContain("Club Vesper can't see your details.");
  });
});

describe('both decline mails', () => {
  it('carry no login steps, no button and no login link', () => {
    for (const content of [teamToInviter, crewToInviter, teamConfirm, crewConfirm]) {
      const m = renderTeamMail(content, APP);
      expect(m.text).not.toContain('Getting in');
      expect(m.text).not.toContain('/login');
      expect(m.html).not.toContain('Getting in');
      expect(m.html).not.toContain('<ol');
      expect(m.html).not.toContain('/login');
    }
  });

  it('escape the typed address in the body and keep the subject plain text', () => {
    const m = renderTeamMail({ ...teamToInviter, inviteeEmail: '<b>x</b>"@evil.test' }, APP);
    expect(m.html).not.toContain('<b>x</b>');
    expect(m.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(m.subject).not.toMatch(/&lt;|&amp;/);
  });
});
