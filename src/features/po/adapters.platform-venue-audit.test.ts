/**
 * Platform venue overview + audit viewer adapters (P-05, z8uq9m0tnx).
 *
 * `platform_venue_overview()`/`platform_audit_overview()` return several
 * columns that are nullable at runtime (no members yet, no subscription row,
 * no actor, no venue) even though a generated RETURNS TABLE type would call
 * them non-null. These tests pin the normalisation `toPlatformVenue` /
 * `toPlatformAuditEntry` are responsible for.
 */
import { describe, expect, it } from 'vitest';
import { toPlatformVenue, toPlatformVenueOption, toPlatformAuditEntry } from './adapters';
import type { PlatformVenueRow, PlatformVenueOption, PlatformAuditRow } from './queries';

function venueRow(over: Partial<PlatformVenueRow> = {}): PlatformVenueRow {
  return {
    venue_id: '018f3a2e-0000-7000-8000-000000000001',
    name: 'Club Vesper',
    slug: 'club-vesper',
    member_count: 5,
    event_count: 3,
    subscription_status: 'comped',
    last_activity_at: '2026-09-01T10:00:00.000Z',
    ...over,
  };
}

describe('toPlatformVenue', () => {
  it('maps a fully-populated row straight through', () => {
    const v = toPlatformVenue(venueRow());
    expect(v.venueId).toBe('018f3a2e-0000-7000-8000-000000000001');
    expect(v.memberCount).toBe(5);
    expect(v.eventCount).toBe(3);
    expect(v.subscriptionStatus).toBe('comped');
    expect(v.lastActivityAt).toBe('2026-09-01T10:00:00.000Z');
  });

  it('defaults counts to 0 rather than null/undefined', () => {
    const v = toPlatformVenue(venueRow({ member_count: null as unknown as number, event_count: null as unknown as number }));
    expect(v.memberCount).toBe(0);
    expect(v.eventCount).toBe(0);
  });

  it('keeps a missing subscription/activity as null, not a placeholder string', () => {
    const v = toPlatformVenue(venueRow({ subscription_status: null, last_activity_at: null }));
    expect(v.subscriptionStatus).toBeNull();
    expect(v.lastActivityAt).toBeNull();
  });
});

describe('toPlatformVenueOption', () => {
  it('maps id + name', () => {
    const row: PlatformVenueOption = { venue_id: 'v1', name: 'Zenith' };
    expect(toPlatformVenueOption(row)).toEqual({ venueId: 'v1', name: 'Zenith' });
  });
});

function auditRow(over: Partial<PlatformAuditRow> = {}): PlatformAuditRow {
  return {
    id: '018f3a2e-0000-7000-8000-00000000000a',
    created_at: '2026-09-01T10:00:00.000Z',
    actor_id: '018f3a2e-0000-7000-8000-00000000000b',
    actor_name: 'Watcher Wies',
    venue_id: '018f3a2e-0000-7000-8000-000000000001',
    venue_name: 'Club Vesper',
    event_id: null,
    entity_type: 'guests',
    entity_id: '018f3a2e-0000-7000-8000-00000000000c',
    action: 'update',
    diff: { before: { status: 'approved' }, after: { status: 'checked_in' } },
    device_id: 'door-1',
    is_support_action: true,
    ...over,
  };
}

describe('toPlatformAuditEntry', () => {
  it('maps a fully-populated row straight through', () => {
    const e = toPlatformAuditEntry(auditRow());
    expect(e.actorName).toBe('Watcher Wies');
    expect(e.venueName).toBe('Club Vesper');
    expect(e.isSupportAction).toBe(true);
    expect(e.diff).toEqual({ before: { status: 'approved' }, after: { status: 'checked_in' } });
  });

  it('leaves actor/venue name null (not a fallback string) so the screen decides the copy', () => {
    const e = toPlatformAuditEntry(auditRow({ actor_id: null, actor_name: null, venue_id: null, venue_name: null }));
    expect(e.actorId).toBeNull();
    expect(e.actorName).toBeNull();
    expect(e.venueId).toBeNull();
    expect(e.venueName).toBeNull();
  });

  it('coerces is_support_action strictly to a boolean', () => {
    expect(toPlatformAuditEntry(auditRow({ is_support_action: false })).isSupportAction).toBe(false);
    expect(
      toPlatformAuditEntry(auditRow({ is_support_action: null as unknown as boolean })).isSupportAction
    ).toBe(false);
  });

  it('keeps a null diff as null, never coerced to an empty object', () => {
    expect(toPlatformAuditEntry(auditRow({ diff: null })).diff).toBeNull();
  });
});
