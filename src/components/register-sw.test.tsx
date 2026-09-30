// @vitest-environment jsdom
/**
 * The offline-shell registration (N7): what the page asks the worker to seed.
 * The worker re-validates everything (tests/unit/service-worker-cache-scope),
 * but the page must still never ASK for more than the rules allow.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { isAppSurface, loadedAssetUrls, shellPathsToSeed } from './register-sw';

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('register-sw seeding helpers', () => {
  it('seeds the landing everywhere and a door page only on /door/<id>', () => {
    expect(shellPathsToSeed('/app/door')).toEqual(['/']);
    expect(shellPathsToSeed('/door')).toEqual(['/']);
    expect(shellPathsToSeed('/door/ev-1')).toEqual(['/', '/door/ev-1']);
    expect(shellPathsToSeed('/door/ev-1/x')).toEqual(['/']);
  });

  it('only the /app surface seeds the session shell', () => {
    expect(isAppSurface('/app')).toBe(true);
    expect(isAppSurface('/app/door')).toBe(true);
    expect(isAppSurface('/apple')).toBe(false);
    expect(isAppSurface('/door/ev-1')).toBe(false);
  });

  it('collects only same-origin /_next/static/ assets from the DOM', () => {
    const origin = window.location.origin;
    document.head.innerHTML = [
      '<script src="/_next/static/chunks/main-abc.js"></script>',
      '<link rel="stylesheet" href="/_next/static/css/app.css">',
      '<script src="https://cdn.example.test/_next/static/chunks/evil.js"></script>',
      '<script src="/app/door?event=1"></script>',
      '<link rel="stylesheet" href="/icons/x.css">',
    ].join('');
    expect(loadedAssetUrls().sort()).toEqual(
      [`${origin}/_next/static/chunks/main-abc.js`, `${origin}/_next/static/css/app.css`].sort(),
    );
  });
});
