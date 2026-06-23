import { describe, it, expect } from 'vitest';
import {
  AUDIT_ACTION_FILTERS,
  auditActionMeta,
  guestStatusLabel,
  isDoorDevice,
} from './audit-presenter';

describe('auditActionMeta', () => {
  it('maps known actions to an icon + label', () => {
    expect(auditActionMeta('tier_change')).toEqual({ icon: 'swap', label: 'Tier' });
    expect(auditActionMeta('check_in').label).toBe('Check-in');
    expect(auditActionMeta('lock').icon).toBe('lock');
  });
  it('falls back for unknown actions', () => {
    expect(auditActionMeta('something_new')).toEqual({ icon: 'history', label: 'Action' });
  });
});

describe('guestStatusLabel', () => {
  it('translates known statuses', () => {
    expect(guestStatusLabel('checked_in')).toBe('Inside');
    expect(guestStatusLabel('removed')).toBe('Removed');
  });
  it('passes through unknown statuses unchanged', () => {
    expect(guestStatusLabel('mystery')).toBe('mystery');
  });
});

describe('isDoorDevice', () => {
  it('flags door / deur devices (case-insensitive)', () => {
    expect(isDoorDevice('door-ipad-01')).toBe(true);
    expect(isDoorDevice('Deur 1')).toBe(true);
  });
  it('does not flag the web device', () => {
    expect(isDoorDevice('web')).toBe(false);
  });
});

describe('AUDIT_ACTION_FILTERS', () => {
  it('starts with the "all" reset chip', () => {
    expect(AUDIT_ACTION_FILTERS[0]).toEqual({ key: 'all', label: 'All' });
  });
});
