import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHROME_BREAKPOINT, deviceFor } from './matrix';
import { SCREENSHOT_DIR, SNAPSHOT_DIR, type LayoutSnapshot } from './probe';

/**
 * Fold every screen × project snapshot into ONE findings digest, grouped by
 * finding rather than by test, so a shared component shows up as a single line
 * ("sidebar nav row 219×43.8 — 46 screens × 3 devices") instead of hundreds of
 * test failures. Written next to the screenshots (`findings.md`, part of the
 * artifact), appended to the CI job summary, and printed to the log.
 */
export default async function globalTeardown(): Promise<void> {
  if (!existsSync(SNAPSHOT_DIR)) return;
  const snaps: LayoutSnapshot[] = [];
  for (const project of readdirSync(SNAPSHOT_DIR)) {
    for (const f of readdirSync(join(SNAPSHOT_DIR, project))) {
      if (f.endsWith('.json')) snaps.push(JSON.parse(readFileSync(join(SNAPSHOT_DIR, project, f), 'utf8')));
    }
  }
  if (!snaps.length) return;

  const groups = new Map<string, Map<string, { screens: Set<string>; projects: Set<string> }>>();
  const add = (check: string, finding: string, s: LayoutSnapshot): void => {
    const byFinding = groups.get(check) ?? new Map();
    groups.set(check, byFinding);
    const g = byFinding.get(finding) ?? { screens: new Set<string>(), projects: new Set<string>() };
    byFinding.set(finding, g);
    g.screens.add(s.screenId);
    g.projects.add(s.project);
  };

  for (const s of snaps) {
    const device = deviceFor(s.project);
    for (const o of s.overflow) add('overflow', `${o.what} → right edge ${o.right}px (viewport ${s.innerWidth})`, s);
    if (s.docScrollWidth > s.innerWidth) add('overflow', `document scrollWidth ${s.docScrollWidth} > ${s.innerWidth}`, s);
    if (device.touch) {
      for (const t of s.smallTargets) add('tap-targets', `${t.what} ${t.w}×${t.h}`, s);
      for (const t of s.smallFields) add('field-targets', `${t.what} ${t.w}×${t.h}`, s);
    }
    const wide = device.width >= CHROME_BREAKPOINT;
    if (wide && (!s.sidebar.present || s.tabBar.present)) add('chrome', `expected sidebar only (sidebar=${s.sidebar.present}, tabbar=${s.tabBar.present})`, s);
    if (!wide && (s.sidebar.present || !s.tabBar.present)) add('chrome', `expected tab bar only (sidebar=${s.sidebar.present}, tabbar=${s.tabBar.present})`, s);
    for (const e of s.evCardIssues ?? []) add('event-card', e.replace(/"[^"]*"/, '"…"'), s);
    for (const e of s.consoleErrors) add('console', e.slice(0, 240), s);
    for (const r of s.failedRequests) add('network', r, s);
    if (s.finalPath && !s.screenshot) add('load', `no screenshot for ${s.finalPath}`, s);
  }

  const lines: string[] = ['## QA-1 layout findings', '', `${snaps.length} screen × device snapshots.`, ''];
  if (!groups.size) lines.push('No findings.');
  for (const [check, byFinding] of groups) {
    lines.push(`### ${check} (${byFinding.size} distinct)`, '');
    const sorted = [...byFinding].sort((a, b) => b[1].screens.size - a[1].screens.size);
    for (const [finding, g] of sorted) {
      lines.push(
        `- ${finding.replace(/\|/g, '/')}  \n  ${g.screens.size} screens: ${[...g.screens].sort().join(', ')} · devices: ${[...g.projects].sort().join(', ')}`,
      );
    }
    lines.push('');
  }
  // Exact screen × check → devices, the shape `known-issues.ts` is keyed by.
  const perScreen = new Map<string, Set<string>>();
  for (const s of snaps) {
    const device = deviceFor(s.project);
    const failing: string[] = [];
    if (s.overflow.length || s.docScrollWidth > s.innerWidth) failing.push('overflow');
    if (device.touch && s.smallTargets.length) failing.push('tap-targets');
    if (device.touch && s.smallFields.length) failing.push('field-targets');
    if (s.evCardIssues?.length) failing.push('event-card');
    for (const check of failing) {
      const key = `${s.screenId} · ${check}`;
      perScreen.set(key, (perScreen.get(key) ?? new Set()).add(s.project));
    }
  }
  if (perScreen.size) {
    lines.push('### failing checks per screen', '');
    for (const [key, projects] of [...perScreen].sort()) lines.push(`- ${key}: ${[...projects].sort().join(', ')}`);
    lines.push('');
  }
  const md = lines.join('\n');
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  writeFileSync(join(SCREENSHOT_DIR, 'findings.md'), md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  console.log(`\n${md}\n`);
}
