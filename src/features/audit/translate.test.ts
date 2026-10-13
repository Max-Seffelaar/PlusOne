import { describe, expect, it } from 'vitest';
import { auditPersonIds, describeAuditEntry, formatWhen, type AuditFeedRow } from './translate';
import { ActorLabels } from './actor-labels';

// Minimal audit_feed row factory — only the fields the translator reads.
function row(overrides: Partial<AuditFeedRow>): AuditFeedRow {
  return {
    id: 'a1',
    actor_id: 'u-max',
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
    location_name: null,
    ...overrides,
  };
}

describe('describeAuditEntry', () => {
  it('names a data export (legal v0.3 E1) instead of "changed the venue settings"', () => {
    const venue = describeAuditEntry(
      row({ entity_type: 'venues', entity_id: 'v1', action: 'export', event_id: null, event_name: null,
            diff: { scope: 'venue', rows: { guests: 3, contacts: 2, requests: 1, door: 2 } } }),
    );
    expect(venue.text).toBe('exported the venue data');
    expect(venue.entity).toBe('the venue');
    const event = describeAuditEntry(row({ entity_type: 'venues', action: 'export', diff: { scope: 'event' } }));
    expect(event.text).toBe('exported the event data');
    expect(event.entity).toBe('FRENZY');
  });

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

  it('names the spots an (adjusted) quota approval granted (z8uq9m5kux)', () => {
    const line = describeAuditEntry(
      row({
        entity_type: 'quota_requests',
        action: 'approve',
        guest_name: null,
        subject_name: 'Tom Bakker',
        diff: { before: { status: 'pending', approved_extra: null }, after: { status: 'approved', approved_extra: 1 } },
      })
    );
    expect(line.text).toBe('approved 1 more spot for Tom Bakker');
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
    expect(line.text).toBe("changed Lisa's roles (Staff → Staff, Door host)");
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
        actor_id: null,
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
    expect(describeAuditEntry(row({ actor_id: null, actor_name: null })).actor).toBe('System');
  });

  // ── Who did it: one rule (spec #64a) ──────────────────────────────────────
  // The view's actor_name/subject_name are RLS-scoped (can_view_profile), so a
  // former member or a PlusOne operator comes back null there; the labels from
  // venue_actor_names win.
  describe('actor labels (#64a)', () => {
    const labels = new ActorLabels()
      .setActor('u-former', 'Lisa van den Berg', 'member')
      .setActor('u-op', 'PlusOne support', 'support');

    it('names a former member the view could no longer resolve', () => {
      const line = describeAuditEntry(row({ actor_id: 'u-former', actor_name: null }), labels);
      expect(line.actor).toBe('Lisa van den Berg');
    });

    it('shows an operator without a tie as PlusOne support, even if the view named them', () => {
      const line = describeAuditEntry(row({ actor_id: 'u-op', actor_name: 'Secret Operator' }), labels);
      expect(line.actor).toBe('PlusOne support');
    });

    it('keeps "System" for no actor, whatever the labels', () => {
      expect(describeAuditEntry(row({ actor_id: null, actor_name: null }), labels).actor).toBe('System');
    });

    it('labels the subject of a membership change the same way', () => {
      const line = describeAuditEntry(
        row({
          entity_type: 'venue_memberships',
          action: 'delete',
          subject_user_id: 'u-former',
          subject_name: null,
          guest_name: null,
        }),
        labels,
      );
      expect(line.text).toBe("removed Lisa van den Berg's access");
    });

    it('falls back to the view name without a label (RPC not deployed yet)', () => {
      expect(describeAuditEntry(row({ actor_id: 'u-max' }), new Map()).actor).toBe('Max');
    });

    it('carries the actor KIND so the screen renders labels typed (review #466 r3)', () => {
      expect(describeAuditEntry(row({ actor_id: 'u-op', actor_name: null }), labels).actorKind).toBe('support');
      expect(describeAuditEntry(row({ actor_id: 'u-former', actor_name: null }), labels).actorKind).toBe('member');
      expect(describeAuditEntry(row({ actor_id: null, actor_name: null }), labels).actorKind).toBe('system');
      expect(describeAuditEntry(row({ actor_id: 'u-x', actor_name: null }), labels).actorKind).toBe('unknown');
    });

    it('a member NAMED "System" (with an invisible suffix) is kind member, never system', () => {
      const lri = String.fromCodePoint(0x2066);
      const named = new ActorLabels().setActor('u-sys', `System${lri}`, 'member');
      const line = describeAuditEntry(row({ actor_id: 'u-sys', actor_name: null }), named);
      expect(line.actor).toBe(`System${lri}`);
      expect(line.actorKind).toBe('member');
    });

    it('carries the SUBJECT as a ref with its kind, slotted in the template (review #466 r4)', () => {
      const line = describeAuditEntry(
        row({ entity_type: 'venue_memberships', action: 'delete', subject_user_id: 'u-op', subject_name: null, guest_name: null }),
        labels,
      );
      expect(line.subject).toEqual({ text: 'PlusOne support', kind: 'support' });
      expect(line.subjectParts).toEqual({ before: 'removed ', after: "'s access" });
      expect(line.text).toBe("removed PlusOne support's access");
    });

    it('an unresolved subject is the i18n "a user", kind unknown; no subject → no template', () => {
      const line = describeAuditEntry(
        row({ entity_type: 'quotas', action: 'quota_grant', subject_user_id: 'u-x', subject_name: null, guest_name: null,
              diff: { before: null, after: { default_count: 5 } } }),
        new ActorLabels(),
      );
      expect(line.subject).toEqual({ text: 'a user', kind: 'unknown' });
      expect(line.text).toBe('granted a user an venue quota of 5');
      expect(describeAuditEntry(row({ action: 'delete' }), labels).subject).toBeUndefined();
    });

    it('a guest NAMED "{subject}" cannot forge or hide a subject (review #466 r5)', () => {
      // A guest line: no subject entity, so no subject at all, and the name is literal text.
      const guestLine = describeAuditEntry(row({ action: 'delete', guest_name: '{subject}' }), labels);
      expect(guestLine.subject).toBeUndefined();
      expect(guestLine.text).toBe('removed {subject} (soft delete)');
      // A quota-request deny whose free-text reason says "{subject}": the real
      // requester stays the subject, the reason stays text.
      const deny = describeAuditEntry(
        row({
          entity_type: 'quota_requests', action: 'deny', subject_user_id: 'u-former', subject_name: null, guest_name: null,
          diff: { before: null, after: { decision_reason: '{subject} tried this' } },
        }),
        labels,
      );
      expect(deny.subject).toEqual({ text: 'Lisa van den Berg', kind: 'member' });
      expect(deny.subjectParts).toEqual({ before: 'denied the quota request from ', after: ', {subject} tried this' });
    });

    it('a member name containing replacement patterns ($&, $`, $\') is inserted literally', () => {
      const name = 'A$&B$`C$\'D';
      const tricky = new ActorLabels().setActor('u-t', name, 'member');
      const line = describeAuditEntry(
        row({ entity_type: 'venue_memberships', action: 'delete', subject_user_id: 'u-t', subject_name: null, guest_name: null }),
        tricky,
      );
      expect(line.text).toBe(`removed ${name}'s access`);
      expect(line.subject?.text).toBe(name);
    });

    it('the RLS-name fallback goes through the same blank → "Unnamed" rule', () => {
      const blank = String.fromCodePoint(0x3164);
      const line = describeAuditEntry(row({ actor_id: 'u-max', actor_name: blank }), new ActorLabels());
      expect(line.actor).toBe('Unnamed');
      expect(line.actorKind).toBe('unnamed');
      expect(describeAuditEntry(row({ actor_id: 'u-max' }), new ActorLabels()).actorKind).toBe('member');
    });

    it('never calls a real actor "System" when labels are missing: "Unknown" (review #466 N2)', () => {
      // A former member / operator: RLS hides the view name, and the label RPC failed.
      const line = describeAuditEntry(row({ actor_id: 'u-former', actor_name: null }), new Map());
      expect(line.actor).toBe('Unknown');
      expect(line.actor).not.toBe('System');
    });

    it('collects actor and subject ids once, skipping nulls', () => {
      expect(
        auditPersonIds([
          row({ actor_id: 'u-max', subject_user_id: 'u-former' }),
          row({ actor_id: 'u-max', subject_user_id: null }),
          row({ actor_id: null }),
        ]),
      ).toEqual(['u-max', 'u-former']);
    });
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

// ── Tables audited after the first phases (z8uq audit-fallback-copy) ────────
// Rows shaped like the trigger output (audit_trigger: full snapshot on create,
// changed fields only on update) and the SECURITY DEFINER RPCs' direct rows.
describe('describeAuditEntry: every audited table reads as a sentence', () => {
  // A company-scoped row: no event, no guest.
  const company = (overrides: Partial<AuditFeedRow>) =>
    row({ event_id: null, event_name: null, guest_id: null, guest_name: null, ...overrides });

  describe('subscriptions', () => {
    it('the onboarding insert starts the free trial (was "create on subscriptions")', () => {
      const line = describeAuditEntry(
        company({
          entity_type: 'subscriptions',
          action: 'create',
          diff: { before: null, after: { status: 'trialing', plan_id: 'pro', trial_ends_at: null, stripe_customer_id: null } },
        }),
      );
      expect(line.text).toBe('started the free trial');
      expect(line.entity).toBe('the subscription');
    });

    it('an insert with a trial end names the date', () => {
      const line = describeAuditEntry(
        company({
          entity_type: 'subscriptions',
          action: 'create',
          diff: { before: null, after: { status: 'trialing', trial_ends_at: '2026-10-26T23:00:00+00:00' } },
        }),
      );
      expect(line.text).toBe('started the free trial, until 27 Oct 2026');
    });

    it('a comped insert or flip is "always free"', () => {
      expect(
        describeAuditEntry(
          company({ entity_type: 'subscriptions', action: 'create', diff: { before: null, after: { status: 'comped' } } }),
        ).text,
      ).toBe('marked the company as always free');
      // set_venue_comped(true): status + trial_ends_at cleared.
      expect(
        describeAuditEntry(
          company({
            entity_type: 'subscriptions',
            action: 'update',
            diff: {
              before: { status: 'trialing', trial_ends_at: '2026-11-01T00:00:00+00:00' },
              after: { status: 'comped', trial_ends_at: null },
            },
          }),
        ).text,
      ).toBe('marked the company as always free');
    });

    it('set_venue_comped(false) on a comped company is a fresh trial', () => {
      const line = describeAuditEntry(
        company({
          entity_type: 'subscriptions',
          action: 'update',
          diff: {
            before: { status: 'comped', trial_ends_at: null },
            after: { status: 'trialing', trial_ends_at: '2026-10-25T10:00:00+00:00' },
          },
        }),
      );
      expect(line.text).toBe('turned off always free, trial until 25 Oct 2026');
    });

    it('set_venue_trial_end names the new end date', () => {
      const line = describeAuditEntry(
        company({
          entity_type: 'subscriptions',
          action: 'update',
          diff: {
            before: { trial_ends_at: '2026-10-20T10:00:00+00:00' },
            after: { trial_ends_at: '2026-12-31T10:00:00+00:00' },
          },
        }),
      );
      expect(line.text).toBe('set the trial to end on 31 Dec 2026');
    });

    it('the ADE invite row (diff.source) says why the trial got longer', () => {
      const line = describeAuditEntry(
        company({
          entity_type: 'subscriptions',
          action: 'update',
          diff: {
            before: { trial_ends_at: null },
            after: { trial_ends_at: '2026-10-26T23:00:00+00:00' },
            source: 'platform_invite_ade',
            platform_invite_id: 'pi-1',
          },
        }),
      );
      expect(line.text).toBe('extended the trial to 27 Oct 2026 with a free until end of ADE invite');
    });

    it('a webhook status change reads as a status, by System', () => {
      const line = describeAuditEntry(
        company({
          entity_type: 'subscriptions',
          action: 'update',
          actor_id: null,
          actor_name: null,
          diff: {
            before: { status: 'trialing', stripe_subscription_id: null },
            after: { status: 'past_due', stripe_subscription_id: 'sub_123' },
          },
        }),
      );
      expect(line.actor).toBe('System');
      expect(line.text).toBe('set the subscription to payment overdue');
    });

    it('a billing interval switch, and a bookkeeping-only update', () => {
      expect(
        describeAuditEntry(
          company({
            entity_type: 'subscriptions',
            action: 'update',
            diff: { before: { billing_interval: 'month' }, after: { billing_interval: 'year' } },
          }),
        ).text,
      ).toBe('switched billing to yearly');
      expect(
        describeAuditEntry(
          company({
            entity_type: 'subscriptions',
            action: 'update',
            diff: { before: { stripe_customer_id: null }, after: { stripe_customer_id: 'cus_1' } },
          }),
        ).text,
      ).toBe('updated the subscription');
    });
  });

  describe('contacts', () => {
    it('a new contact is named (was "create on contacts")', () => {
      const line = describeAuditEntry(
        company({
          entity_type: 'contacts',
          action: 'create',
          diff: {
            before: null,
            after: { full_name: 'Lotte de Wit', email: 'lotte@example.test', phone: '+31600000000', source: 'manual' },
          },
        }),
      );
      expect(line.text).toBe('added a contact: Lotte de Wit');
      expect(line.text).not.toMatch(/@|\+316/);
      expect(line.entity).toBe('Lotte de Wit');
    });

    it('an update names the contact only when the name is in the diff', () => {
      expect(
        describeAuditEntry(
          company({ entity_type: 'contacts', action: 'update', diff: { before: { note: null }, after: { note: 'VIP' } } }),
        ).text,
      ).toBe('updated a contact');
      expect(
        describeAuditEntry(
          company({
            entity_type: 'contacts',
            action: 'update',
            diff: { before: { full_name: 'Lotte Wit' }, after: { full_name: 'Lotte de Wit' } },
          }),
        ).text,
      ).toBe('updated the contact Lotte de Wit');
    });

    it('anonymization never prints the pre-anonymization name', () => {
      // The anonymizing UPDATE still carries the real name in `before`.
      const update = describeAuditEntry(
        company({
          entity_type: 'contacts',
          action: 'update',
          diff: {
            before: { full_name: 'Lotte de Wit', anonymized_at: null },
            after: { full_name: 'Contact #12', anonymized_at: '2027-06-01T03:00:00Z' },
          },
        }),
      );
      expect(update.text).toBe('anonymized a contact');
      const job = describeAuditEntry(
        company({
          entity_type: 'contacts',
          action: 'anonymize',
          actor_id: null,
          actor_name: null,
          diff: { before: null, after: { anonymized_at: '2027-06-01T03:00:00Z', redacted_fields: ['full_name'] } },
        }),
      );
      expect(job.text).toBe('anonymized a contact');
    });

    it('a stored name with replacement patterns or "{subject}" is inserted literally', () => {
      const name = 'A$&B$`C$\'D {subject}';
      const line = describeAuditEntry(
        company({ entity_type: 'contacts', action: 'create', diff: { before: null, after: { full_name: name } } }),
      );
      expect(line.text).toBe(`added a contact: ${name}`);
      expect(line.subjectParts).toBeUndefined();
    });

    it('a removed contact', () => {
      expect(
        describeAuditEntry(
          company({ entity_type: 'contacts', action: 'delete', diff: { before: { full_name: 'Lotte de Wit' }, after: null } }),
        ).text,
      ).toBe('removed the contact Lotte de Wit');
    });
  });

  describe('door: check-out and corrections', () => {
    it('a check-out voids the check-in (was "checked in")', () => {
      const line = describeAuditEntry(
        row({
          entity_type: 'check_ins',
          action: 'update',
          diff: { before: { voided_at: null, voided_by: null }, after: { voided_at: '2026-06-20T23:00:00Z', voided_by: 'u-max' } },
        }),
      );
      expect(line.text).toBe('checked out Juri Braakman');
    });

    it('a partial check-out puts the smaller party back in', () => {
      const line = describeAuditEntry(
        row({
          entity_type: 'check_ins',
          action: 'update',
          diff: {
            before: { voided_at: '2026-06-20T23:00:00Z', plus_ones_arrived: 3 },
            after: { voided_at: null, plus_ones_arrived: 1 },
          },
        }),
      );
      expect(line.text).toBe('checked Juri Braakman back in +1');
    });

    it('an arrivals-only correction, and a refusal update', () => {
      expect(
        describeAuditEntry(
          row({ entity_type: 'check_ins', action: 'update', diff: { before: { plus_ones_arrived: 1 }, after: { plus_ones_arrived: 2 } } }),
        ).text,
      ).toBe("changed Juri Braakman's check-in to +2");
      expect(
        describeAuditEntry(
          row({ entity_type: 'refusals', action: 'update', diff: { before: { reason: 'x' }, after: { reason: 'y' } } }),
        ).text,
      ).toBe('changed the refusal for Juri Braakman');
    });
  });

  it('retention anonymization of a guest and a request', () => {
    expect(
      describeAuditEntry(
        row({ action: 'anonymize', actor_id: null, actor_name: null, guest_name: 'Guest #4', diff: { before: null, after: { anonymized_at: '2027-01-01T00:00:00Z' } } }),
      ).text,
    ).toBe('anonymized Guest #4');
    expect(
      describeAuditEntry(
        row({
          entity_type: 'guest_requests',
          action: 'anonymize',
          guest_name: null,
          request_name: 'Request #9',
          diff: { before: null, after: { anonymized_at: '2027-01-01T00:00:00Z' } },
        }),
      ).text,
    ).toBe('anonymized the request from Request #9');
  });

  it('the per-event default crew quota', () => {
    const line = describeAuditEntry(
      row({
        entity_type: 'events',
        action: 'update',
        guest_name: null,
        diff: { before: { default_member_quota: 5 }, after: { default_member_quota: 8 } },
      }),
    );
    expect(line.text).toBe('set the default crew quota for FRENZY to 8');
  });

  describe('invites', () => {
    const invite = (action: string, diff: AuditFeedRow['diff']) =>
      describeAuditEntry(company({ entity_type: 'invites', action, diff })).text;

    it('names the roles, never the e-mail address', () => {
      const text = invite('create', {
        before: null,
        after: { email: 'new.hire@example.test', roles: ['doorhost', 'user_manager'], event_ids: [] },
      });
      expect(text).toBe('invited someone to the team (User manager, Door host)');
      expect(text).not.toContain('@');
      expect(invite('create', { before: null, after: { email: 'dj@example.test', roles: [], event_ids: ['e1'] } })).toBe(
        'invited someone to the external crew',
      );
    });

    it('accept, decline, resend, cancel', () => {
      expect(invite('update', { before: { accepted_at: null }, after: { accepted_at: '2026-10-01T10:00:00Z' } })).toBe(
        'accepted the invite',
      );
      expect(invite('update', { before: { declined_at: null }, after: { declined_at: '2026-10-01T10:00:00Z' } })).toBe(
        'declined the invite',
      );
      expect(invite('update', { before: { expires_at: '2026-10-01T10:00:00Z' }, after: { expires_at: '2026-10-08T10:00:00Z' } })).toBe(
        'resent an invite',
      );
      expect(invite('delete', { before: { email: 'x@example.test', roles: ['staff'] }, after: null })).toBe('canceled an invite');
    });
  });

  it('influencers, templates, and template tiers are named', () => {
    const t1 = describeAuditEntry(
      company({ entity_type: 'influencers', action: 'create', diff: { before: null, after: { name: 'Lotte', handle: '@lotte' } } }),
    );
    expect(t1.text).toBe('added the influencer Lotte');
    expect(
      describeAuditEntry(
        company({ entity_type: 'influencers', action: 'update', diff: { before: { archived_at: null }, after: { archived_at: '2026-10-01T00:00:00Z' } } }),
      ).text,
    ).toBe('archived an influencer');
    expect(
      describeAuditEntry(
        company({ entity_type: 'event_templates', action: 'create', diff: { before: null, after: { name: 'Friday club night' } } }),
      ).text,
    ).toBe('created the template Friday club night');
    expect(
      describeAuditEntry(
        company({ entity_type: 'event_templates', action: 'update', diff: { before: { capacity: 200 }, after: { capacity: 250 } } }),
      ).text,
    ).toBe('updated a template');
    expect(
      describeAuditEntry(
        company({ entity_type: 'event_template_tiers', action: 'delete', diff: { before: { name: 'VIP' }, after: null } }),
      ).text,
    ).toBe('removed tier VIP from a template');
  });

  it('platform invites and platform admin rights (Platform tab)', () => {
    const pi = (action: string, diff: AuditFeedRow['diff']) =>
      describeAuditEntry(company({ venue_id: null, entity_type: 'platform_invites', action, diff })).text;
    expect(pi('create', { before: null, after: { email: 'owner@example.test', free_until_ade: true } })).toBe(
      'sent a platform invite, free until end of ADE',
    );
    expect(pi('create', { before: null, after: { email: 'owner@example.test', free_until_ade: false } })).toBe(
      'sent a platform invite',
    );
    expect(pi('update', { before: { revoked_at: null }, after: { revoked_at: '2026-10-01T00:00:00Z' } })).toBe(
      'revoked a platform invite',
    );
    expect(pi('update', { before: { ade_trial_venue_id: null }, after: { ade_trial_venue_id: 'v9' } })).toBe(
      'used a free until end of ADE invite',
    );
    expect(pi('update', { before: { last_sent_at: null }, after: { last_sent_at: '2026-10-01T00:00:00Z' } })).toBe(
      'resent a platform invite',
    );

    const admin = (action: string) =>
      describeAuditEntry(
        company({
          venue_id: null,
          entity_type: 'user_profiles',
          action,
          diff: { before: { is_platform_admin: false }, after: { is_platform_admin: true } },
        }),
      ).text;
    expect(admin('platform_admin_grant')).toBe('granted platform admin rights');
    expect(admin('platform_admin_revoke')).toBe('revoked platform admin rights');
  });

  describe('fallback', () => {
    it('a table without its own case reads as a plain verb, never "<action> on <table>"', () => {
      // A table name that can never be real (company_locations gets its own case in #467).
      const line = (action: string) =>
        describeAuditEntry(company({ entity_type: 'zz_future_table', action, diff: { before: null, after: { name: 'Main room' } } }));
      expect(line('create').text).toBe('added a record');
      expect(line('update').text).toBe('updated a record');
      expect(line('delete').text).toBe('removed a record');
      expect(line('merge').text).toBe('made a change');
      expect(line('create').entity).toBe('a record');
    });

    it('no audited table x action ever prints a raw table name or action verb', () => {
      // Every table with an audit trigger or a direct audit_log writer
      // (supabase/migrations), and every action the trigger/RPCs emit.
      const tables = [
        'guests', 'guest_tiers', 'quotas', 'event_quotas', 'quota_requests', 'check_ins', 'refusals',
        'venue_memberships', 'events', 'venues', 'invites', 'guest_requests', 'contacts', 'event_templates',
        'event_template_tiers', 'request_links', 'influencers', 'subscriptions', 'platform_invites',
        'user_profiles', 'company_locations', 'zz_future_table',
      ];
      const actions = [
        'create', 'update', 'delete', 'check_in', 'refuse', 'tier_change', 'quota_grant', 'approve', 'deny',
        'lock', 'unlock', 'anonymize', 'export', 'platform_admin_grant', 'platform_admin_revoke',
      ];
      // Every role in both diff sides, so any line that lists roles is exercised.
      const allRoles = ['admin', 'user_manager', 'finance', 'staff', 'doorhost'];
      const rawRoleKey = /\b(admin|user_manager|finance|staff|doorhost)\b/; // lowercase enum values
      const diffs = [
        { before: {}, after: {} },
        { before: { roles: ['staff'] }, after: { roles: allRoles } },
        { before: null, after: { roles: allRoles } },
        // The events location update and a company_locations rename + archive (#467).
        {
          before: { location_name: null, location_address: null },
          after: { location_name: 'Main room', location_address: 'Keizersgracht 1' },
        },
        {
          before: { name: 'Old room', archived_at: null },
          after: { name: 'Main room', archived_at: '2026-10-01T00:00:00Z' },
        },
      ];
      for (const entity_type of tables) {
        for (const action of actions) {
          for (const diff of diffs) {
            const { text } = describeAuditEntry(row({ entity_type, action, diff }));
            const where = `${entity_type} × ${action} × ${JSON.stringify(diff)}`;
            expect(text, where).not.toContain(entity_type);
            expect(text, where).not.toMatch(/_/);
            expect(text, where).not.toMatch(new RegExp(`^${action} on `));
            // "platform admin rights" is copy, not a role key.
            expect(text.replace(/platform admin/g, ''), where).not.toMatch(rawRoleKey);
          }
        }
      }
    });

    it('lists roles with the app role labels, never the enum keys', () => {
      const membership = describeAuditEntry(
        company({
          entity_type: 'venue_memberships',
          action: 'create',
          subject_name: 'Noor van Dijk',
          subject_user_id: 'u-noor',
          diff: { before: null, after: { user_id: 'u-noor', roles: ['user_manager'] } },
        }),
      );
      expect(membership.text).toBe('gave Noor van Dijk access (User manager)');
      const multi = describeAuditEntry(
        company({
          entity_type: 'venue_memberships',
          action: 'create',
          subject_name: 'Sam',
          diff: { before: null, after: { roles: ['staff', 'doorhost'] } },
        }),
      );
      // UI role order (VENUE_ROLES), not the array's order.
      expect(multi.text).toBe('gave Sam access (Staff, Door host)');
      const unknown = describeAuditEntry(
        company({ entity_type: 'invites', action: 'create', diff: { before: null, after: { roles: ['night_manager'] } } }),
      );
      expect(unknown.text).toBe('invited someone to the team (night manager)');
    });
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

// z8uq9m49k2 — location changes are audited (company_locations + events.location_*).
describe('describeAuditEntry — locations', () => {
  const loc = (action: string, diff: AuditFeedRow['diff']) =>
    describeAuditEntry(row({ entity_type: 'company_locations', entity_id: 'l1', action, event_id: null, event_name: null, guest_name: null, diff }));

  it('names saved-location writes', () => {
    expect(loc('create', { before: null, after: { name: 'Paradiso' } }).text).toBe('added the location Paradiso');
    expect(loc('update', { before: { name: 'Paradiso' }, after: { name: 'Paradiso Noord' } }).text).toBe(
      'renamed the location Paradiso to Paradiso Noord',
    );
    expect(loc('update', { before: { archived_at: null }, after: { archived_at: '2026-10-11T10:00:00Z' } }).text).toBe(
      'archived a saved location',
    );
    expect(loc('update', { before: { archived_at: '2026-10-11T10:00:00Z' }, after: { archived_at: null } }).text).toBe(
      'restored a saved location',
    );
    expect(loc('update', { before: { city: 'A' }, after: { city: 'B' } }).text).toBe('updated a saved location');
    expect(loc('delete', { before: { name: 'Paradiso' }, after: null }).text).toBe('removed the location Paradiso');
  });

  it('falls back to the current name audit_feed resolves when the diff has none (#467 test 10)', () => {
    const named = (diff: AuditFeedRow['diff'], location_name: string | null) =>
      describeAuditEntry(row({ entity_type: 'company_locations', entity_id: 'l1', action: 'update', event_id: null, event_name: null, guest_name: null, location_name, diff }));
    const r = named({ before: { archived_at: null }, after: { archived_at: '2026-10-11T10:00:00Z' } }, 'Melkweg');
    expect(r.text).toBe('archived the location Melkweg');
    expect(r.entity).toBe('Melkweg');
    // Company-level: no event, so the Event column renders its "—".
    expect(r.event).toBe('');
    expect(named({ before: { city: 'A' }, after: { city: 'B' } }, 'Melkweg').text).toBe('updated the location Melkweg');
    // The diff's own name wins (the name at the time), not today's.
    expect(named({ before: { name: 'Paradiso' }, after: { name: 'Paradiso Noord' } }, 'Later Name').text).toBe(
      'renamed the location Paradiso to Paradiso Noord',
    );
  });

  const ev = (diff: AuditFeedRow['diff']) =>
    describeAuditEntry(row({ entity_type: 'events', entity_id: 'e1', action: 'update', diff }));

  it('names an event location change with the whole new location', () => {
    expect(ev({ before: { location_name: null, location_address: null }, after: { location_name: 'Melkweg', location_address: 'Lijnbaansgracht 234A' } }).text).toBe(
      'set the location of FRENZY to Melkweg, Lijnbaansgracht 234A',
    );
    // Only the address changed: an unchanged column is not in the diff.
    expect(ev({ before: { location_address: 'Old 1' }, after: { location_address: 'New 2' } }).text).toBe(
      'set the location of FRENZY to New 2',
    );
    expect(ev({ before: { location_name: 'Melkweg', location_address: 'X' }, after: { location_name: null, location_address: null } }).text).toBe(
      'cleared the location of FRENZY',
    );
  });

  it('a lock still reads as a lock, even if the same edit touched the location', () => {
    const r = describeAuditEntry(row({ entity_type: 'events', action: 'lock', diff: { before: { list_locked: false, location_name: null }, after: { list_locked: true, location_name: 'X' } } }));
    expect(r.text).toBe('locked the list');
  });
});
