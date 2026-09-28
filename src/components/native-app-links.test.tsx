// @vitest-environment jsdom
/**
 * NativeAppLinks (Fase 17 S4): registers `appUrlOpen` only in the native shell,
 * navigates only for the two claimed auth paths, and never replays a
 * single-use link (retained iOS event + launch URL, or a remount after the
 * reload its own navigation causes).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

const cap = vi.hoisted(() => ({
  listener: null as null | ((e: { url: string }) => void),
  remove: vi.fn(async () => undefined),
  addListener: vi.fn(),
  getLaunchUrl: vi.fn(),
}));

vi.mock('@capacitor/app', () => ({
  App: { addListener: cap.addListener, getLaunchUrl: cap.getLaunchUrl },
}));

const assign = vi.fn();
const LINK = 'https://app.plus-one.io/auth/confirm?token_hash=t1&type=invite';

async function load(): Promise<typeof import('./native-app-links')> {
  vi.resetModules(); // fresh module state = a fresh document
  return import('./native-app-links');
}

function setNative(on: boolean): void {
  if (on) (window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
  else delete (window as { Capacitor?: unknown }).Capacitor;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  cap.listener = null;
  cap.addListener.mockImplementation(async (_evt: string, fn: (e: { url: string }) => void) => {
    cap.listener = fn;
    return { remove: cap.remove };
  });
  cap.getLaunchUrl.mockResolvedValue(undefined);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign },
  });
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  setNative(false);
});

describe('NativeAppLinks', () => {
  it('registers nothing in a normal browser', async () => {
    const { NativeAppLinks } = await load();
    render(<NativeAppLinks />);
    await flush();
    expect(cap.addListener).not.toHaveBeenCalled();
    expect(cap.getLaunchUrl).not.toHaveBeenCalled();
  });

  it('navigates a claimed auth link as a same-origin relative document load', async () => {
    setNative(true);
    const { NativeAppLinks } = await load();
    render(<NativeAppLinks />);
    await waitFor(() => expect(cap.listener).not.toBeNull());
    expect(cap.addListener).toHaveBeenCalledWith('appUrlOpen', expect.any(Function));
    cap.listener!({ url: LINK });
    expect(assign).toHaveBeenCalledWith('/auth/confirm?token_hash=t1&type=invite');
  });

  it.each([
    'https://app.plus-one.io/e/party',
    'https://app.plus-one.io.evil.com/auth/confirm',
    'http://app.plus-one.io/auth/confirm',
    'javascript:alert(1)',
    'https://app.plus-one.io/auth/confirm/../../app',
  ])('ignores %s', async (url) => {
    setNative(true);
    const { NativeAppLinks } = await load();
    render(<NativeAppLinks />);
    await waitFor(() => expect(cap.listener).not.toBeNull());
    cap.listener!({ url });
    expect(assign).not.toHaveBeenCalled();
  });

  it('follows a claimed launch URL once, not again after the reload it causes', async () => {
    setNative(true);
    cap.getLaunchUrl.mockResolvedValue({ url: LINK });
    let mod = await load();
    render(<mod.NativeAppLinks />);
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    cleanup();
    // The reload: new document, same launch URL still reported by Capacitor.
    mod = await load();
    render(<mod.NativeAppLinks />);
    await waitFor(() => expect(cap.getLaunchUrl).toHaveBeenCalledTimes(2));
    await flush();
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('navigates once when iOS delivers the cold-start link as event AND launch URL', async () => {
    setNative(true);
    cap.addListener.mockImplementation(async (_evt: string, fn: (e: { url: string }) => void) => {
      cap.listener = fn;
      fn({ url: LINK }); // retained event, delivered on registration
      return { remove: cap.remove };
    });
    cap.getLaunchUrl.mockResolvedValue({ url: LINK });
    const { NativeAppLinks } = await load();
    render(<NativeAppLinks />);
    await waitFor(() => expect(cap.getLaunchUrl).toHaveBeenCalled());
    await flush();
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('skips the launch URL when sessionStorage is unavailable (no replay loop)', async () => {
    setNative(true);
    cap.getLaunchUrl.mockResolvedValue({ url: LINK });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const { NativeAppLinks } = await load();
    render(<NativeAppLinks />);
    await waitFor(() => expect(cap.getLaunchUrl).toHaveBeenCalled());
    await flush();
    expect(assign).not.toHaveBeenCalled();
    // A live event is still honoured.
    cap.listener!({ url: LINK });
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('removes the listener on unmount', async () => {
    setNative(true);
    const { NativeAppLinks } = await load();
    const { unmount } = render(<NativeAppLinks />);
    await waitFor(() => expect(cap.getLaunchUrl).toHaveBeenCalled());
    unmount();
    expect(cap.remove).toHaveBeenCalled();
  });
});
