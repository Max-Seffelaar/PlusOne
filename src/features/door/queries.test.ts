import { describe, expect, it } from 'vitest';
import { DOOR_GUEST_SELECT, projectDoorGuest, type GuestRowFull } from './queries';

// A full guests row as it arrives from a realtime payload / server read, with
// every unshown-PII column populated so the projection has something to drop.
const FULL: GuestRowFull = {
  id: 'g1',
  event_id: 'ev1',
  venue_id: 'v1',
  tier_id: 't1',
  full_name: 'Tess Bakker',
  email: 'tess@example.com',
  phone: '+31612345678',
  contact_id: 'c1',
  plus_ones: 2,
  note: 'VIP',
  note_priority: 'high',
  note_acknowledged_by: 'u1',
  note_acknowledged_at: '2026-06-10T12:00:00Z',
  added_by: 'u-max',
  source: 'app',
  status: 'approved',
  request_link_id: 'rl1',
  anonymized_at: null,
  removed_at: null,
  created_at: '2026-06-10T12:00:00Z',
  updated_at: '2026-06-10T13:00:00Z',
};

const EXPECTED_KEYS = [
  'id',
  'event_id',
  'full_name',
  'phone',
  'plus_ones',
  'tier_id',
  'status',
  'note',
  'note_priority',
  'note_acknowledged_at',
  'note_acknowledged_by',
  'added_by',
  'created_at',
].sort();

describe('projectDoorGuest (P-IDB7)', () => {
  it('drops email and every other unshown column from the snapshot row', () => {
    const row = projectDoorGuest(FULL);
    expect(Object.keys(row).sort()).toEqual(EXPECTED_KEYS);
    // The AVG win: no email in the object that gets persisted to IndexedDB.
    expect('email' in row).toBe(false);
    expect('contact_id' in row).toBe(false);
    expect('venue_id' in row).toBe(false);
    expect('updated_at' in row).toBe(false);
  });

  it('keeps phone — the door renders its last 4 digits (#27)', () => {
    expect(projectDoorGuest(FULL).phone).toBe('+31612345678');
  });

  it('preserves the rendered values verbatim', () => {
    const row = projectDoorGuest(FULL);
    expect(row).toMatchObject({
      id: 'g1',
      full_name: 'Tess Bakker',
      plus_ones: 2,
      tier_id: 't1',
      status: 'approved',
      note: 'VIP',
      note_priority: 'high',
      added_by: 'u-max',
    });
  });
});

describe('DOOR_GUEST_SELECT', () => {
  it('lists exactly the projected columns (guards select ↔ type drift)', () => {
    const cols = DOOR_GUEST_SELECT.split(',').map((c) => c.trim());
    expect(cols.slice().sort()).toEqual(EXPECTED_KEYS);
  });
});
