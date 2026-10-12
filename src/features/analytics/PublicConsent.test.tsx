// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
// Render the lazily-loaded banner synchronously in the test.
vi.mock('next/dynamic', async () => {
  const mod = await import('./CookieBanner');
  return { default: () => mod.default };
});
const importSpy = vi.fn();
vi.mock('posthog-js', () => {
  importSpy();
  return { default: {} };
});

import { PublicConsent } from './PublicConsent';
import { CONSENT_STORAGE_KEY, readConsent } from './consent';

let root: Root;
let host: HTMLDivElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<PublicConsent />));
}

beforeEach(() => {
  window.localStorage.clear();
  delete (window as { Capacitor?: unknown }).Capacitor;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const banner = (): Element | null => document.querySelector('[data-testid="cookie-banner"]');

describe('PublicConsent', () => {
  it.each(['/', '/login', '/e/club-vesper'])('shows the banner on %s when nothing is decided', (p) => {
    pathname = p;
    mount();
    expect(banner()).not.toBeNull();
  });

  it.each(['/app', '/app/profile', '/door/abc', '/onboarding', '/s/token'])('never shows it on %s', (p) => {
    pathname = p;
    mount();
    expect(banner()).toBeNull();
  });

  it('never shows it inside the native shell', () => {
    (window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    pathname = '/';
    mount();
    expect(banner()).toBeNull();
  });

  it('does not ask again once decided', () => {
    window.localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({ version: '2026-10-18', decidedAt: 'x', analytics: false, marketing: false }),
    );
    pathname = '/';
    mount();
    expect(banner()).toBeNull();
  });

  it('"Only necessary" stores a no and closes; without a key nothing loads', () => {
    pathname = '/';
    mount();
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Only necessary');
    act(() => btn?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(readConsent()).toMatchObject({ analytics: false, marketing: false });
    expect(banner()).toBeNull();
    expect(importSpy).not.toHaveBeenCalled();
  });

  it('"Accept all" stores a yes for both categories', () => {
    pathname = '/';
    mount();
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Accept all');
    act(() => btn?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(readConsent()).toMatchObject({ analytics: true, marketing: true });
    expect(banner()).toBeNull();
    // No NEXT_PUBLIC_POSTHOG_KEY in the test env: consent alone loads nothing.
    expect(importSpy).not.toHaveBeenCalled();
  });

  it('"Choose" lets a visitor grant analytics but not marketing', () => {
    pathname = '/';
    mount();
    const choose = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Choose');
    act(() => choose?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const analyticsSwitch = document.querySelector('[role="switch"][aria-label="Analytics"]');
    act(() => analyticsSwitch?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const save = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Save choices');
    act(() => save?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(readConsent()).toMatchObject({ analytics: true, marketing: false });
  });
});
