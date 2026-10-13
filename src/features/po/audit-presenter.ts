import type { IconName } from '@/components/po/icon';
import { t } from '@/lib/i18n';

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

const A = t.audit.actionLabel;

/**
 * Every action the audit triggers and the SECURITY DEFINER audit writers emit
 * (supabase/migrations: audit_trigger's derived vocabulary, the retention jobs'
 * 'anonymize', log_venue_export's 'export', set_platform_admin's grant/revoke).
 * A new action gets an entry here and a label in t.audit.actionLabel;
 * audit-presenter.test.ts fails when one renders as the generic fallback.
 */
export const AUDIT_ACTIONS = [
  'create',
  'update',
  'delete',
  'check_in',
  'refuse',
  'tier_change',
  'quota_grant',
  'approve',
  'deny',
  'lock',
  'unlock',
  'anonymize',
  'export',
  'platform_admin_grant',
  'platform_admin_revoke',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

const ACTION_META: Record<AuditAction, AuditActionMeta> = {
  create: { icon: 'plus', label: A.create },
  tier_change: { icon: 'swap', label: A.tierChange },
  check_in: { icon: 'door', label: A.checkIn },
  refuse: { icon: 'close', label: A.refuse },
  delete: { icon: 'minus', label: A.delete },
  update: { icon: 'cog', label: A.update },
  quota_grant: { icon: 'ticket', label: A.quotaGrant },
  approve: { icon: 'check', label: A.approve },
  deny: { icon: 'close', label: A.deny },
  lock: { icon: 'lock', label: A.lock },
  unlock: { icon: 'lock', label: A.unlock },
  anonymize: { icon: 'shield', label: A.anonymize },
  export: { icon: 'dl', label: A.export },
  platform_admin_grant: { icon: 'crown', label: A.platformAdminGrant },
  platform_admin_revoke: { icon: 'crown', label: A.platformAdminRevoke },
};

const FALLBACK: AuditActionMeta = { icon: 'history', label: A.fallback };

export function auditActionMeta(action: string): AuditActionMeta {
  return (ACTION_META as Record<string, AuditActionMeta>)[action] ?? FALLBACK;
}

export interface AuditActionFilter {
  key: string;
  label: string;
  /** The audit_log actions this chip matches; empty = no action filter. */
  actions: readonly AuditAction[];
}

// Action filter chips for the filter sheet (#15), in display order. 'all'
// clears the action filter. Lock + unlock share "List lock", anonymize + export
// share "Privacy". The platform-admin actions are not company-scoped (venue_id
// null), so they never show in a company's log and get no chip.
export const AUDIT_ACTION_FILTERS: AuditActionFilter[] = [
  { key: 'all', label: t.audit.filterAll, actions: [] },
  { key: 'check_in', label: A.checkIn, actions: ['check_in'] },
  { key: 'create', label: A.create, actions: ['create'] },
  { key: 'update', label: A.update, actions: ['update'] },
  { key: 'delete', label: A.delete, actions: ['delete'] },
  { key: 'tier_change', label: A.tierChange, actions: ['tier_change'] },
  { key: 'quota_grant', label: A.quotaGrant, actions: ['quota_grant'] },
  { key: 'approve', label: A.approve, actions: ['approve'] },
  { key: 'deny', label: A.deny, actions: ['deny'] },
  { key: 'refuse', label: A.refuse, actions: ['refuse'] },
  { key: 'lock', label: t.audit.filterListLock, actions: ['lock', 'unlock'] },
  { key: 'privacy', label: t.audit.filterPrivacy, actions: ['anonymize', 'export'] },
];

/**
 * The actions a filter key matches, for the feed query: null = no action
 * filter ('all' / none). An unknown key filters on itself, so a raw action
 * passed by another caller keeps working.
 */
export function auditFilterActions(key: string | undefined): readonly string[] | null {
  if (!key || key === 'all') return null;
  const chip = AUDIT_ACTION_FILTERS.find((f) => f.key === key);
  return chip ? chip.actions : [key];
}

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
