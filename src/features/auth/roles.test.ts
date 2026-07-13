import { describe, it, expect } from 'vitest';
import {
  requiresMfa,
  canGrantRoles,
  mergeRoles,
  isManager,
  hasRole,
  canManageGuests,
  canSeeGuestCounts,
  canSeeRequestInbox,
  canDecideRequests,
  canSeeOwnRequests,
  canSeeAnyRequests,
  isDoorOnlyRole,
} from './roles';

describe('requiresMfa', () => {
  it('is true for admin and finance', () => {
    expect(requiresMfa(['admin'])).toBe(true);
    expect(requiresMfa(['finance'])).toBe(true);
    expect(requiresMfa(['staff', 'admin'])).toBe(true);
  });
  it('is false for non-sensitive roles', () => {
    expect(requiresMfa(['staff'])).toBe(false);
    expect(requiresMfa(['doorhost', 'staff'])).toBe(false);
    expect(requiresMfa(['user_manager'])).toBe(false);
    expect(requiresMfa([])).toBe(false);
  });
});

describe('canManageGuests (mirrors RLS can_write_guests)', () => {
  it('is true for admin, staff, doorhost', () => {
    expect(canManageGuests(['admin'])).toBe(true);
    expect(canManageGuests(['staff'])).toBe(true);
    expect(canManageGuests(['doorhost'])).toBe(true);
    expect(canManageGuests(['user_manager', 'staff'])).toBe(true);
  });
  it('is false for a pure user_manager or finance (no guest rights)', () => {
    expect(canManageGuests(['user_manager'])).toBe(false);
    expect(canManageGuests(['finance'])).toBe(false);
    expect(canManageGuests(['user_manager', 'finance'])).toBe(false);
    expect(canManageGuests([])).toBe(false);
  });
});

describe('canSeeGuestCounts (mirrors guests-select RLS — M9, K-7)', () => {
  it('is true for admin, finance, staff, doorhost', () => {
    expect(canSeeGuestCounts(['admin'])).toBe(true);
    expect(canSeeGuestCounts(['finance'])).toBe(true);
    expect(canSeeGuestCounts(['staff'])).toBe(true);
    expect(canSeeGuestCounts(['doorhost'])).toBe(true);
  });
  it('is false for a pure user_manager (RLS always returns zero rows)', () => {
    expect(canSeeGuestCounts(['user_manager'])).toBe(false);
    expect(canSeeGuestCounts([])).toBe(false);
  });
  it('is true when user_manager is combined with a guest-read role', () => {
    expect(canSeeGuestCounts(['user_manager', 'staff'])).toBe(true);
  });
});

describe('requests role-hide (M1/M3, K-4/K-5/K-8)', () => {
  it('canSeeRequestInbox: admin and finance only', () => {
    expect(canSeeRequestInbox(['admin'])).toBe(true);
    expect(canSeeRequestInbox(['finance'])).toBe(true);
    expect(canSeeRequestInbox(['staff'])).toBe(false);
    expect(canSeeRequestInbox(['doorhost'])).toBe(false);
    expect(canSeeRequestInbox(['user_manager'])).toBe(false);
    expect(canSeeRequestInbox([])).toBe(false);
  });

  it('canDecideRequests: admin only — finance is read-only (K-5)', () => {
    expect(canDecideRequests(['admin'])).toBe(true);
    expect(canDecideRequests(['finance'])).toBe(false);
    expect(canDecideRequests(['staff'])).toBe(false);
    expect(canDecideRequests(['doorhost'])).toBe(false);
    expect(canDecideRequests(['admin', 'finance'])).toBe(true);
  });

  it('canSeeOwnRequests: staff without inbox rights only — never doorhost/user_manager (K-8)', () => {
    expect(canSeeOwnRequests(['staff'])).toBe(true);
    expect(canSeeOwnRequests(['doorhost'])).toBe(false);
    expect(canSeeOwnRequests(['user_manager'])).toBe(false);
    expect(canSeeOwnRequests([])).toBe(false);
  });

  it('canSeeOwnRequests is false once a staff member also has inbox rights', () => {
    // Admin's full inbox wins — no separate "own requests" framing needed.
    expect(canSeeOwnRequests(['staff', 'admin'])).toBe(false);
    expect(canSeeOwnRequests(['staff', 'finance'])).toBe(false);
  });

  it('canSeeAnyRequests: inbox roles + staff, never doorhost/user_manager alone', () => {
    expect(canSeeAnyRequests(['admin'])).toBe(true);
    expect(canSeeAnyRequests(['finance'])).toBe(true);
    expect(canSeeAnyRequests(['staff'])).toBe(true);
    expect(canSeeAnyRequests(['doorhost'])).toBe(false);
    expect(canSeeAnyRequests(['user_manager'])).toBe(false);
    expect(canSeeAnyRequests([])).toBe(false);
  });
});

describe('canGrantRoles (escalation guard — mirrors RLS)', () => {
  it('lets an admin grant anything, including admin', () => {
    expect(canGrantRoles(['admin'], ['admin'])).toBe(true);
    expect(canGrantRoles(['admin'], ['staff', 'doorhost'])).toBe(true);
  });
  it('lets a user_manager grant non-admin roles', () => {
    expect(canGrantRoles(['user_manager'], ['staff'])).toBe(true);
    expect(canGrantRoles(['user_manager'], ['finance', 'doorhost'])).toBe(true);
  });
  it('never lets a user_manager grant admin', () => {
    expect(canGrantRoles(['user_manager'], ['admin'])).toBe(false);
    expect(canGrantRoles(['user_manager'], ['staff', 'admin'])).toBe(false);
  });
  it('refuses non-managers entirely', () => {
    expect(canGrantRoles(['staff'], ['staff'])).toBe(false);
    expect(canGrantRoles(['doorhost'], ['doorhost'])).toBe(false);
    expect(canGrantRoles(['finance'], ['staff'])).toBe(false);
  });
  it('refuses an empty target role set', () => {
    expect(canGrantRoles(['admin'], [])).toBe(false);
  });
});

describe('mergeRoles', () => {
  it('unions and de-duplicates in canonical order', () => {
    expect(mergeRoles(['staff'], ['doorhost'])).toEqual(['staff', 'doorhost']);
    expect(mergeRoles(['doorhost'], ['admin', 'staff'])).toEqual(['admin', 'staff', 'doorhost']);
    expect(mergeRoles(['staff'], ['staff'])).toEqual(['staff']);
  });
});

describe('isDoorOnlyRole (person-profile role-awareness — G4, K-8, mirrors contacts_select RLS)', () => {
  it('is true for a pure doorhost', () => {
    expect(isDoorOnlyRole(['doorhost'])).toBe(true);
  });
  it('is true combined with staff — the seed door@ persona is exactly {doorhost, staff}, and staff has no contacts access either', () => {
    expect(isDoorOnlyRole(['doorhost', 'staff'])).toBe(true);
  });
  it('is false once a contacts-capable role is also held (multi-role, CLAUDE.md #8)', () => {
    expect(isDoorOnlyRole(['doorhost', 'admin'])).toBe(false);
    expect(isDoorOnlyRole(['doorhost', 'finance'])).toBe(false);
    expect(isDoorOnlyRole(['doorhost', 'staff', 'admin'])).toBe(false);
  });
  it('is false without doorhost, regardless of other roles', () => {
    expect(isDoorOnlyRole(['staff'])).toBe(false);
    expect(isDoorOnlyRole(['admin'])).toBe(false);
    expect(isDoorOnlyRole(['finance'])).toBe(false);
    expect(isDoorOnlyRole(['user_manager'])).toBe(false);
    expect(isDoorOnlyRole(['staff', 'user_manager'])).toBe(false);
  });
  it('is false for empty roles — a pure event-organizer gets the benefit of the doubt (M3 precedent)', () => {
    expect(isDoorOnlyRole([])).toBe(false);
  });
});

describe('isManager / hasRole', () => {
  it('isManager covers admin + user_manager only', () => {
    expect(isManager(['admin'])).toBe(true);
    expect(isManager(['user_manager'])).toBe(true);
    expect(isManager(['finance'])).toBe(false);
    expect(isManager(['staff', 'doorhost'])).toBe(false);
  });
  it('hasRole checks membership', () => {
    expect(hasRole(['staff', 'doorhost'], 'doorhost')).toBe(true);
    expect(hasRole(['staff'], 'admin')).toBe(false);
  });
});
