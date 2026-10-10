/**
 * The /r/[token] status page's one adapter: `get_request_status` jsonb → the
 * view the page renders (#28, #43(f), amended z8uq9m0hw6).
 *
 * The RPC is the boundary for what a token holder may see: it returns the
 * approved count and the venue message for an APPROVED request only, never to
 * a mirror token, and `{found:false}` for everything it does not recognise.
 * This adapter re-applies the same state gate anyway, so a payload that ever
 * carries more than it should still renders no more than the state allows.
 * Anything that does not parse is the neutral not-found.
 *
 * Location (z8uq9m444c, spec #48(c) revised): the page shows the EVENT's own
 * location in every state, never the company address. The legacy
 * `venue_address_*` keys are ignored here on purpose: a function from before
 * migration 20261013160000 still fills them on approval with the company
 * address, and this page must not show that during the deploy window.
 */
import { formatTime, formatWeekdayDate } from '@/features/po/format';
import { fmt, t } from '@/lib/i18n';
import { requestStatusPayloadSchema } from './schemas';

export type RequestStatusData = {
  status: 'pending' | 'approved' | 'denied';
  fullName: string;
  /** Plus-ones as REQUESTED. The headcount asked for is 1 + plusOnes. */
  plusOnes: number;
  /**
   * Plus-ones the venue CONFIRMED for this token's request: approved requests
   * only. Null on an approved page means nothing was confirmed for this caller
   * (a duplicate submission's token, z8uq9m0h2v), so the page must not claim a
   * party size at all. Lower than `plusOnes` = a reduced approval.
   */
  approvedPlusOnes: number | null;
  eventName: string;
  /** "Sun 27 Sept" (Amsterdam). */
  date: string;
  /** "23:00 to 05:00", "From 23:00", or '' when the start is unknown. */
  time: string;
  /** The event's own location, "Paradiso, Weteringschans 6, 1017 SG Amsterdam";
   *  every state. Null when the event has none. Never the company address. */
  location: string | null;
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

/** "Name, address" from the event's own location; null when neither is set. */
export function formatEventLocation(name: string | null | undefined, address: string | null | undefined): string | null {
  const out = [(name ?? '').trim(), (address ?? '').trim()].filter(Boolean).join(', ');
  return out.length > 0 ? out : null;
}

export function toRequestStatusView(data: unknown, now: Date = new Date()): RequestStatusData | null {
  const parsed = requestStatusPayloadSchema.safeParse(data);
  if (!parsed.success) return null;
  const p = parsed.data;

  const approved = p.status === 'approved';
  const plusOnes = p.plus_ones ?? 0;
  // Key ABSENT = a function from before z8uq9m0hw6, which never reduced
  // anything: the whole party was approved. Key present but null = nothing was
  // confirmed for this caller (a mirror token). Never above what was asked.
  let approvedPlusOnes: number | null = null;
  if (approved) {
    if (p.approved_plus_ones === undefined) approvedPlusOnes = plusOnes;
    else if (p.approved_plus_ones !== null) approvedPlusOnes = Math.min(p.approved_plus_ones, plusOnes);
  }
  // Plain text, rendered as a React text node here. Any other consumer (the
  // 86ey6bn05 transactional mail) must HTML-escape it: it is venue-typed text.
  const message = approved ? (p.decision_message ?? '').trim() : '';

  return {
    status: p.status,
    fullName: p.full_name ?? '',
    plusOnes,
    approvedPlusOnes,
    eventName: p.event_name,
    date: formatWeekdayDate(validIso(p.starts_at) ?? now.toISOString()),
    time: formatEventTimes(p.starts_at, p.ends_at),
    location: formatEventLocation(p.location_name, p.location_address),
    message: message.length > 0 ? message : null,
  };
}
