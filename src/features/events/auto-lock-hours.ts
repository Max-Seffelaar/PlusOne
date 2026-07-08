/**
 * "Hours before doors" -> a negative minute offset for auto-lock (lock that many
 * hours before the event starts), Dutch-decimal tolerant (C23: a plain Number()
 * turns "1,5" into NaN, which the caller was previously saving as null while the
 * UI still claimed the list would lock).
 */
export function parseAutoLockOffsetMinutes(hoursText: string): number | null | undefined {
  const trimmed = hoursText.trim();
  if (trimmed === '') return null;
  const hours = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(hours) || hours <= 0) return undefined;
  return -Math.round(hours * 60);
}
