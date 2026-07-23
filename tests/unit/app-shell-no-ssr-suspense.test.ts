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
 * both halves: the page must not import the shell module directly, and the
 * client wrapper must keep `ssr: false`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const PAGE = path.join(ROOT, 'src', 'app', 'app', '[[...segments]]', 'page.tsx');
const APP_CLIENT = path.join(ROOT, 'src', 'components', 'po', 'app-client.tsx');

describe('/app mounts PlusOneApp client-side only (86eya4yuf)', () => {
  it('page.tsx does not import the shell module directly (no SSR-streamed app boundary)', () => {
    const src = readFileSync(PAGE, 'utf8');
    expect(
      /from\s+['"]@\/components\/po\/app['"]/.test(src),
      'src/app/app/[[...segments]]/page.tsx imports @/components/po/app directly — ' +
        'that server-renders PlusOneApp, whose useSearchParams() suspension streams the ' +
        'shell as an rAF-gated boundary that never hydrates in unpainted tabs. ' +
        'Mount it through @/components/po/app-client instead (see that file).',
    ).toBe(false);
    expect(src).toMatch(/from\s+['"]@\/components\/po\/app-client['"]/);
  });

  it('app-client.tsx keeps the ssr:false dynamic mount', () => {
    const src = readFileSync(APP_CLIENT, 'utf8');
    expect(src).toMatch(/ssr:\s*false/);
    expect(src).toMatch(/import\(['"]\.\/app['"]\)/);
  });
});
