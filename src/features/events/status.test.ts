import { describe, it, expect } from 'vitest';
import {
  EVENT_STATUSES,
  isValidTransition,
  transitionRequiresAdmin,
  allowedTransitions,
  type EventStatus,
} from './status';

// These mirror is_valid_event_status_transition /
// event_transition_requires_admin in 20260613200000_event_management.sql. If the
// graph changes in the DB, it must change here too — this suite is the canary.

const VALID: ReadonlyArray<[EventStatus, EventStatus]> = [
  ['draft', 'open'],
  ['draft', 'closed'],
  ['open', 'live'],
  ['open', 'closed'],
  ['open', 'draft'],
  ['live', 'closed'],
  ['live', 'open'],
  ['closed', 'open'],
];

const ADMIN_ONLY: ReadonlyArray<[EventStatus, EventStatus]> = [
  ['open', 'draft'],
  ['live', 'open'],
  ['closed', 'open'],
];

describe('isValidTransition (graph)', () => {
  it('accepts exactly the allowed edges', () => {
    for (const [from, to] of VALID) {
      expect(isValidTransition(from, to)).toBe(true);
    }
  });

  it('rejects illegal jumps and no-ops', () => {
    const allowed = new Set(VALID.map(([f, t]) => `${f}->${t}`));
    for (const from of EVENT_STATUSES) {
      for (const to of EVENT_STATUSES) {
        if (allowed.has(`${from}->${to}`)) continue;
        expect(isValidTransition(from, to)).toBe(false);
      }
    }
  });

  it('rejects the specific fraud-relevant skips', () => {
    expect(isValidTransition('draft', 'live')).toBe(false);
    expect(isValidTransition('closed', 'live')).toBe(false);
    expect(isValidTransition('live', 'draft')).toBe(false);
    expect(isValidTransition('open', 'open')).toBe(false);
  });
});

describe('transitionRequiresAdmin (corrective reversals)', () => {
  it('flags exactly the admin-only reversals', () => {
    const adminSet = new Set(ADMIN_ONLY.map(([f, t]) => `${f}->${t}`));
    for (const [from, to] of VALID) {
      expect(transitionRequiresAdmin(from, to)).toBe(adminSet.has(`${from}->${to}`));
    }
  });

  it('forward steps are not admin-only', () => {
    expect(transitionRequiresAdmin('draft', 'open')).toBe(false);
    expect(transitionRequiresAdmin('open', 'live')).toBe(false);
    expect(transitionRequiresAdmin('live', 'closed')).toBe(false);
  });
});

describe('allowedTransitions (per role, mirrors the trigger WHO rule)', () => {
  it('an organizer sees only forward steps', () => {
    expect(allowedTransitions('open', { isAdmin: false }).map((t) => t.to).sort()).toEqual(
      ['closed', 'live'].sort()
    );
    // No reversal to draft for a non-admin.
    expect(allowedTransitions('open', { isAdmin: false }).some((t) => t.to === 'draft')).toBe(false);
    // closed has only an admin-only reopen → organizer sees nothing.
    expect(allowedTransitions('closed', { isAdmin: false })).toEqual([]);
  });

  it('an admin sees forward steps plus corrective reversals', () => {
    expect(allowedTransitions('open', { isAdmin: true }).map((t) => t.to).sort()).toEqual(
      ['closed', 'draft', 'live'].sort()
    );
    expect(allowedTransitions('live', { isAdmin: true }).map((t) => t.to).sort()).toEqual(
      ['closed', 'open'].sort()
    );
    expect(allowedTransitions('closed', { isAdmin: true }).map((t) => t.to)).toEqual(['open']);
  });

  it('never offers a move the graph would reject', () => {
    for (const from of EVENT_STATUSES) {
      for (const isAdmin of [true, false]) {
        for (const t of allowedTransitions(from, { isAdmin })) {
          expect(isValidTransition(from, t.to)).toBe(true);
          if (t.requiresAdmin) expect(isAdmin).toBe(true);
        }
      }
    }
  });
});
