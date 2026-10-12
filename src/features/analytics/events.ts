/**
 * Product-analytics event catalog (PostHog, docs/posthog-implementation-plan.md
 * "Event taxonomy v1"). The ONE list of what PlusOne may send: `analytics.capture`
 * only accepts a member of `AnalyticsEvent`, so an unknown event or an extra
 * property is a type error, not a silent leak.
 *
 * Hard rule (CLAUDE.md security checklist, plan decision 4): properties are UUIDs,
 * enums, booleans and counts. Never a guest or user name, e-mail, phone number,
 * note or any free text (the refusal reason, a guest-list note). Guests are never
 * tracked: there is no guest-facing event and there never is one in this file.
 * `events.pii.test.ts` walks `EVENT_PROPERTY_KEYS` below and fails on any key
 * that looks like personal data.
 *
 * Adding an event = a member here + its keys in `EVENT_PROPERTY_KEYS` (the
 * `satisfies` check makes forgetting that a type error) + docs/analytics.md.
 */

/** Which authenticated surface the event came from (super property). */
export type AppSurface = 'po' | 'door';

export type AnalyticsEvent =
  | { event: 'user_signed_up'; via: 'invite' | 'onboarding' }
  | { event: 'app_opened'; surface: AppSurface }
  | { event: 'onboarding_step_completed'; step: 'welcome' | 'company' | 'team' }
  | { event: 'onboarding_completed' }
  | { event: 'venue_created'; venue_id: string }
  | { event: 'event_created'; event_id: string; from_template: boolean }
  | { event: 'guest_added'; event_id: string; method: 'quick_add' | 'contact' | 'door'; plus_ones: number }
  | { event: 'guests_added_bulk'; event_id: string; count: number }
  | { event: 'guest_removed'; event_id: string }
  | { event: 'list_lock_toggled'; event_id: string; locked: boolean }
  | { event: 'extra_slots_requested'; event_id: string; amount: number }
  | { event: 'request_approved'; event_id: string }
  | { event: 'request_denied'; event_id: string }
  | { event: 'door_checkin'; event_id: string; total_people: number; captured_offline: boolean }
  | { event: 'door_checkin_voided'; event_id: string; captured_offline: boolean }
  | { event: 'door_refusal'; event_id: string; captured_offline: boolean }
  | { event: 'door_guest_added'; event_id: string; plus_ones: number; captured_offline: boolean }
  /** `screen` is an internal screen/tab id (`events`, `eventDetail`, `deur`, …),
   *  never a path: a path can carry entity ids and query strings. */
  | { event: 'screen_viewed'; screen: string }
  | { event: 'member_invited'; roles_granted: string[]; event_count: number }
  | { event: 'landing_viewed' };

export type AnalyticsEventName = AnalyticsEvent['event'];

type PropsOf<E extends AnalyticsEventName> = Exclude<keyof Extract<AnalyticsEvent, { event: E }>, 'event'>;

/**
 * Every event's property keys, spelled out so a test can walk them at runtime
 * (types are gone by then). `satisfies` ties it to the union both ways: a missing
 * event, a missing key or a stray key fails `pnpm type-check`.
 */
export const EVENT_PROPERTY_KEYS = {
  user_signed_up: ['via'],
  app_opened: ['surface'],
  onboarding_step_completed: ['step'],
  onboarding_completed: [],
  venue_created: ['venue_id'],
  event_created: ['event_id', 'from_template'],
  guest_added: ['event_id', 'method', 'plus_ones'],
  guests_added_bulk: ['event_id', 'count'],
  guest_removed: ['event_id'],
  list_lock_toggled: ['event_id', 'locked'],
  extra_slots_requested: ['event_id', 'amount'],
  request_approved: ['event_id'],
  request_denied: ['event_id'],
  door_checkin: ['event_id', 'total_people', 'captured_offline'],
  door_checkin_voided: ['event_id', 'captured_offline'],
  door_refusal: ['event_id', 'captured_offline'],
  door_guest_added: ['event_id', 'plus_ones', 'captured_offline'],
  screen_viewed: ['screen'],
  member_invited: ['roles_granted', 'event_count'],
  landing_viewed: [],
} as const satisfies { [E in AnalyticsEventName]: readonly PropsOf<E>[] };

// Reverse direction: every key of every member is listed above.
type Listed<E extends AnalyticsEventName> = (typeof EVENT_PROPERTY_KEYS)[E][number];
type Unlisted = { [E in AnalyticsEventName]: Exclude<PropsOf<E>, Listed<E>> }[AnalyticsEventName];
export const _everyKeyListed: [Unlisted] extends [never] ? true : Unlisted = true;

/** Super properties registered on identify (plan "Super properties"). */
export interface AnalyticsSuperProps {
  venue_id: string | null;
  roles: string[];
  app_surface: AppSurface;
}

/** Person properties (`$set`): deliberately no name or e-mail. The PostHog person
 *  id IS the Supabase user UUID; look a person up in Supabase when needed. */
export interface AnalyticsPersonProps {
  venue_id: string | null;
  roles: string[];
}

/** Split an event into PostHog's (name, properties). */
export function toCapture(e: AnalyticsEvent): { name: AnalyticsEventName; props: Record<string, unknown> } {
  const { event, ...props } = e;
  return { name: event, props };
}
