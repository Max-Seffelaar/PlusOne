import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SEED, USERS, type LayoutScreen, type LayoutUser } from './screens';
import { shellMounted } from './shell-ready';

/**
 * Load-once-measure-once plumbing for the layout suite: one browser context per
 * screen × project, one dev-login navigation straight onto the screen, one
 * settle, one in-page measurement pass, one screenshot. The individual checks
 * are separate tests over that ONE snapshot, so each can be `fixme`'d on its
 * own without hiding the others.
 */

/** Where the full-page screenshots land (uploaded as a CI artifact). */
export const SCREENSHOT_DIR = join(process.cwd(), 'layout-screenshots');

/**
 * One JSON snapshot per screen × project. Two jobs: (1) when a check fails,
 * Playwright restarts the worker and re-runs `beforeAll`; reading the snapshot
 * back instead of reloading the screen keeps the run's cost at ONE load per
 * screen × project; (2) `global-teardown.ts` folds them into the findings
 * digest. Lives under Playwright's outputDir, which is wiped at the start of
 * every run, so a snapshot never outlives its run.
 */
export const SNAPSHOT_DIR = join(process.cwd(), 'test-results', 'layout-snapshots');

/** Minimum pointer hit box, CLAUDE.md "Tablet (T1)" + design-system.md density axis. */
export const MIN_HIT = 44;

// ── allowlists ───────────────────────────────────────────────────────────────

/**
 * Console errors that are NOT app defects. Each entry says why; keep it short.
 * Empty on purpose until one is proven to be environment noise.
 */
export const CONSOLE_ALLOWLIST: readonly { pattern: RegExp; why: string }[] = [];

/**
 * Failed network requests that are NOT app defects.
 *   - net::ERR_ABORTED: the browser cancelled a request the page no longer
 *     wanted — Next aborting an RSC prefetch/navigation fetch it superseded,
 *     React Query cancelling a query whose observer unmounted, or the
 *     dev-login redirect chain itself. Nothing failed server-side.
 */
export const REQUEST_FAILURE_ALLOWLIST: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /net::ERR_ABORTED/, why: 'cancelled by the page (superseded fetch), not a failure' },
];

// ── snapshot ─────────────────────────────────────────────────────────────────

export interface OverflowOffender {
  what: string;
  right: number;
}

export interface SmallTarget {
  what: string;
  w: number;
  h: number;
}

export interface LayoutSnapshot {
  screenId: string;
  project: string;
  finalPath: string;
  innerWidth: number;
  docScrollWidth: number;
  overflow: OverflowOffender[];
  /** Buttons, links, [role=button], [role=tab]. */
  smallTargets: SmallTarget[];
  measuredTargets: number;
  /** Form fields (input, select): split out so a kit-wide field issue can be
   *  tracked on its own without hiding a control regression on that screen. */
  smallFields: SmallTarget[];
  measuredFields: number;
  sidebar: { present: boolean; width: number; left: number };
  tabBar: { present: boolean; bottomGap: number };
  pointerCoarse: boolean;
  consoleErrors: string[];
  failedRequests: string[];
  screenshot: string | null;
}

/** New context with the running project's device options + the active venue
 *  pinned to Club Vesper (admin@ is a member of two venues). */
export async function newProjectContext(browser: Browser, testInfo: TestInfo): Promise<BrowserContext> {
  const use = testInfo.project.use;
  const baseURL = use.baseURL ?? testInfo.config.projects[0]?.use.baseURL;
  const context = await browser.newContext({
    baseURL,
    viewport: use.viewport,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    deviceScaleFactor: use.deviceScaleFactor,
    reducedMotion: 'reduce',
  });
  const { hostname } = new URL(baseURL ?? 'http://localhost:3000');
  await context.addCookies([{ name: 'po_active_venue', value: SEED.venueId, domain: hostname, path: '/' }]);
  return context;
}

/** Record console errors, uncaught page errors, failed and ≥400 requests. */
export function recordFailures(page: Page): { consoleErrors: string[]; failedRequests: string[] } {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (CONSOLE_ALLOWLIST.some((a) => a.pattern.test(text))) return;
    const loc = msg.location();
    consoleErrors.push(loc.url ? `${text} (${loc.url}:${loc.lineNumber})` : text);
  });
  page.on('pageerror', (err) => consoleErrors.push(`uncaught: ${err.message}`));
  page.on('requestfailed', (req) => {
    const failure = req.failure()?.errorText ?? 'unknown';
    if (REQUEST_FAILURE_ALLOWLIST.some((a) => a.pattern.test(failure))) return;
    failedRequests.push(`${req.method()} ${stripQuery(req.url())} — ${failure}`);
  });
  page.on('response', (res) => {
    if (res.status() < 400) return;
    const line = `${res.request().method()} ${stripQuery(res.url())} — HTTP ${res.status()}`;
    if (REQUEST_FAILURE_ALLOWLIST.some((a) => a.pattern.test(line))) return;
    failedRequests.push(line);
  });
  return { consoleErrors, failedRequests };
}

/** Query strings can carry tokens (dev-login hashes, PostgREST filters with ids);
 *  keep reports to origin + path. */
function stripQuery(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

/** dev-login straight onto `path`; returns once the shell has rendered and the
 *  screen's data has settled. */
export async function openScreen(page: Page, user: LayoutUser, path: string): Promise<void> {
  const login = `/auth/dev-login?email=${encodeURIComponent(USERS[user].email)}&next=${encodeURIComponent(path)}`;
  const expected = path.split('?')[0];
  // Parallel workers log the SAME seed user in at once, and minting a magic
  // link replaces that user's previous token — so a concurrent dev-login can
  // lose the race and land on /login?error=devlogin. That is a harness race,
  // not a screen defect: retry the LOGIN (never a check) with jitter.
  for (let attempt = 1; ; attempt++) {
    await page.goto(login, { waitUntil: 'domcontentloaded', timeout: 150_000 });
    await page.waitForURL((u) => u.pathname === expected || u.pathname === '/login', { timeout: 90_000 });
    if (new URL(page.url()).pathname === expected) break;
    if (attempt >= 4) throw new Error(`dev-login as ${USERS[user].email} kept landing on ${page.url()}`);
    await page.waitForTimeout(500 + Math.floor(Math.random() * 1500));
  }
  // The shell is client-only (`ssr:false`): wait until it has replaced the boot
  // screen in the light DOM, never on Next's shadow-DOM dev indicator
  // (`shell-ready.ts`). A shell that never mounts fails here, loudly, instead
  // of being measured as the screen. The first load of a run pays the cold
  // compile of the lazy shell chunk, hence the long timeout.
  await page.waitForFunction(shellMounted, undefined, { timeout: 120_000 });
  await settle(page);
}

async function settle(page: Page): Promise<void> {
  // Realtime keeps a websocket open, which networkidle ignores; the 60 s
  // safety sync is far outside this window. A timeout here is not a failure —
  // the checks below judge whatever rendered.
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  // Skeletons (`animate-pulse`) mean "still loading"; give data a bounded
  // chance to replace them so we measure the real screen.
  await page
    .waitForFunction(() => document.querySelectorAll('.animate-pulse').length === 0, undefined, { timeout: 15_000 })
    .catch(() => undefined);
  await page.waitForTimeout(250);
}

/**
 * The in-page measurement pass. Runs in the browser, so it must be
 * self-contained (no closures over Node values beyond its argument).
 */
type Measured = Omit<LayoutSnapshot, 'screenId' | 'project' | 'consoleErrors' | 'failedRequests' | 'screenshot'>;

export async function measure(page: Page): Promise<Measured> {
  return page.evaluate((minHit) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const NAV_LABELS = new Set(['Home', 'Events', 'Guests', 'Check-in', 'More']);

    const describe = (el: Element): string => {
      const tag = el.tagName.toLowerCase();
      const label =
        el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        (el as HTMLElement).innerText?.trim().replace(/\s+/g, ' ').slice(0, 40) ||
        '';
      const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).slice(0, 6).join('.');
      return `<${tag}${cls ? `.${cls}` : ''}>${label ? ` "${label}"` : ''}`;
    };

    const isRendered = (el: Element, r: DOMRect): boolean => {
      if (r.width === 0 || r.height === 0) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      // Visually-hidden (sr-only) content: a 1px clipped box, deliberately off.
      if (r.width <= 1 || r.height <= 1) return false;
      if (el.closest('[inert], [aria-hidden="true"]')) return false;
      return true;
    };

    // ── 1. horizontal overflow ───────────────────────────────────────────────
    // An element whose right edge passes the viewport is a finding, INCLUDING
    // when the shell's own `overflow-hidden` clips it — content cut off at the
    // screen edge is exactly the bug. Two deliberate exceptions:
    //   · an intended horizontal scroller (`overflow-x-auto/scroll`, or
    //     `overflow-auto/scroll` both ways): its content is reachable by
    //     swiping, and the scroller itself is still checked;
    //   · text truncated with an ellipsis: the clipping IS the design.
    // A vertical scroller (`overflow-y-auto`) computes overflow-x to `auto`
    // too, so intent is read from the class, not the computed style.
    const HSCROLL = /(^|\s)(?:[a-z0-9]+:)*overflow(?:-x)?-(?:auto|scroll)(\s|$)/;
    const exempt = (el: Element): boolean => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const cls = typeof p.className === 'string' ? p.className : '';
        if (HSCROLL.test(cls)) return true;
        const cs = getComputedStyle(p);
        if (cs.textOverflow === 'ellipsis' && cs.overflowX !== 'visible') return true;
      }
      return false;
    };
    const overflow: { what: string; right: number }[] = [];
    const flagged: Element[] = [];
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      if (r.right <= vw + 1) continue;
      if (!isRendered(el, r)) continue;
      if (flagged.some((f) => f.contains(el))) continue; // report the outermost only
      if (exempt(el)) continue;
      flagged.push(el);
      overflow.push({ what: describe(el), right: Math.round(r.right) });
    }

    // ── 2. tap targets ──────────────────────────────────────────────────────
    // Hit box = the element's border box ∪ an absolutely positioned
    // ::before/::after on a positioned element (the kit's invisible hit-ring,
    // `hitArea44`) ∪ its <label> (a label click activates the control).
    const pseudoBox = (el: Element, r: DOMRect, which: '::before' | '::after'): DOMRect | null => {
      const ps = getComputedStyle(el, which);
      if (!ps.content || ps.content === 'none' || ps.content === 'normal') return null;
      if (ps.position !== 'absolute') return null;
      const own = getComputedStyle(el);
      if (own.position === 'static') return null; // containing block is elsewhere: not a ring
      const cbLeft = r.left + parseFloat(own.borderLeftWidth);
      const cbTop = r.top + parseFloat(own.borderTopWidth);
      const cbW = (el as HTMLElement).clientWidth;
      const cbH = (el as HTMLElement).clientHeight;
      const px = (v: string): number | null => (v.endsWith('px') ? parseFloat(v) : null);
      const left = px(ps.left);
      const right = px(ps.right);
      const top = px(ps.top);
      const bottom = px(ps.bottom);
      let w = px(ps.width);
      let h = px(ps.height);
      if (w === null && left !== null && right !== null) w = cbW - left - right;
      if (h === null && top !== null && bottom !== null) h = cbH - top - bottom;
      if (w === null || h === null) return null;
      const x = left !== null ? cbLeft + left : right !== null ? cbLeft + cbW - right - w : cbLeft;
      const y = top !== null ? cbTop + top : bottom !== null ? cbTop + cbH - bottom - h : cbTop;
      return new DOMRect(x, y, w, h);
    };
    const union = (a: DOMRect, b: DOMRect): DOMRect => {
      const l = Math.min(a.left, b.left);
      const t = Math.min(a.top, b.top);
      return new DOMRect(l, t, Math.max(a.right, b.right) - l, Math.max(a.bottom, b.bottom) - t);
    };
    const labelBox = (el: Element): DOMRect | null => {
      if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) {
        return null;
      }
      const labels = Array.from(el.labels ?? []);
      let box: DOMRect | null = null;
      for (const l of labels) {
        const lr = l.getBoundingClientRect();
        if (!isRendered(l, lr)) continue;
        box = box ? union(box, lr) : lr;
      }
      return box;
    };

    const TARGETS = 'button, a[href], [role="button"], input:not([type="hidden"]), select, [role="tab"]';
    const smallTargets: { what: string; w: number; h: number }[] = [];
    const smallFields: { what: string; w: number; h: number }[] = [];
    let measuredTargets = 0;
    let measuredFields = 0;
    for (const el of Array.from(document.querySelectorAll(TARGETS))) {
      const isField = el.matches('input, select') && !el.matches('[role="button"], [role="tab"]');
      const r = el.getBoundingClientRect();
      // A sr-only <input> behind a visible <label> is measured through the label.
      const lbl = labelBox(el);
      if (!isRendered(el, r) && !lbl) continue;
      let hit = isRendered(el, r) ? r : (lbl as DOMRect);
      for (const which of ['::before', '::after'] as const) {
        const pb = pseudoBox(el, r, which);
        if (pb) hit = union(hit, pb);
      }
      if (lbl) hit = union(hit, lbl);
      if (isField) measuredFields++;
      else measuredTargets++;
      // 0.05px absorbs float noise in sub-pixel layout, nothing more.
      if (hit.width >= minHit - 0.05 && hit.height >= minHit - 0.05) continue;
      (isField ? smallFields : smallTargets).push({
        what: describe(el),
        w: Math.round(hit.width * 10) / 10,
        h: Math.round(hit.height * 10) / 10,
      });
    }

    // ── 3. chrome ───────────────────────────────────────────────────────────
    const aside = Array.from(document.querySelectorAll('aside')).find((a) => isRendered(a, a.getBoundingClientRect()));
    const ar = aside?.getBoundingClientRect();
    // The TabBar: one row holding ≥3 buttons whose labels are the bottom-tab
    // labels, outside the sidebar.
    const rows = new Map<Element, number>();
    for (const b of Array.from(document.querySelectorAll('button'))) {
      if (b.closest('aside')) continue;
      const label = (b as HTMLElement).innerText?.trim().split('\n').pop()?.trim() ?? '';
      if (!NAV_LABELS.has(label) || !b.parentElement) continue;
      if (!isRendered(b, b.getBoundingClientRect())) continue;
      rows.set(b.parentElement, (rows.get(b.parentElement) ?? 0) + 1);
    }
    // The row is the TabBar's centered 640px inner cluster; its parent is the
    // bar itself, whose padding carries the bottom safe area — dock-check that.
    const bar = [...rows].find(([, n]) => n >= 3)?.[0]?.parentElement ?? undefined;
    const br = bar?.getBoundingClientRect();

    return {
      finalPath: location.pathname,
      innerWidth: vw,
      docScrollWidth: document.documentElement.scrollWidth,
      overflow,
      smallTargets,
      measuredTargets,
      smallFields,
      measuredFields,
      sidebar: { present: !!aside, width: ar ? Math.round(ar.width) : 0, left: ar ? Math.round(ar.left) : 0 },
      tabBar: { present: !!bar, bottomGap: br ? Math.round(vh - br.bottom) : -1 },
      pointerCoarse: matchMedia('(pointer: coarse)').matches,
    };
  }, MIN_HIT);
}

/**
 * Full-page screenshot. The shell is a fixed `100dvh` frame with an inner
 * scroller, so Playwright's `fullPage` alone would only capture one viewport:
 * grow the viewport height by the inner scrollers' overflow first (width, and
 * therefore every breakpoint, untouched). Runs AFTER `measure`.
 */
export async function fullScreenshot(page: Page, project: string, screenId: string): Promise<string> {
  const vp = page.viewportSize();
  if (vp) {
    const extra = await page.evaluate(() => {
      let max = 0;
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const oy = getComputedStyle(el).overflowY;
        if (oy !== 'auto' && oy !== 'scroll') continue;
        max = Math.max(max, el.scrollHeight - el.clientHeight);
      }
      return max;
    });
    if (extra > 0) {
      await page.setViewportSize({ width: vp.width, height: Math.min(vp.height + extra, 8000) });
      await page.waitForTimeout(250);
    }
  }
  const dir = join(SCREENSHOT_DIR, project);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${screenId}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
  if (vp) await page.setViewportSize(vp);
  return file;
}

/**
 * The snapshot for one screen × project: from this run's cache when a worker
 * restart already produced it, otherwise by loading and measuring the screen.
 */
export async function loadSnapshot(browser: Browser, testInfo: TestInfo, screen: LayoutScreen): Promise<LayoutSnapshot> {
  const project = testInfo.project.name;
  const file = join(SNAPSHOT_DIR, project, `${screen.id}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as LayoutSnapshot;

  const context = await newProjectContext(browser, testInfo);
  try {
    const page = await context.newPage();
    const failures = recordFailures(page);
    await openScreen(page, screen.user, screen.path);
    const measured = await measure(page);
    // Failures are copied AFTER the screenshot, so anything the resize for the
    // full-page capture triggers counts too.
    const screenshot = await fullScreenshot(page, project, screen.id);
    const snap: LayoutSnapshot = {
      screenId: screen.id,
      project,
      ...measured,
      consoleErrors: [...failures.consoleErrors],
      failedRequests: [...failures.failedRequests],
      screenshot,
    };
    mkdirSync(join(SNAPSHOT_DIR, project), { recursive: true });
    writeFileSync(file, JSON.stringify(snap, null, 2));
    return snap;
  } finally {
    await context.close();
  }
}
