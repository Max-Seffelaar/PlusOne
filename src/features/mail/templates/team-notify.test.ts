/**
 * Team notification mails (guest mail 6b): one request, a bundled hour, a
 * quota request, both decisions, the daily summary; numbers exact, nothing of
 * the guest beyond a first name, every value escaped, the unsubscribe and
 * settings links in every mail.
 */
import { describe, expect, it } from 'vitest';
import { renderTeamNotify, type TeamNotifyContent } from './team-notify';

const EVENT = { id: 'ee000000-0000-7000-8000-000000000001', name: 'Neon Friday', startsAt: '2026-10-16T21:00:00.000Z' };
const base: TeamNotifyContent = {
  type: 'team_request',
  firstName: 'Max',
  company: 'Club Vesper',
  event: EVENT,
  count: 1,
  request: { firstName: 'Lotte', plusOnes: 1 },
  appUrl: 'https://app.plus-one.io/',
  unsubscribeUrl: 'https://app.plus-one.io/n/tok',
};

describe('renderTeamNotify', () => {
  it('one request: who, how many people, which event, and the review button', () => {
    const r = renderTeamNotify(base);
    expect(r.subject).toBe('Lotte asked for a spot at Neon Friday');
    expect(r.text).toContain('Hi Max,');
    expect(r.text).toContain('Lotte asked for a spot on the list for Neon Friday: 2 people.');
    expect(r.text).toContain('Friday 16 October · Doors 23:00');
    expect(r.buttonUrl).toBe(`https://app.plus-one.io/app/requests?event=${EVENT.id}`);
  });

  it('a request without a first name, and a bundled hour', () => {
    expect(renderTeamNotify({ ...base, request: { firstName: null, plusOnes: 0 } }).subject).toBe('New request for Neon Friday');
    const many = renderTeamNotify({ ...base, count: 12, request: null });
    expect(many.subject).toBe('12 new requests for Neon Friday');
    expect(many.text).toContain('12 requests for Neon Friday came in over the last hour.');
  });

  it('a quota request names the team member and the exact extra spots', () => {
    const r = renderTeamNotify({ ...base, type: 'team_quota', request: null, quota: { requester: 'Tom Bakker', extra: 3 } });
    expect(r.subject).toBe('Tom Bakker wants 3 more guests for Neon Friday');
    expect(r.buttonUrl).toBe(`https://app.plus-one.io/app/requests/quota?event=${EVENT.id}`);
  });

  it('the decision, approved and declined', () => {
    const yes = renderTeamNotify({ ...base, type: 'team_decision', request: null, decision: { status: 'approved', extra: 2 } });
    expect(yes.subject).toBe('You got 2 more guests for Neon Friday');
    const no = renderTeamNotify({ ...base, type: 'team_decision', request: null, decision: { status: 'denied', extra: 2 } });
    expect(no.subject).toBe('Your quota request for Neon Friday');
    expect(no.text).toContain("wasn't approved this time");
  });

  it('the daily summary: counts per event per company, the total in the subject', () => {
    const r = renderTeamNotify({
      ...base,
      type: 'team_digest',
      event: null,
      request: null,
      digest: [
        { name: 'Club Vesper', events: [{ name: 'Neon Friday', startsAt: EVENT.startsAt, requests: 3, quota: 1 }] },
        { name: 'De Marktzaal', events: [{ name: 'Crew Night', startsAt: EVENT.startsAt, requests: 1, quota: 0 }] },
      ],
    });
    expect(r.subject).toBe('5 open requests waiting');
    expect(r.text).toContain('Neon Friday, Friday 16 October: 3 guest requests, 1 quota request');
    expect(r.text).toContain('Crew Night, Friday 16 October: 1 guest request');
    expect(r.text).toContain('De Marktzaal');
  });

  it('every mail carries the settings link, the unsubscribe link and the support line', () => {
    for (const r of [renderTeamNotify(base), renderTeamNotify({ ...base, type: 'team_decision', decision: { status: 'approved', extra: 1 } })]) {
      expect(r.text).toContain('https://app.plus-one.io/app/profile');
      expect(r.text).toContain("Don't want these emails? Stop them: https://app.plus-one.io/n/tok");
      expect(r.html).toContain('href="https://app.plus-one.io/n/tok"');
      expect(r.text).toContain('support@plus-one.io');
    }
  });

  it('escapes names and strips control characters from the subject', () => {
    const r = renderTeamNotify({ ...base, request: { firstName: '<b>Evil</b>\r\nBcc: x@y.z', plusOnes: 0 }, event: { ...EVENT, name: 'A & B <script>' } });
    expect(r.html).not.toContain('<b>Evil</b>');
    expect(r.html).not.toContain('<script>');
    expect(r.subject).not.toMatch(/[\r\n]/);
  });
});
