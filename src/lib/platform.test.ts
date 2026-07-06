/**
 * isNativeShell — the store-tax seam (#32/#37): every purchase-adjacent
 * affordance hides behind this. Today it must be false everywhere (browser
 * PWA); the Capacitor wrap flips it by injecting window.Capacitor.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isNativeShell } from './platform';

type CapWindow = { Capacitor?: { isNativePlatform?: () => boolean } };

afterEach(() => {
  delete (globalThis as CapWindow & typeof globalThis).Capacitor;
  vi.unstubAllGlobals();
});

describe('isNativeShell', () => {
  it('is false without a window (SSR)', () => {
    // node test env has no window global unless stubbed
    expect(isNativeShell()).toBe(false);
  });

  it('is false in a plain browser window', () => {
    vi.stubGlobal('window', {} as Window);
    expect(isNativeShell()).toBe(false);
  });

  it('is false when Capacitor exists but reports web platform', () => {
    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => false } });
    expect(isNativeShell()).toBe(false);
  });

  it('is true inside a native Capacitor webview', () => {
    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => true } });
    expect(isNativeShell()).toBe(true);
  });

  it('tolerates a Capacitor global without the probe method', () => {
    vi.stubGlobal('window', { Capacitor: {} });
    expect(isNativeShell()).toBe(false);
  });
});
