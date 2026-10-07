// Pure date helper for the platform trial override (Billing G). Client-safe.

const BILLING_TZ = 'Europe/Amsterdam';

/**
 * The last second of a calendar day in Amsterdam, as a UTC instant — so
 * "Trial until 31 Oct" keeps the company open through the 31st there, in
 * summer (UTC+2) and winter (UTC+1) alike. null for anything that is not a
 * real calendar day.
 */
export function endOfDayInAmsterdam(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const naiveUtc = Date.UTC(y, mo - 1, d, 23, 59, 59);
  const check = new Date(naiveUtc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  // Amsterdam's offset at that moment: read the wall clock there for the naive
  // UTC instant and take the difference.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BILLING_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(check);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return new Date(naiveUtc - (wall - naiveUtc));
}
