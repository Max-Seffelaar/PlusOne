/**
 * The /r/[token] status page's one adapter: `get_request_status` jsonb → the
 * view the page renders (#28, #43(f), amended z8uq9m0hw6).
 *
 * The RPC is the boundary for what a token holder may see: it returns the
 * venue address, the approved count and the venue message for an APPROVED
 * request only, never to a mirror token, and `{found:false}` for everything it
 * does not recognise. This adapter re-applies the same state gate anyway, so a
 * payload that ever carries more than it should still renders no more than
 * the state allows. Anything that does not parse is the neutral not-found.
 */
import { formatTime, formatWeekdayDate } from '@/features/po/format';
import { fmt, t } from '@/lib/i18n';
import { requestStatusPayloadSchema } from './schemas';

export type RequestStatusData = {
  status: 'pending' | 'approved' | 'denied';
  fullName: string;
  /** Plus-ones as REQUESTED. The headcount asked for is 1 + plusOnes. */
  plusOnes: number;
  /** Plus-ones as APPROVED, set only when the venue approved fewer than asked. */
  approvedPlusOnes: number | null;
  eventName: string;
  /** "Sun 27 Sept" (Amsterdam). */
  date: string;
  /** "23:00 to 05:00", "From 23:00", or '' when the start is unknown. */
  time: string;
  /** "Warmoesstraat 12, 1012 JD Amsterdam"; approved requests only. */
  address: string | null;
  /** The venue's plain-text message; approved requests only. */
  message: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function validIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

/** "23:00 to 05:00" for a night that crosses midnight (#26), the end's date too
 *  when the event runs a day or longer, "From 23:00" without an end. */
export function formatEventTimes(startsAt: string | null | undefined, endsAt: string | null | undefined): string {
  const start = validIso(startsAt);
  if (!start) return '';
  const end = validIso(endsAt);
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Number.NaN;
  if (!end || !(endMs > startMs)) return fmt(t.landing.statusTimeFrom, { start: formatTime(start) });
  const endLabel = endMs - startMs >= DAY_MS ? `${formatWeekdayDate(end)} ${formatTime(end)}` : formatTime(end);
  return fmt(t.landing.statusTimeRange, { start: formatTime(start), end: endLabel });
}

/** One line: street, then postal code + city. Null when nothing is set. */
export function formatVenueAddress(
  line: string | null | undefined,
  postalCode: string | null | undefined,
  city: string | null | undefined,
): string | null {
  const clean = (s: string | null | undefined): string => (s ?? '').trim();
  const place = [clean(postalCode), clean(city)].filter(Boolean).join(' ');
  const out = [clean(line), place].filter(Boolean).join(', ');
  return out.length > 0 ? out : null;
}

export function toRequestStatusView(data: unknown, now: Date = new Date()): RequestStatusData | null {
  const parsed = requestStatusPayloadSchema.safeParse(data);
  if (!parsed.success) return null;
  const p = parsed.data;

  const approved = p.status === 'approved';
  const plusOnes = p.plus_ones ?? 0;
  const approvedPlusOnes =
    approved && p.approved_plus_ones != null && p.approved_plus_ones < plusOnes ? p.approved_plus_ones : null;
  const message = approved ? (p.decision_message ?? '').trim() : '';

  return {
    status: p.status,
    fullName: p.full_name ?? '',
    plusOnes,
    approvedPlusOnes,
    eventName: p.event_name,
    date: formatWeekdayDate(validIso(p.starts_at) ?? now.toISOString()),
    time: formatEventTimes(p.starts_at, p.ends_at),
    address: approved ? formatVenueAddress(p.venue_address_line, p.venue_postal_code, p.venue_city) : null,
    message: message.length > 0 ? message : null,
  };
}
