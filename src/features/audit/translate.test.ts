import { describe, expect, it } from 'vitest';
import { describeAuditEntry, formatWhen, type AuditFeedRow } from './translate';

// Minimal audit_feed row factory — only the fields the translator reads.
function row(overrides: Partial<AuditFeedRow>): AuditFeedRow {
  return {
    id: 'a1',
    actor_id: null,
    actor_name: 'Max',
    venue_id: 'v1',
    event_id: 'e1',
    event_name: 'FRENZY',
    entity_type: 'guests',
    entity_id: 'g1',
    action: 'update',
    diff: null,
    device_id: null,
    created_at: '2026-06-20T21:14:00+00:00',
    guest_id: 'g1',
    guest_name: 'Juri Braakman',
    subject_user_id: null,
    subject_name: null,
    old_tier_name: null,
    new_tier_name: null,
    request_name: null,
    ...overrides,
  };
}

describe('describeAuditEntry', () => {
  it('translates a tier change to the hero sentence (#15)', () => {
    const line = describeAuditEntry(
      row({
        action: 'tier_change',
        old_tier_name: 'Regular',
        new_tier_name: 'VIP',
        diff: { before: { tier_id: 't1' }, after: { tier_id: 't2' } },
      })
    );
    expect(line.actor).toBe('Max');
    expect(line.text).toBe('moved Juri Braakman from Regular to VIP');
    expect(line.entity).toBe('Juri Braakman');
    expect(line.guestId).toBe('g1');
  });

  it('describes a guest create with its tier', () => {
    const line = describeAuditEntry(
      row({ action: 'create', new_tier_name: 'VIP', diff: { before: null, after: { full_name: 'Juri Braakman' } } })
    );
    expect(line.text).toBe('added Juri Braakman (VIP)');
  });

  it('describes a door check-in with plus-ones arrived', () => {
    const line = describeAuditEntry(
      row({
        entity_type: 'check_ins',
        action: 'check_in',
        device_id: 'door-ipad-01',
        diff: { before: null, after: { guest_id: 'g1', plus_ones_arrived: 2 } },
      })
    );
    expect(line.text).toBe('checked in Juri Braakman +2 at the door');
    expect(line.device).toBe('door-ipad-01');
  });

  it('describes a refusal with its reason', () => {
    const line = describeAuditEntry(
      row({
        entity_type: 'refusals',
        action: 'refuse',
        diff: { before: null, after: { guest_id: 'g1', reason: 'Geen geldig ID' } },
      })
    );
    expect(line.text).toBe('refused Juri Braakman, reason: Geen geldig ID');
  });

  it('describes a soft delete', () => {
    const line = describeAuditEntry(row({ action: 'delete' }));
    expect(line.text).toBe('removed Juri Braakman (soft delete)');
  });

  it('describes the "Heads up!" note acknowledgement (#39)', () => {
    const line = describeAuditEntry(
      row({ action: 'update', diff: { before: { note_acknowledged_at: null }, after: { note_acknowledged_at: '2026-06-20T22:00:00Z' } } })
    );
    expect(line.text).toBe('acknowledged the heads-up note on Juri Braakman');
  });

  it('describes a plus-ones change', () => {
    const line = describeAuditEntry(
      row({ action: 'update', diff: { before: { plus_ones: 1 }, after: { plus_ones: 3 } } })
    );
    expect(line.text).toBe('changed Juri Braakman to +3 (was +1)');
  });

  it('describes an event quota grant with the raise', () => {
    const line = describeAuditEntry(
      row({
        entity_type: 'event_quotas',
        action: 'quota_grant',
        guest_name: null,
        subject_name: 'Tom Bakker',
        subject_user_id: 'u5',
        diff: { before: { quota_override: 10 }, after: { quota_override: 13 } },
      })
    );
    expect(line.text).toBe('raised the event quota for Tom Bakker (10 → 13)');
    expect(line.entity).toBe('Tom Bakker');
  });

  it('describes a quota request approval', () => {
    const line = describeAuditEntry(
      row({
        entity_type: 'quota_requests',
        action: 'approve',
        guest_name: null,
        subject_name: 'Tom Bakker',
        diff: { before: { status: 'pending' }, after: { status: 'approved' } },
      })
    );
    expect(line.text).toBe('approved the quota request from Tom Bakker');
  });

  it('describes a membership role change', () => {
    const line = describeAuditEntry(
      row({
        entity_type: 'venue_memberships',
        action: 'update',
        guest_name: null,
        subject_name: 'Lisa',
        diff: { before: { roles: ['staff'] }, after: { roles: ['staff', 'doorhost'] } },
      })
    );
    expect(line.text).toBe("changed Lisa's roles (staff → staff, doorhost)");
  });

  it('describes a landing-page request decision (#12)', () => {
    const approve = describeAuditEntry(
      row({
        entity_type: 'guest_requests',
        action: 'approve',
        guest_name: null,
        diff: { before: { status: 'pending', full_name: 'Mara Visser' }, after: { status: 'approved', full_name: 'Mara Visser' } },
      })
    );
    expect(approve.text).toBe('approved the landing page request from Mara Visser');
    const deny = describeAuditEntry(
      row({
        entity_type: 'guest_requests',
        action: 'deny',
        guest_name: null,
        diff: { before: { full_name: 'Mara Visser' }, after: { full_name: 'Mara Visser', decision_reason: 'Vol' } },
      })
    );
    expect(deny.text).toBe('denied the landing page request from Mara Visser, Vol');
  });

  it('resolves the requester via request_name when the diff has no name (F1)', () => {
    // Real decision diffs carry only the changed fields — the feed joins the
    // live request row into request_name instead.
    const line = describeAuditEntry(
      row({
        entity_type: 'guest_requests',
        action: 'approve',
        guest_name: null,
        request_name: 'Robin Castelijns',
        diff: { before: { status: 'pending' }, after: { status: 'approved' } },
      })
    );
    expect(line.text).toBe('approved the landing page request from Robin Castelijns');
  });

  it('marks an auto-approval as done by the request link (F1)', () => {
    const line = describeAuditEntry(
      row({
        entity_type: 'guest_requests',
        action: 'approve',
        actor_name: null,
        guest_name: null,
        request_name: 'Demo Autogast',
        diff: {
          before: { status: 'pending' },
          after: { status: 'approved', decided_via: 'auto' },
        },
      })
    );
    expect(line.actor).toBe('System');
    expect(line.text).toBe('auto-approved the request from Demo Autogast via their request link');
  });

  it('describes lock / unlock', () => {
    expect(describeAuditEntry(row({ entity_type: 'events', action: 'lock', guest_name: null })).text).toBe(
      'locked the list'
    );
    expect(describeAuditEntry(row({ entity_type: 'events', action: 'unlock', guest_name: null })).text).toBe(
      'unlocked the list'
    );
  });

  it('falls back to "System" for a null actor', () => {
    expect(describeAuditEntry(row({ actor_name: null })).actor).toBe('System');
  });

  it('describes request_links actions (W3)', () => {
    const created = describeAuditEntry(
      row({
        entity_type: 'request_links',
        action: 'create',
        guest_name: null,
        diff: { before: null, after: { label: 'Instagram bio' } },
      })
    );
    expect(created.text).toBe('created the request link "Instagram bio"');
    expect(created.entity).toBe('Instagram bio');

    const createdDefault = describeAuditEntry(
      row({
        entity_type: 'request_links',
        action: 'create',
        guest_name: null,
        diff: { before: null, after: { label: null, is_default: true } },
      })
    );
    expect(createdDefault.text).toBe('created a request link');

    const paused = describeAuditEntry(
      row({
        entity_type: 'request_links',
        action: 'update',
        guest_name: null,
        diff: { before: { active: true, label: 'Instagram bio' }, after: { active: false, label: 'Instagram bio' } },
      })
    );
    expect(paused.text).toBe('paused the request link "Instagram bio"');

    const archived = describeAuditEntry(
      row({
        entity_type: 'request_links',
        action: 'update',
        guest_name: null,
        diff: { before: { archived_at: null }, after: { archived_at: '2026-07-09T21:00:00Z' } },
      })
    );
    expect(archived.text).toBe('archived a request link');
  });
});

describe('formatWhen', () => {
  const now = new Date('2026-06-20T12:00:00+02:00'); // Amsterdam midday

  it('labels same-day entries "Today HH:MM" in Amsterdam TZ', () => {
    // 21:14Z = 23:14 in Amsterdam (+02 summer time).
    expect(formatWhen('2026-06-20T21:14:00Z', now)).toBe('Today 23:14');
  });

  it('labels the previous day "Yesterday HH:MM"', () => {
    expect(formatWhen('2026-06-19T18:00:00+02:00', now)).toBe('Yesterday 18:00');
  });

  it('labels anything older than yesterday by its date (no weekday)', () => {
    // Within a week (2026-06-16) now shows the date, not "Tue".
    expect(formatWhen('2026-06-16T20:30:00+02:00', now)).toBe('16 Jun 20:30');
    // Older than a week stays a date too.
    expect(formatWhen('2026-06-01T20:30:00+02:00', now)).toBe('1 Jun 20:30');
  });

  it('returns empty string for a missing timestamp', () => {
    expect(formatWhen('', now)).toBe('');
  });
});
