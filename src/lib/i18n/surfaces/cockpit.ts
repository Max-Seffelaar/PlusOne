/**
 * Event-day cockpit copy (S13 desktop live command screen).
 *
 * Dial = near-zero wink at the door, light confidence elsewhere on the screen.
 * Sentence case, numerals for numbers, no em-dash habit, glossary terms verbatim
 * (Guest, +N, Check-in, Door, Tier, Quota, Request, On the way, Inside, people).
 *
 * Composed into the central dictionary (`../en.ts`) — read as `t.cockpit.<key>`,
 * fill {placeholders} with `fmt`.
 */
import { shared } from './shared';

export const cockpit = {
  // ── Entry gate (EventDayCockpitGate) ─────────────────────────────────────
  pickEventTitle: 'Pick the event',
  pickEventSub: 'Which live event do you want to run?',
  noLiveEventTitle: 'No live or upcoming event',
  noLiveEventSub:
    'Once an event goes live (or the doors open) the cockpit shows up here with live check-in.',

  // ── Page header ──────────────────────────────────────────────────────────
  pageTitle: 'Event day',
  pageSub: '{name} · live at the door',
  pageSubUpcoming: '{name} · doors not open yet',
  switchEvent: 'Switch event',

  // ── LIVE strip ───────────────────────────────────────────────────────────
  liveBadge: 'LIVE AT THE DOOR',
  upcomingBadge: 'UPCOMING',
  doorTime: 'doors {time}',
  lockTitleManage: 'Lock or unlock the list',
  lockTitleNoRights: 'Admin or organizer only',
  listLocked: 'List locked',
  listOpen: 'List open',
  turnoutNow: 'Turnout',
  // tail after a separately-styled "inside" count span: "<X> / {total} people · {pct}%"
  turnoutTail: '{total} people · {pct}%',
  lockedHint: 'List locked. No new guests, but check-in at the door still works.',
  openHint: 'List open. Guests can still be added or changed.',

  // ── KPI tiles ────────────────────────────────────────────────────────────
  tileInside: 'Inside',
  tileInsideSub: 'of {total} people',
  tileOnTheWay: 'On the way',
  tileOnTheWaySub: 'still to check',
  tilePresence: 'Turnout',
  tilePresenceSub: 'right now',
  tilePeak: 'Peak arrivals',
  tilePeakSub: '{n} in 15 min',
  tilePeakNone: 'no peak yet',

  // ── Cockpit list ─────────────────────────────────────────────────────────
  searchCheckIn: 'Quick check-in. Type a name and press Enter…',
  searchPlaceholder: 'Search a guest…',
  clearAria: 'Clear',
  // Shared with door.ts (t.door.filter*) — one source of truth.
  filterAll: shared.checkinFilters.all,
  filterOnTheWay: shared.checkinFilters.onTheWay,
  filterInside: shared.checkinFilters.inside,
  filterRefused: shared.checkinFilters.refused,
  allTiers: 'All tiers',
  colGuest: 'Guest',
  colTier: 'Tier',
  colStatus: 'Status',
  colInOut: 'In / out',
  emptyNoGuests: 'No guests on the list yet.',
  emptyNoFilter: 'No guests for this filter.',
  addedBy: 'Added by {name}',
  rowInside: 'Inside',
  rowInsidePartial: 'Inside · {arrived}/{total}',
  rowInsideBy: 'by {name}',
  rowOnTheWay: 'On the way',
  feedShown: '{n} guests shown · check-ins show up here live',

  // ── Approvals panel ──────────────────────────────────────────────────────
  approvalsTitle: 'Waiting for approval',
  approvalsSub: 'Team quota · landing page requests',
  approvalsEmpty: 'All handled. No open requests.',
  approvalsQuotaLabel: 'Quota · team',
  approvalsLandingLabel: 'Landing page',
  quotaPlus: 'quota +{n}',
  requestFallback: 'request',
  phoneLast4: 'phone ••{last4}',
  approveTitle: 'Approve',
  approveQuotaTitle: 'Grant',
  approveNoTier: 'Create a tier first',
  denyTitle: 'Deny',

  // ── Present per tier ─────────────────────────────────────────────────────
  perTierTitle: 'Present per tier',
  perTierSub: "Inside vs. requested · people incl. +1's",
  perTierEmpty: 'No guests on the list yet.',

  // ── Arrivals per 15 min (KwartierCard) ───────────────────────────────────
  arrivalsTitle: 'Arrivals by 15 min',
  arrivalsSub: 'Check-ins at the door',
  arrivalsNow: 'now {time}',
  arrivalsEmpty: 'No arrivals yet tonight.',

  // ── Live clock ───────────────────────────────────────────────────────────
  localTime: 'local time',

  // ── Quantified check-in/out modal ────────────────────────────────────────
  modalHowManyIn: 'How many are coming in now?',
  // {inside} of {total} inside · {n} still on the way
  modalTopupHeading: '{inside} of {total} inside · {n} still on the way',
  modalCheckoutHeading: '{inside} {unit} inside',
  stepInside: 'inside',
  stepMore: 'more',
  stepCheckOut: 'check out',
  // You're checking in {v} of {total} people.
  modalCheckinLine: "You're checking in {v} of {total} {unit}.",
  modalTopupLine: '{after} of {total} inside after this.',
  // You're checking out {v} of {inside} people · {after} stay inside.
  modalCheckoutLine: "You're checking out {v} of {inside} {unit}{tail}.",
  modalCheckoutLineTail: ' · {after} stay inside',
  modalConfirmCheckin: 'Check in',
  modalConfirmTopup: 'Check in {n} more',
  modalConfirmCheckout: 'Check out',
  modalMinusAria: 'Fewer',
  modalPlusAria: 'More',
  modalCancel: 'Cancel',

  // shared units
  personSingular: 'person',
  personPlural: 'people',

  // ── Button / control titles ──────────────────────────────────────────────
  checkInTitle: 'Check in',
  checkOutTitle: 'Check out / not inside',
  checkOutDisabledTitle: 'Check-out is off for this event',
  refuseRowTitle: 'Refuse this guest',
  undoRowTitle: 'Undo the refusal',

  // ── Refused row (Refused segment) ─────────────────────────────────────────
  rowRefused: 'Refused',

  // ── Tasks card (right column) ─────────────────────────────────────────────
  tasksCardEmpty: 'No tasks for this event.',

  // ── Toasts (notify) ──────────────────────────────────────────────────────
  // {name} +{n} checked in · {inside} inside   (the +{n} part is built inline)
  toastCheckedIn: '{name}{plus} checked in · {inside} inside',
  toastFullyInside: '{name} is already fully inside',
  toastTopup: '{name} updated · now {inside} inside',
  toastCheckedOut: '{name} checked out',
  toastPartialCheckout: '{name} · {leaving} checked out, {remaining} stay inside',
  toastRefused: '{name} refused',
  toastUndoRefusal: '{name} back on the list',

  // ── Live feed (pushFeed) ─────────────────────────────────────────────────
  feedApproved: '{name}{plus} approved',
  feedDeclined: '{name} declined',
  feedQuotaGranted: '{who} got +{n} quota',
  feedQuotaDenied: "Quota request from {who} declined",
  feedRefused: '{name} refused',
  feedUndoRefusal: '{name} back on the list',
  // reason stored on a cockpit deny (server-side, English)
  denyReason: 'Declined from cockpit',
} as const;
