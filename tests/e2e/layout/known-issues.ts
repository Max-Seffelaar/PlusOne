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
export type LayoutCheck = 'overflow' | 'tap-targets' | 'chrome' | 'console-network';

export interface KnownIssue {
  screen: string;
  check: LayoutCheck;
  /** Project names this applies to; omitted = every project the check runs in. */
  projects?: readonly string[];
  reason: string;
}

export const KNOWN_ISSUES: readonly KnownIssue[] = [];

export function knownIssue(screen: string, check: LayoutCheck, project: string): string | null {
  const hit = KNOWN_ISSUES.find(
    (k) => k.screen === screen && k.check === check && (!k.projects || k.projects.includes(project)),
  );
  return hit ? hit.reason : null;
}
