// @vitest-environment jsdom
/**
 * NativeBackButton (Fase 17 N3): registers the Android back listener only in
 * the native shell, routes it through `nativeBackAction`, and cleans up on
 * unmount. In a normal browser it must do nothing at all (web unchanged).
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

const nav = vi.hoisted(() => ({
  pathname: '/app/events',
  back: vi.fn(),
  replace: vi.fn(),
}));
const cap = vi.hoisted(() => ({
  listener: null as null | ((e: { canGoBack: boolean }) => void),
  remove: vi.fn(async () => undefined),
  addListener: vi.fn(),
  minimizeApp: vi.fn(async () => undefined),
}));

vi.mock('next/navigation', () => {
  const router = { back: nav.back, replace: nav.replace };
  return { usePathname: () => nav.pathname, useRouter: () => router };
});
vi.mock('@capacitor/app', () => ({
  App: { addListener: cap.addListener, minimizeApp: cap.minimizeApp },
}));

import { NativeBackButton } from './native-back-button';

function setNative(on: boolean): void {
  if (on) (window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
  else delete (window as { Capacitor?: unknown }).Capacitor;
}

beforeEach(() => {
  cap.listener = null;
  cap.addListener.mockImplementation(async (_evt: string, fn: (e: { canGoBack: boolean }) => void) => {
    cap.listener = fn;
    return { remove: cap.remove };
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setNative(false);
  nav.pathname = '/app/events';
});

describe('NativeBackButton', () => {
  it('registers nothing in a normal browser', async () => {
    render(<NativeBackButton />);
    await new Promise((r) => setTimeout(r, 0));
    expect(cap.addListener).not.toHaveBeenCalled();
  });

  it('goes back through the router on an /app sub-screen', async () => {
    setNative(true);
    render(<NativeBackButton />);
    await waitFor(() => expect(cap.listener).not.toBeNull());
    expect(cap.addListener).toHaveBeenCalledWith('backButton', expect.any(Function));
    cap.listener!({ canGoBack: true });
    expect(nav.back).toHaveBeenCalledTimes(1);
    expect(cap.minimizeApp).not.toHaveBeenCalled();
  });

  it('minimizes on the /app root, reading the live pathname', async () => {
    setNative(true);
    const { rerender } = render(<NativeBackButton />);
    await waitFor(() => expect(cap.listener).not.toBeNull());
    nav.pathname = '/app';
    rerender(<NativeBackButton />);
    cap.listener!({ canGoBack: true });
    expect(cap.minimizeApp).toHaveBeenCalledTimes(1);
    expect(nav.back).not.toHaveBeenCalled();
    // Registered once, not per navigation.
    expect(cap.addListener).toHaveBeenCalledTimes(1);
  });

  it('replaces to the picker from a standalone door event', async () => {
    setNative(true);
    nav.pathname = '/door/evt-1';
    render(<NativeBackButton />);
    await waitFor(() => expect(cap.listener).not.toBeNull());
    cap.listener!({ canGoBack: true });
    expect(nav.replace).toHaveBeenCalledWith('/door');
  });

  it('removes the listener on unmount so Capacitor’s default back comes back', async () => {
    setNative(true);
    const { unmount } = render(<NativeBackButton />);
    await waitFor(() => expect(cap.listener).not.toBeNull());
    await new Promise((r) => setTimeout(r, 0));
    unmount();
    expect(cap.remove).toHaveBeenCalledTimes(1);
  });
});
