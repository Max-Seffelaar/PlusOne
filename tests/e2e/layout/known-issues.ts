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
export type LayoutCheck = 'overflow' | 'tap-targets' | 'field-targets' | 'chrome' | 'console-network' | 'event-card';

export interface KnownIssue {
  screen: string;
  check: LayoutCheck;
  /** Project names this applies to; omitted = every project the check runs in. */
  projects?: readonly string[];
  reason: string;
}

// ── Form fields: one root cause, many screens ────────────────────────────────
// The visible field is a 50px padded <div>; the <input>/<select> inside it is
// 21–26px tall and the wrapper is not a <label>, so a tap on the padding does
// nothing (kit `Field`/`SelectField` plus hand-rolled search boxes). Fix once
// in the kit (label wrapper or full-height input), then delete these.
const FIELD =
  'kit Field/Select + inline search boxes: the input is 21–26px inside a padded div that is not a <label> — a tap on the padding does not focus (kit-wide fix)';
const FIELD_SCREENS = [
  // tasks.door: since the Tasks tab is gone (z8uq9m2vg7) an old ?seg=taken link
  // renders the check-in list, i.e. checkin.door's search field — same bug.
  'aanvragen', 'aanvragen.quota', 'checkin.door', 'tasks.door', 'contacten', 'eventedit', 'eventedit.new',
  'guests.admin', 'guests.door', 'home.admin', 'home.door', 'lijst', 'platform', 'platformaudit',
  'platformaccess', 'platformvenues', 'profile', 'quickadd', 'templateedit', 'templateedit.new', 'venuecreate', 'venuesettings',
] as const;

export const KNOWN_ISSUES: readonly KnownIssue[] = [
  ...FIELD_SCREENS.map((screen) => ({ screen, check: 'field-targets' as const, reason: FIELD })),
];

export function knownIssue(screen: string, check: LayoutCheck, project: string): string | null {
  const hit = KNOWN_ISSUES.find(
    (k) => k.screen === screen && k.check === check && (!k.projects || k.projects.includes(project)),
  );
  return hit ? hit.reason : null;
}
