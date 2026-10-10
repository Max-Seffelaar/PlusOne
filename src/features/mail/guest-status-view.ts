// The /s/[token] guest status page's one adapter (Gastcommunicatie F,
// z8uq9m2vpy): get_guest_status jsonb -> the view the page and the .ics route
// render. The RPC is the boundary for what a token holder may see (no guest
// contact data, no note, the spot only while it holds); this adapter
// re-applies the state gate anyway and turns anything that does not parse into
// null, which renders the neutral not-found (the /r/[token] rule).

import { z } from 'zod';
import { formatWeekdayDate } from '@/features/po/format';
import { formatEventTimes } from '@/features/requests/status-view';
import { CONTACT_CHANNELS, type ContactChannel } from '@/features/venues/contact-schema';
import type { CalendarEvent } from './ics';
import { formatPrice, locationLine, peopleLabel } from './templates/guest-mails';
import { guestMailShared } from './templates/guest-copy';
import { fmt } from '@/lib/i18n';

const iso = z.string().refine((v) => !Number.isNaN(new Date(v).getTime()));

const payloadSchema = z.object({
  found: z.literal(true),
  state: z.enum(['on_list', 'checked_in', 'off_list', 'canceled']),
  first_name: z.string().nullable(),
  plus_ones: z.number().int().min(0).nullable(),
  tier_name: z.string().nullable(),
  price_cents: z.number().int().min(0).nullable(),
  event: z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    starts_at: iso,
    ends_at: iso.nullable(),
    location_name: z.string().nullable(),
    location_address: z.string().nullable(),
    house_rules: z.string().nullable(),
    updated_at: iso.nullable(),
  }),
  company: z.object({
    name: z.string(),
    contact_email: z.string().nullable(),
    website: z.string().nullable(),
    channels: z.record(z.unknown()).nullable(),
  }),
});

export type GuestStatusState = 'on_list' | 'checked_in' | 'off_list' | 'canceled';

export interface GuestStatusView {
  state: GuestStatusState;
  firstName: string | null;
  eventName: string;
  date: string;
  time: string;
  location: string | null;
  /** "Guest · You +1 (2 people)": only while the spot holds. */
  spotLine: string | null;
  priceLine: string | null;
  houseRules: string | null;
  company: string;
  contactEmail: string | null;
  website: string | null;
  channels: Array<{ key: ContactChannel; value: string }>;
  calendar: CalendarEvent;
}

export function toGuestStatusView(raw: unknown): GuestStatusView | null {
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  const d = parsed.data;
  const holds = d.state === 'on_list' || d.state === 'checked_in';
  const plusOnes = d.plus_ones ?? 0;

  let spotLine: string | null = null;
  let priceLine: string | null = null;
  if (holds && d.tier_name) {
    const form = plusOnes <= 0 ? 'none' : plusOnes === 1 ? 'one' : 'many';
    spotLine = fmt(guestMailShared.tierLine[form], { tier_name: d.tier_name, n: plusOnes, total: plusOnes + 1 });
    if (d.price_cents !== null && d.price_cents > 0) {
      priceLine = fmt(plusOnes > 0 ? guestMailShared.pricePerPerson : guestMailShared.priceSingle, {
        tier_price: formatPrice(d.price_cents),
      });
    }
  }

  const channels: GuestStatusView['channels'] = [];
  const raw_channels = d.company.channels ?? {};
  for (const key of CONTACT_CHANNELS) {
    const value = raw_channels[key];
    if (typeof value === 'string' && value.trim() !== '' && value.length <= 100) channels.push({ key, value: value.trim() });
  }

  const location = locationLine(d.event.location_name, d.event.location_address);
  return {
    state: d.state,
    firstName: d.first_name,
    eventName: d.event.name,
    date: formatWeekdayDate(d.event.starts_at),
    time: formatEventTimes(d.event.starts_at, d.event.ends_at),
    location,
    spotLine,
    priceLine,
    houseRules: holds ? d.event.house_rules : null,
    company: d.company.name,
    contactEmail: d.company.contact_email,
    website: d.company.website && /^https?:\/\//i.test(d.company.website) ? d.company.website : null,
    channels,
    calendar: {
      id: d.event.id,
      name: d.event.name,
      startsAt: d.event.starts_at,
      endsAt: d.event.ends_at,
      location,
      updatedAt: d.event.updated_at,
    },
  };
}

/** "1 person" / "n people", re-exported for the page's own count line. */
export { peopleLabel };
