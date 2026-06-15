// Effective-lock state, mirrored from public.can_write_guests in
// 20260613210000_event_auto_lock.sql: a list is locked when it is manually
// locked OR its scheduled auto-lock instant has passed. The DB is the boundary;
// this only lets the UI show the banner and disable inputs at the right moment.

export function isEffectivelyLocked(
  listLocked: boolean,
  autoLockAt: string | null,
  now: Date = new Date()
): boolean {
  if (listLocked) return true;
  if (!autoLockAt) return false;
  const at = new Date(autoLockAt);
  return !Number.isNaN(at.getTime()) && at.getTime() <= now.getTime();
}
