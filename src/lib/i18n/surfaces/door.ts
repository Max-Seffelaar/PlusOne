/**
 * Door surface copy (the check-in PWA: §2 of copy-deck.md).
 *
 * Dial = near-zero wink (speed + scannability win at the door). Sentence case,
 * numerals for numbers, no em-dash habit, glossary terms verbatim (Guest, +N,
 * Check-in, Door, Tier, Quota, Refuse, On the way, Inside, people).
 *
 * Composed into the central dictionary (`../en.ts`) — components read these as
 * `t.door.<key>` and fill {placeholders} with `fmt`.
 */
import { shared } from './shared';

export const door = {
  // ── Check-in list (CheckInList) ──────────────────────────────────────────
  checkinTitle: 'Check-in',
  loadingSub: 'Loading…',
  statOnTheWay: 'on the way',
  statInside: 'inside',
  headcountSub: 'people',
  searchPlaceholder: 'Search a name…',
  addOnSpotAria: 'Add on the spot',
  // Shared with cockpit.ts (t.cockpit.filter*) — one source of truth.
  filterAll: shared.checkinFilters.all,
  filterOnTheWay: shared.checkinFilters.onTheWay,
  filterInside: shared.checkinFilters.inside,
  resultFound: '{n} found',
  countCheckedIn: '{n} checked in',
  countStillAtDoor: '{n} still at the door',
  nextAtDoor: 'Next at the door',
  // Section dividers are built in ./checkin-items.ts (out of this component's
  // scope); these are the wired-up values for that follow-up pass.
  dividerInside: 'INSIDE · {n}',
  dividerPartlyInside: 'PARTLY INSIDE · {n}',
  dividerRefused: 'REFUSED · {n}',
  emptySearch: 'No match. Check the spelling, or add them on the spot.',
  emptyNoneInside: 'No one inside yet.',
  emptyEveryoneIn: "Everyone's in.",
  duplicate: 'DUPLICATE',
  // {x}/{y} inside · {n} still on the way (partial party, in the row)
  partlyInside: '{arrived}/{total} inside · {n} still on the way',
  partlyBadge: '{n} more',
  logBy: 'by',
  // Refused row
  refused: 'Refused',
  refusedWithReason: 'Refused · {reason}',
  undo: 'Undo',

  // ── Tasks (Taken) ────────────────────────────────────────────────────────
  tasksTitle: 'Tasks',
  tasksSub: 'open jobs at the door',
  tasksStatOpen: 'open',
  tasksStatPriority: 'priority',
  tasksStatDone: 'done',
  tasksFilterOpen: 'Open',
  tasksFilterDone: 'Done',
  tasksFilterAll: 'All',
  taskReopen: 'Reopen',
  taskMarkDone: 'Mark as done',
  taskPriorityBadge: 'PRIORITY',
  taskInside: 'inside',
  taskOnTheWay: 'on the way',
  tasksEmptyOpen: "All done.",
  tasksEmptyOther: 'Nothing here.',
  tasksEmptyEvent: 'No jobs for this event.',

  // ── Guest detail (GuestDetail) ───────────────────────────────────────────
  guestTitle: 'Guest',
  taskPriorityHigh: 'Priority task',
  taskPriorityNormal: 'Task',
  taskStatusDone: 'Done',
  taskDoneBy: 'Done · {name}',
  taskStatusOpen: 'OPEN',
  payBanner: 'Paid guest list. Collect payment at the door.',
  logTitle: 'Log',
  logAdded: 'Added',
  logPlusOnes: 'Plus-ones',
  logPlusOnesTickets: '+{n} tickets',
  logCheckedInPlus: 'Checked in · +{n}',
  logCheckedIn: 'Checked in',
  logActorFallback: 'Door',
  logReversed: 'Check-in reversed',
  statusOnTheWay: 'on the way',
  logNotCheckedIn: 'Not checked in yet',
  partyNotAllInTitle: "Not everyone's in yet",
  // tail after a separately-styled count span: "<X> of {total} inside · {n} still on the way"
  partyOfInsideTail: 'of {total} inside · {n} still on the way',
  refuseBtn: 'Refuse',
  inside: 'Inside',
  inAt: 'Inside at {time}',
  inBy: 'by {name}',
  checkInMoreBtn: 'Check in {n} more',
  uncheckBtn: 'Reverse check-in',
  uncheckDisabled: "Check-out is off for this event. Ask an admin.",
  reCheckInTitle: 'Check in again?',
  howManyComingIn: 'How many are coming in?',
  reCheckIn: 'Check in again',
  checkIn: 'Check in',
  // Check in · {n} people  /  Check in again · {n} people
  checkInStepper: '{label} · {n} {unit}',
  personSingular: 'person',
  personPlural: 'people',

  // Refuse sheet
  refuseTitle: 'Refuse guest',
  refuseSub: 'A reason is required. It goes in the log.',
  refusePlaceholder: 'e.g. not on the list, aggressive behavior…',
  refuseConfirm: 'Refuse {name}',
  cancel: 'Cancel',

  // "Let op!" high-priority note sheet
  alertTitle: 'Heads up!',
  alertSub: 'Task for {name}',
  alertConfirm: 'Seen & handled',
  alertLater: 'Later',

  // ── Add on the spot (AddOnSpot) ──────────────────────────────────────────
  addTitle: 'Add guest',
  addSubNoQuota: 'no limit for your role',
  addSubQuotaLeft: 'your quota · {n} of {m} left',
  addSubFallback: 'at the door',
  addInputLabel: 'Type freely: name, +guests, tier',
  addInputPlaceholder: 'e.g. "Juri Braakman +2 vip"',
  tierRegular: 'Regular',
  tierFallback: 'Guest',
  // Not sure what you mean by "{x}". Pick one:
  ambiguity: 'Not sure what you mean by "{x}". Pick one:',
  ambiguityBelongsToName: 'Belongs to the name',
  // Costs {cost} slot(s) · {left} left after adding
  quotaCost: 'Costs {cost} {unit} · {left} left after adding',
  slotSingular: 'slot',
  slotPlural: 'slots',
  quotaFull: 'Quota full',
  justAdded: 'Just added · {n}',
  onList: 'on list',
  addCommit: 'Add · {name}',
  addTypeName: 'Type a name',

  // ── Sync bar (SyncBar) ───────────────────────────────────────────────────
  syncLive: 'Live · realtime',
  syncWarn: 'No sync for over 10 min. Check your connection.',
  syncOffline: 'Offline · {age}',
  syncQueued: '{n} queued',
  syncNowAria: 'Sync now',
} as const;
