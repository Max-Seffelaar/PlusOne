import type { Project } from '@playwright/test';
import { doorPath, screenPath, tabPath } from '@/components/po/routes';
import { CHROME_BREAKPOINT } from '../layout/matrix';

/**
 * Store screenshot sets (86ey6bf8k). Each set is one Playwright project whose
 * `viewport × deviceScaleFactor` is EXACTLY the pixel size the store accepts —
 * the spec asserts the PNG header, so a size drift fails the run instead of
 * being rejected by App Store Connect / Play Console at upload time.
 *
 * Sources (accessed 2026-10-05, table + links in docs/store/screenshots.md):
 *   Apple "Screenshot specifications" — iPhone 6.9": 1290×2796 among the
 *     accepted sizes; iPad 13": 2064×2752 / 2752×2064 (required if the app runs
 *     on iPad). PNG/JPEG, no alpha.
 *   Google Play "Add preview assets" — phone 9:16 portrait, min 1080×1920;
 *     tablets 9:16 or 16:9 between 1080 and 7680 px; max side ≤ 2× min side
 *     overall; 24-bit PNG (no alpha); feature graphic 1024×500.
 *
 * Every set is touch (`isMobile` + `hasTouch` → `(pointer: coarse)`), so the
 * Deur tab is the offline-outbox door on all of them (plan decision 14), as on
 * a real phone/tablet. CSS widths are picked against the ONE chrome breakpoint
 * (1024, use-viewport.ts) and the `md:` (768) content switch:
 *   play-phone      432 CSS  → bottom tabs, phone layout
 *   play-tablet-7   792 CSS  → bottom tabs, `md:` tablet layout (T1)
 *   play-tablet-10 1280 CSS  → sidebar (landscape)
 *   apple-iphone-69 430 CSS  → bottom tabs (iPhone 15/16 Pro Max viewport)
 *   apple-ipad-13  1032 CSS  → sidebar — a real 13" iPad is 1032 CSS px wide in
 *                  portrait, so the sidebar IS what an iPad 13" user sees
 *   apple-ipad-13-landscape 1376 CSS → sidebar
 */
export interface StoreSet {
  name: string;
  /** CSS viewport. */
  width: number;
  height: number;
  dpr: number;
  shots: readonly StoreShotId[];
}

export type StoreShotId = 'home' | 'guestlist' | 'door' | 'requests' | 'stats';

const ALL: readonly StoreShotId[] = ['home', 'guestlist', 'door', 'requests', 'stats'];

export const STORE_SETS: readonly StoreSet[] = [
  { name: 'play-phone', width: 432, height: 768, dpr: 2.5, shots: ALL }, // 1080×1920
  { name: 'play-tablet-7', width: 792, height: 1408, dpr: 1.5, shots: ALL }, // 1188×2112
  { name: 'play-tablet-10', width: 1280, height: 720, dpr: 2, shots: ALL }, // 2560×1440
  { name: 'apple-iphone-69', width: 430, height: 932, dpr: 3, shots: ALL }, // 1290×2796
  { name: 'apple-ipad-13', width: 1032, height: 1376, dpr: 2, shots: ALL }, // 2064×2752
  { name: 'apple-ipad-13-landscape', width: 1376, height: 1032, dpr: 2, shots: ['guestlist', 'door'] }, // 2752×2064
];

/** The demo user + night written by scripts/store-screenshot-seed.mjs (same ids). */
export const STORE_DEMO = {
  email: 'store-demo@plusone.test',
  userId: '5d000000-0000-4000-8000-000000000001',
  venueId: 'aa000000-0000-7000-8000-000000000001',
  liveEventId: '5e000000-0000-7000-8000-000000000001',
} as const;

/**
 * The shot-list (docs/store/screenshots.md). Never Settings, Platform or
 * Billing. URLs are built with the app's own route helpers, like the layout
 * suite's screens.ts, so a route rename moves this list with it.
 */
export const STORE_SHOTS: Record<StoreShotId, { order: number; path: string }> = {
  home: { order: 1, path: tabPath('start') },
  guestlist: { order: 2, path: screenPath('lijst', { id: STORE_DEMO.liveEventId }) },
  door: { order: 3, path: doorPath({ eventId: STORE_DEMO.liveEventId }) },
  requests: { order: 4, path: screenPath('aanvragen') },
  stats: { order: 5, path: screenPath('stats') },
};

/** The PNG size the store expects for a set. */
export function pixelSize(s: StoreSet): { width: number; height: number } {
  return { width: Math.round(s.width * s.dpr), height: Math.round(s.height * s.dpr) };
}

export function storeSetFor(projectName: string): StoreSet {
  const s = STORE_SETS.find((x) => x.name === projectName);
  if (!s) throw new Error(`unknown store set "${projectName}" — run via pnpm store:screenshots`);
  return s;
}

export function expectsSidebar(s: StoreSet): boolean {
  return s.width >= CHROME_BREAKPOINT;
}

export const FEATURE_GRAPHIC = { name: 'play-feature-graphic', width: 1024, height: 500 } as const;

export const STORE_PROJECTS: Project[] = [
  ...STORE_SETS.map((s) => ({
    name: s.name,
    testMatch: /shots\.spec\.ts/,
    use: {
      browserName: 'chromium' as const,
      viewport: { width: s.width, height: s.height },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: s.dpr,
    },
  })),
  {
    name: FEATURE_GRAPHIC.name,
    testMatch: /feature-graphic\.spec\.ts/,
    use: {
      browserName: 'chromium' as const,
      viewport: { width: FEATURE_GRAPHIC.width, height: FEATURE_GRAPHIC.height },
      deviceScaleFactor: 1,
    },
  },
];
