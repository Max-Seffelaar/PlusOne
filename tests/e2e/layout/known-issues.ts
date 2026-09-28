/**
 * Layout bugs the suite found on main that are too big to fix inside QA-1
 * (more than one screen, or more than CSS). Each entry turns exactly ONE check
 * on ONE screen × project into `test.fixme` with its reason, so the rest of
 * that screen stays guarded. Listed in the QA-1 PR body under "Found, not
 * fixed" for routing.
 *
 * Rules: never add an entry to make a green screen greener, never widen one to
 * a whole screen, and delete the entry in the PR that fixes the bug (the test
 * then runs again and proves the fix).
 */
export type LayoutCheck = 'overflow' | 'tap-targets' | 'field-targets' | 'chrome' | 'console-network';

export interface KnownIssue {
  screen: string;
  check: LayoutCheck;
  /** Project names this applies to; omitted = every project the check runs in. */
  projects?: readonly string[];
  reason: string;
}

const TOUCH_WIDE = ['ipadpro-1024-touch', 'ipad-1366-touch'] as const;

// ── Form fields: one root cause, many screens ────────────────────────────────
// The visible field is a 50px padded <div>; the <input>/<select> inside it is
// 21–26px tall and the wrapper is not a <label>, so a tap on the padding does
// nothing (kit `Field`/`SelectField` plus hand-rolled search boxes). Fix once
// in the kit (label wrapper or full-height input), then delete these.
const FIELD =
  'kit Field/Select + inline search boxes: the input is 21–26px inside a padded div that is not a <label> — a tap on the padding does not focus (kit-wide fix)';
const FIELD_SCREENS = [
  'aanvragen', 'aanvragen.quota', 'checkin.door', 'contacten', 'eventedit', 'eventedit.new',
  'guests.admin', 'guests.door', 'home.admin', 'home.door', 'lijst', 'platform', 'platformaudit',
  'platformvenues', 'profile', 'quickadd', 'templateedit.new', 'venuecreate', 'venuesettings',
] as const;

export const KNOWN_ISSUES: readonly KnownIssue[] = [
  ...FIELD_SCREENS.map((screen) => ({ screen, check: 'field-targets' as const, reason: FIELD })),
  { screen: 'tasks.door', check: 'field-targets', projects: TOUCH_WIDE, reason: `cockpit quick check-in: ${FIELD}` },

  // ── Controls: per screen, each a design call (chips/segments/steppers) ──
  { screen: 'aanvragen', check: 'tap-targets', reason: '"Declined · N" section toggle is 30px tall (approvals.tsx)' },
  { screen: 'checkin.door', check: 'tap-targets', reason: 'door segment pills 39.5px, tier filter chips 34–35px, cockpit status tabs 36px' },
  { screen: 'tasks.door', check: 'tap-targets', reason: 'door segment pills 39.5px, tier filter chips 34–35px, cockpit status tabs 36px' },
  { screen: 'crew', check: 'tap-targets', reason: 'crew quota stepper is 32×32 and "Remove" is 26px tall' },
  { screen: 'eventedit', check: 'tap-targets', reason: '"Copy sign-up link" chip is 35px tall' },
  { screen: 'events.admin', check: 'tap-targets', reason: 'Upcoming/Past segment is 38px tall' },
  { screen: 'events.door', check: 'tap-targets', reason: 'Upcoming/Past segment is 38px tall' },
  { screen: 'gebruikers', check: 'tap-targets', reason: 'pending-invite "Resend" action is 26px tall' },
  { screen: 'guests.admin', check: 'tap-targets', reason: 'event filter chips are 35px tall' },
  { screen: 'guests.door', check: 'tap-targets', reason: 'event filter chips are 35px tall' },
  { screen: 'home.admin', check: 'tap-targets', reason: 'Home segment and requests/quota counter tiles are 40px tall' },
  { screen: 'home.door', check: 'tap-targets', reason: 'Home segment and requests/quota counter tiles are 40px tall' },
  { screen: 'import', check: 'tap-targets', reason: 'import-source chips are 39.5px tall' },
  { screen: 'links', check: 'tap-targets', reason: '"Copy link URL" chip is 39px tall' },
  { screen: 'profile', check: 'tap-targets', reason: 'MFA "Turn off" is a 19px text button; session "Log out" is 26px' },
  { screen: 'promotion', check: 'tap-targets', reason: 'hub tab pills 39.5px, range pills 35.5px, inline "N links" text button 19px' },
  { screen: 'promotion.event', check: 'tap-targets', reason: 'hub tab pills 39.5px; "Copy link URL" chip 39px' },
  { screen: 'promotion.events', check: 'tap-targets', reason: 'hub tab pills 39.5px; "Copy link URL" chip 39px' },
  { screen: 'promotion.roster', check: 'tap-targets', reason: 'hub tab pills are 39.5px tall' },
  { screen: 'rollen', check: 'tap-targets', reason: 'role quota stepper is 42×42 with no hit ring' },
  {
    screen: 'venuecreate',
    check: 'tap-targets',
    reason: 'inline Terms/Privacy links are 17px tall — design-system.md documents no inline-link exemption; needs a decision',
  },
];

export function knownIssue(screen: string, check: LayoutCheck, project: string): string | null {
  const hit = KNOWN_ISSUES.find(
    (k) => k.screen === screen && k.check === check && (!k.projects || k.projects.includes(project)),
  );
  return hit ? hit.reason : null;
}
