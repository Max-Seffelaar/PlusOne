/**
 * /app shell must mount client-side only (86eya4yuf CI guardrail).
 *
 * `PlusOneApp` reads `useSearchParams()`, which suspends during SSR. Rendered
 * directly from the /app page (even under a `<Suspense>`), the whole shell
 * streams as a late `$RC()`-completed boundary — and Next 15.5's inline fizz
 * runtime gates that boundary's reveal AND React's hydration retry on
 * `requestAnimationFrame`. A tab that has never painted (background tab,
 * webview) never fires rAF: the app never hydrates, no query ever mounts, and
 * Home/Deur render as a permanently-settled "no events" page.
 *
 * The fix routes the mount through `app-client.tsx` (`next/dynamic`,
 * `ssr: false`) so the server never suspends on the shell. This guard pins
 * every half: neither the page nor the layout may import the shell module
 * directly, and the client wrapper must keep `ssr: false`.
 *
 * Since 86ey9uc87 the mount point is the LAYOUT, not the page — the layout
 * instance survives client-side navigation, so the shell stops remounting on
 * every `router.push`. That moved the mount but not the rule: `app-client.tsx`
 * is a client module, so its `ssr: false` still removes the server suspension
 * by construction no matter which server parent renders it. The guard follows
 * the mount instead of assuming it, and covers both files so a future move
 * back to the page can't quietly drop `ssr: false` either.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const PAGE = path.join(ROOT, 'src', 'app', 'app', '[[...segments]]', 'page.tsx');
const LAYOUT = path.join(ROOT, 'src', 'app', 'app', 'layout.tsx');
const APP_CLIENT = path.join(ROOT, 'src', 'components', 'po', 'app-client.tsx');

const DIRECT_SHELL_IMPORT = /from\s+['"]@\/components\/po\/app['"]/;
const APP_CLIENT_IMPORT = /from\s+['"]@\/components\/po\/app-client['"]/;

function why(file: string): string {
  return (
    `${file} imports @/components/po/app directly — that server-renders PlusOneApp, ` +
    'whose useSearchParams() suspension streams the shell as an rAF-gated boundary ' +
    'that never hydrates in unpainted tabs. Mount it through ' +
    '@/components/po/app-client instead (see that file).'
  );
}

describe('/app mounts PlusOneApp client-side only (86eya4yuf)', () => {
  it('neither page.tsx nor layout.tsx imports the shell module directly', () => {
    const page = readFileSync(PAGE, 'utf8');
    const layout = readFileSync(LAYOUT, 'utf8');
    expect(DIRECT_SHELL_IMPORT.test(page), why('src/app/app/[[...segments]]/page.tsx')).toBe(false);
    expect(DIRECT_SHELL_IMPORT.test(layout), why('src/app/app/layout.tsx')).toBe(false);
  });

  it('exactly one of them mounts the shell via app-client (the no-remount mount point)', () => {
    const page = readFileSync(PAGE, 'utf8');
    const layout = readFileSync(LAYOUT, 'utf8');
    const mounts = [
      ['page', APP_CLIENT_IMPORT.test(page)],
      ['layout', APP_CLIENT_IMPORT.test(layout)],
    ].filter(([, hit]) => hit);
    expect(
      mounts.length,
      'the /app shell must be mounted from exactly one of page.tsx / layout.tsx — ' +
        'two mounts would render two PlusOneApp trees (two DoorProviders, two outboxes), ' +
        'zero means /app renders nothing.',
    ).toBe(1);
  });

  it('the shell mounts from the layout, so it survives client-side navigation (86ey9uc87)', () => {
    const layout = readFileSync(LAYOUT, 'utf8');
    expect(
      APP_CLIENT_IMPORT.test(layout),
      'src/app/app/layout.tsx no longer mounts the shell. Next rebuilds the PAGE subtree ' +
        'on every segment-path navigation but keeps the LAYOUT instance, so mounting the ' +
        'shell from the page remounts PlusOneApp on every router.push — re-running every ' +
        'shell effect (billing return, identity, viewport, nav, entrance animation) and ' +
        'resetting all shell state. Measured by tests/e2e/app-shell-no-remount.spec.ts.',
    ).toBe(true);
    expect(readFileSync(PAGE, 'utf8')).not.toMatch(APP_CLIENT_IMPORT);
  });

  it('app-client.tsx keeps the ssr:false dynamic mount', () => {
    const src = readFileSync(APP_CLIENT, 'utf8');
    expect(src).toMatch(/ssr:\s*false/);
    expect(src).toMatch(/import\(['"]\.\/app['"]\)/);
  });
});
