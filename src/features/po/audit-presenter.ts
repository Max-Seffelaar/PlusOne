import type { IconName } from '@/components/po/icon';

// Pure presentation helpers for the mobile audit-log (S10). The heavy lifting —
// turning an audit_feed row into a sentence ("Max moved Juri from Regular to
// VIP") — lives in src/features/audit/translate.ts
// (describeAuditEntry/formatWhen) and is SHARED with the desktop /admin/audit
// screen. Here we only map the derived `action` onto a row glyph + short label
// and translate a guest's status, so desktop and mobile read identically. No I/O,
// no React — unit-tested directly (audit-presenter.test.ts), mirroring
// features/stats/po-adapter.ts.

export interface AuditActionMeta {
  icon: IconName;
  /** Short label for the action chip / timeline marker. */
  label: string;
}

// One entry per derived action the audit triggers can emit (see translate.ts).
const ACTION_META: Record<string, AuditActionMeta> = {
  create: { icon: 'plus', label: 'Added' },
  tier_change: { icon: 'swap', label: 'Tier' },
  check_in: { icon: 'door', label: 'Check-in' },
  refuse: { icon: 'close', label: 'Refused' },
  delete: { icon: 'minus', label: 'Removed' },
  update: { icon: 'cog', label: 'Change' },
  quota_grant: { icon: 'ticket', label: 'Quota' },
  approve: { icon: 'check', label: 'Approved' },
  deny: { icon: 'close', label: 'Declined' },
  lock: { icon: 'lock', label: 'Locked' },
  unlock: { icon: 'lock', label: 'Unlocked' },
};

const FALLBACK: AuditActionMeta = { icon: 'history', label: 'Action' };

export function auditActionMeta(action: string): AuditActionMeta {
  return ACTION_META[action] ?? FALLBACK;
}

// Action filter chips for the filter sheet — mirrors the desktop AuditFilters set
// (#15), in display order. 'all' clears the action filter.
export const AUDIT_ACTION_FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'check_in', label: 'Check-in' },
  { key: 'create', label: 'Added' },
  { key: 'tier_change', label: 'Tier' },
  { key: 'quota_grant', label: 'Quota' },
  { key: 'approve', label: 'Approved' },
  { key: 'refuse', label: 'Refused' },
  { key: 'lock', label: 'Locked' },
];

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved: 'On the list',
  denied: 'Declined',
  checked_in: 'Inside',
  refused: 'Refused',
  removed: 'Removed',
};

/** Label for a guest's current status (per-guest history header). */
export function guestStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** Door devices get the accent treatment, mirroring the desktop AuditTable. */
export function isDoorDevice(device: string): boolean {
  return /deur|door/i.test(device);
}
