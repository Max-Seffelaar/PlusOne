import { describe, it, expect } from 'vitest';
import {
  hasDashboardAccess,
  venueCapabilities,
  removalWouldOrphanVenue,
  roleChangeWouldOrphanVenue,
} from './access';

describe('hasDashboardAccess', () => {
  it('is true for admin, user_manager and finance', () => {
    expect(hasDashboardAccess(['admin'])).toBe(true);
    expect(hasDashboardAccess(['user_manager'])).toBe(true);
    expect(hasDashboardAccess(['finance'])).toBe(true);
    expect(hasDashboardAccess(['staff', 'finance'])).toBe(true);
  });
  it('is false for staff/doorhost only', () => {
    expect(hasDashboardAccess(['staff'])).toBe(false);
    expect(hasDashboardAccess(['doorhost', 'staff'])).toBe(false);
    expect(hasDashboardAccess([])).toBe(false);
  });
});

describe('venueCapabilities (mirrors the RLS role matrix)', () => {
  it('admin can do everything', () => {
    expect(venueCapabilities(['admin'])).toEqual({
      viewDashboard: true,
      viewSettings: true,
      editSettings: true,
      viewTeam: true,
      manageTeam: true,
      viewQuota: true,
      editQuota: true,
      viewAudit: true,
    });
  });

  it('user_manager manages the team but never settings or quota', () => {
    const caps = venueCapabilities(['user_manager']);
    expect(caps.manageTeam).toBe(true);
    expect(caps.viewTeam).toBe(true);
    expect(caps.editSettings).toBe(false);
    expect(caps.viewSettings).toBe(false);
    expect(caps.viewQuota).toBe(false);
    expect(caps.editQuota).toBe(false);
  });

  it('finance sees everything but edits nothing (read-only)', () => {
    const caps = venueCapabilities(['finance']);
    expect(caps.viewSettings).toBe(true);
    expect(caps.viewTeam).toBe(true);
    expect(caps.viewQuota).toBe(true);
    expect(caps.viewAudit).toBe(true);
    expect(caps.editSettings).toBe(false);
    expect(caps.manageTeam).toBe(false);
    expect(caps.editQuota).toBe(false);
  });

  it('only admin/finance may read the audit log', () => {
    expect(venueCapabilities(['admin']).viewAudit).toBe(true);
    expect(venueCapabilities(['finance']).viewAudit).toBe(true);
    expect(venueCapabilities(['user_manager']).viewAudit).toBe(false);
    expect(venueCapabilities(['staff']).viewAudit).toBe(false);
    expect(venueCapabilities(['doorhost']).viewAudit).toBe(false);
  });

  it('staff/doorhost get no dashboard', () => {
    expect(venueCapabilities(['staff']).viewDashboard).toBe(false);
    expect(venueCapabilities(['doorhost']).viewDashboard).toBe(false);
  });

  it('combines multiple roles (finance + user_manager)', () => {
    const caps = venueCapabilities(['finance', 'user_manager']);
    expect(caps.manageTeam).toBe(true); // from user_manager
    expect(caps.viewQuota).toBe(true); // from finance
    expect(caps.editQuota).toBe(false); // neither grants admin-only quota edit
    expect(caps.editSettings).toBe(false);
  });
});

describe('removalWouldOrphanVenue (last-admin guard)', () => {
  it('blocks removing the only admin', () => {
    expect(removalWouldOrphanVenue(['admin'], 0)).toBe(true);
    expect(removalWouldOrphanVenue(['admin', 'finance'], 0)).toBe(true);
  });
  it('allows removing an admin when another admin remains', () => {
    expect(removalWouldOrphanVenue(['admin'], 1)).toBe(false);
    expect(removalWouldOrphanVenue(['admin'], 3)).toBe(false);
  });
  it('never blocks removing a non-admin', () => {
    expect(removalWouldOrphanVenue(['staff'], 0)).toBe(false);
    expect(removalWouldOrphanVenue(['user_manager', 'finance'], 0)).toBe(false);
  });
});

describe('roleChangeWouldOrphanVenue (last-admin guard)', () => {
  it('blocks demoting the only admin', () => {
    expect(roleChangeWouldOrphanVenue(['admin'], ['user_manager'], 0)).toBe(true);
    expect(roleChangeWouldOrphanVenue(['admin', 'finance'], ['finance'], 0)).toBe(true);
  });
  it('allows demotion when another admin remains', () => {
    expect(roleChangeWouldOrphanVenue(['admin'], ['staff'], 1)).toBe(false);
  });
  it('allows changes that keep admin', () => {
    expect(roleChangeWouldOrphanVenue(['admin'], ['admin', 'finance'], 0)).toBe(false);
  });
  it('ignores non-admin members entirely', () => {
    expect(roleChangeWouldOrphanVenue(['staff'], ['doorhost'], 0)).toBe(false);
  });
});
