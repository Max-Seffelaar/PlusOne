import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { test as base, expect, type Page, type Project } from '@playwright/test';
import { LAYOUT_DEVICES, type LayoutDevice } from '../e2e/layout/matrix';

/**
 * QA-0 flow harness (onboarding-orchestration-claude-code.md §1 "Visueel bewijs
 * per PR"). A flow is a `tests/flows/<name>.flow.ts` spec that walks one user
 * journey, screenshots every step (`shot`) and turns the handoff questions a
 * machine can answer into numbered asserts (`check`). Run through
 * `pnpm qa:flows <name>` (scripts/flow-shots/run.mjs), which also builds the
 * contact sheet from what this file writes.
 *
 * Output per flow × variant, in `flow-screenshots/<flow>/<variant>/`:
 *   NN-<label>.png   full-page screenshot per step
 *   flow.json        steps + asserts (question number, text, passed/failed)
 */

/**
 * The variants are layout-matrix devices (tests/e2e/layout/matrix.ts), never
 * a second matrix: a flow variant is a device plus "inside the native shell or
 * not". iPad = the 1024 iPad Pro portrait entry: touch, and on the sidebar side
 * of the one chrome breakpoint.
 */
const VARIANT_DEVICES = {
  'desktop-browser': { device: 'laptop-1280-mouse', native: false },
  'phone-browser': { device: 'phone-390-touch', native: false },
  'phone-native': { device: 'phone-390-touch', native: true },
  'ipad-native': { device: 'ipadpro-1024-touch', native: true },
} as const;

export type FlowVariant = keyof typeof VARIANT_DEVICES;
export const FLOW_VARIANTS = Object.keys(VARIANT_DEVICES) as FlowVariant[];

function device(name: string): LayoutDevice {
  const d = LAYOUT_DEVICES.find((x) => x.name === name);
  if (!d) throw new Error(`flow harness: layout device "${name}" is gone from matrix.ts`);
  return d;
}

export const FLOW_PROJECTS: Project<FlowOptions>[] = FLOW_VARIANTS.map((name) => {
  const v = VARIANT_DEVICES[name];
  const d = device(v.device);
  return {
    name,
    use: {
      browserName: 'chromium',
      viewport: { width: d.width, height: d.height },
      isMobile: d.touch,
      hasTouch: d.touch,
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      native: v.native,
    },
  };
});

export const OUT_ROOT = resolve(process.cwd(), 'flow-screenshots');

/** Store-tax copy that must never render inside the native shell (#32/#37). Same
 *  list the unit guards use (billing.native.test.tsx, native-store-tax.test.tsx). */
export const PURCHASE_COPY = /€|\/ ?month|\/ ?year|payment|iDEAL|SEPA|pick your plan|pick a plan|checkout|portal|reactivate|upgrade|on the web/i;

export interface FlowOptions {
  /** Simulate the Capacitor native shell (remote-URL model) in this context. */
  native: boolean;
}

interface AssertRecord {
  q: number;
  text: string;
  status: 'passed' | 'failed' | 'skipped';
  error?: string;
}

export interface Flow {
  variant: FlowVariant;
  native: boolean;
  /** Full-page screenshot of the current page as the next numbered step. */
  shot: (label: string) => Promise<string>;
  /** One machine-answered handoff question. `q` is its number in the PR handoff. */
  check: (q: number, text: string, fn: () => Promise<void>) => Promise<void>;
  /** Record a question this variant deliberately does not answer (not applicable). */
  skip: (q: number, text: string) => void;
  /** Uncaught page errors seen so far (window `error` / unhandled rejections). */
  pageErrors: string[];
  /** Every screenshot taken so far, with whether that page scrolled sideways. */
  steps: readonly Step[];
}

interface Step {
  n: number;
  label: string;
  file: string;
  url: string;
  overflowX: boolean;
}

export const test = base.extend<FlowOptions & { flow: Flow }>({
  native: [false, { option: true }],

  context: async ({ context, native }, provide) => {
    if (native) {
      // What the real shell injects before any page script (native-bridge.js):
      // a `Capacitor` global that answers isNativePlatform(), plus the Android
      // bridge object. @capacitor/core rebuilds `window.Capacitor` when a
      // plugin chunk loads and then derives the platform from `androidBridge`,
      // so both halves are needed for the flag to hold for the whole session.
      await context.addInitScript(() => {
        const w = window as unknown as Record<string, unknown>;
        w.androidBridge = { postMessage: () => {} };
        w.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
      });
    }
    await provide(context);
  },

  flow: async ({ page, native }, provide, testInfo) => {
    const flowName = basename(testInfo.file).replace(/\.flow\.ts$/, '');
    const variant = testInfo.project.name as FlowVariant;
    const dir = join(OUT_ROOT, flowName, variant);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    const steps: Step[] = [];
    const asserts: AssertRecord[] = [];
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    const flow: Flow = {
      variant,
      native,
      pageErrors,
      steps,
      async shot(label) {
        // Let entrance transitions and late data settle; a flow screenshot is
        // evidence for a human, not a timing measurement.
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(400);
        const n = steps.length + 1;
        const file = `${String(n).padStart(2, '0')}-${label}.png`;
        await page.screenshot({ path: join(dir, file), fullPage: true });
        const overflowX = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        );
        steps.push({ n, label, file, url: new URL(page.url()).pathname, overflowX });
        return file;
      },
      async check(q, text, fn) {
        await test.step(`Q${q} ${text}`, async () => {
          try {
            await fn();
            asserts.push({ q, text, status: 'passed' });
          } catch (e) {
            asserts.push({ q, text, status: 'failed', error: firstLine((e as Error).message) });
            throw e;
          }
        });
      },
      skip(q, text) {
        asserts.push({ q, text, status: 'skipped' });
      },
    };

    await provide(flow);

    writeFileSync(
      join(dir, 'flow.json'),
      JSON.stringify(
        {
          flow: flowName,
          variant,
          native,
          title: testInfo.title,
          status: testInfo.status === testInfo.expectedStatus ? 'passed' : 'failed',
          viewport: page.viewportSize(),
          error: testInfo.error?.message ? firstLine(testInfo.error.message) : undefined,
          steps,
          asserts,
        },
        null,
        2,
      ),
    );
  },
});

// Playwright colours its messages; flow.json is read by a human, not a TTY.
// eslint-disable-next-line no-control-regex
const firstLine = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0] ?? '';

/** Run this flow only in the listed variants (others are skipped, not run). */
export function onlyVariants(...variants: FlowVariant[]): void {
  test.beforeEach(({}, testInfo) => {
    test.skip(!variants.includes(testInfo.project.name as FlowVariant), `flow not run in ${testInfo.project.name}`);
  });
}

/** No screenshotted step scrolled sideways (measured at each `shot`). */
export function expectNoHorizontalOverflow(flow: Flow): void {
  expect(flow.steps.filter((s) => s.overflowX).map((s) => s.file), 'steps that scroll sideways').toEqual([]);
}

/** Whatever the shell reports to the app's own seam (src/lib/platform.ts). */
export async function reportsNative(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return Boolean(cap?.isNativePlatform?.());
  });
}

export { expect };
