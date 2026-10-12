import { describe, it, expect } from 'vitest';
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_FILTERS,
  auditActionMeta,
  auditFilterActions,
  guestStatusLabel,
  isDoorDevice,
} from './audit-presenter';

describe('auditActionMeta', () => {
  it('maps known actions to an icon + label', () => {
    expect(auditActionMeta('tier_change')).toEqual({ icon: 'swap', label: 'Tier' });
    expect(auditActionMeta('check_in').label).toBe('Check-in');
    expect(auditActionMeta('lock').icon).toBe('lock');
  });

  it('labels the retention, export and platform-admin actions', () => {
    expect(auditActionMeta('anonymize')).toEqual({ icon: 'shield', label: 'Anonymized' });
    expect(auditActionMeta('export')).toEqual({ icon: 'dl', label: 'Export' });
    expect(auditActionMeta('platform_admin_grant').label).toBe('Admin granted');
    expect(auditActionMeta('platform_admin_revoke').label).toBe('Admin revoked');
    expect(auditActionMeta('unlock').label).toBe('Unlocked');
  });

  it('no emitted action type renders as the generic "Action" label', () => {
    for (const action of AUDIT_ACTIONS) {
      const meta = auditActionMeta(action);
      expect(meta.label, action).not.toBe('Action');
      expect(meta.icon, action).not.toBe('history');
    }
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
    expect(AUDIT_ACTION_FILTERS[0]).toEqual({ key: 'all', label: 'All', actions: [] });
  });

  it('every company-scoped action is reachable through exactly one chip', () => {
    // platform_admin_* rows have venue_id null: never in a company's log.
    const companyActions = AUDIT_ACTIONS.filter((a) => !a.startsWith('platform_admin_'));
    for (const action of companyActions) {
      const chips = AUDIT_ACTION_FILTERS.filter((f) => f.actions.includes(action));
      expect(chips.map((c) => c.key), action).toHaveLength(1);
    }
  });

  it('chip keys are unique and every chip has a label', () => {
    const keys = AUDIT_ACTION_FILTERS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of AUDIT_ACTION_FILTERS) expect(f.label.length).toBeGreaterThan(0);
  });

  it('groups lock + unlock and anonymize + export', () => {
    expect(auditFilterActions('lock')).toEqual(['lock', 'unlock']);
    expect(auditFilterActions('privacy')).toEqual(['anonymize', 'export']);
    expect(AUDIT_ACTION_FILTERS.find((f) => f.key === 'lock')?.label).toBe('List lock');
    expect(AUDIT_ACTION_FILTERS.find((f) => f.key === 'privacy')?.label).toBe('Privacy');
  });

  it('auditFilterActions: none for "all", itself for an unknown key', () => {
    expect(auditFilterActions(undefined)).toBeNull();
    expect(auditFilterActions('all')).toBeNull();
    expect(auditFilterActions('check_in')).toEqual(['check_in']);
    expect(auditFilterActions('raw_action')).toEqual(['raw_action']);
  });
});
