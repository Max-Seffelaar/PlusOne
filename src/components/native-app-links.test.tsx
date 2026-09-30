// @vitest-environment jsdom
/**
 * NativeAppLinks (Fase 17 S4): registers `appUrlOpen` only in the native shell,
 * navigates only for the two claimed auth paths, navigates a given link at most
 * once per app process (retained iOS event + launch URL, Android's sticky
 * launch URL across later links and reloads), and never strands a link whose
 * navigation did not commit (offline first tap).
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
const LINK2 = 'https://app.plus-one.io/auth/confirm?token_hash=t2&type=email_change&next=%2Fapp%2Fprofile';

/** The navigation commits: the old document unloads. */
const commit = (): void => {
  window.dispatchEvent(new Event('pagehide'));
};

function setOnline(on: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => on });
}

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
  vi.useRealTimers();
  setOnline(true);
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

  it('Android: the sticky launch URL is not replayed after a later link and its reload', async () => {
    setNative(true);
    // Capacitor Android keeps reporting the cold-start link for the whole process.
    cap.getLaunchUrl.mockResolvedValue({ url: LINK });
    let mod = await load();
    render(<mod.NativeAppLinks />);
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    commit();
    cleanup();

    // Reload after the cold-start link: same launch URL → nothing.
    mod = await load();
    render(<mod.NativeAppLinks />);
    await waitFor(() => expect(cap.getLaunchUrl).toHaveBeenCalledTimes(2));
    await flush();
    expect(assign).toHaveBeenCalledTimes(1);

    // Later, app running: the user taps a second link.
    cap.listener!({ url: LINK2 });
    expect(assign).toHaveBeenCalledTimes(2);
    expect(assign).toHaveBeenLastCalledWith(
      '/auth/confirm?token_hash=t2&type=email_change&next=%2Fapp%2Fprofile',
    );
    commit();
    cleanup();

    // Its redirect loads a new document; getLaunchUrl() STILL reports the first link.
    mod = await load();
    render(<mod.NativeAppLinks />);
    await waitFor(() => expect(cap.getLaunchUrl).toHaveBeenCalledTimes(3));
    await flush();
    expect(assign).toHaveBeenCalledTimes(2);

    // …and again after an app resume that re-reads the launch URL.
    cleanup();
    mod = await load();
    render(<mod.NativeAppLinks />);
    await waitFor(() => expect(cap.getLaunchUrl).toHaveBeenCalledTimes(4));
    await flush();
    expect(assign).toHaveBeenCalledTimes(2);
  });

  it('does not navigate a link again in the same process once it committed', async () => {
    setNative(true);
    const mod = await load();
    render(<mod.NativeAppLinks />);
    await waitFor(() => expect(cap.listener).not.toBeNull());
    cap.listener!({ url: LINK });
    commit();
    cleanup();
    const next = await load();
    render(<next.NativeAppLinks />);
    await waitFor(() => expect(cap.addListener).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(cap.getLaunchUrl).toHaveBeenCalledTimes(2));
    cap.listener!({ url: LINK }); // the same mail link tapped again
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('offline first tap is not consumed and runs once the device is back online', async () => {
    setNative(true);
    setOnline(false);
    const { NativeAppLinks } = await load();
    render(<NativeAppLinks />);
    await waitFor(() => expect(cap.getLaunchUrl).toHaveBeenCalled());
    cap.listener!({ url: LINK });
    expect(assign).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('po.appLinks.consumed')).toBeNull();

    setOnline(true);
    window.dispatchEvent(new Event('online'));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/auth/confirm?token_hash=t1&type=invite');
  });

  it('offline cold start: the launch URL stays usable for the next document once online', async () => {
    setNative(true);
    setOnline(false);
    cap.getLaunchUrl.mockResolvedValue({ url: LINK });
    let mod = await load();
    render(<mod.NativeAppLinks />);
    await waitFor(() => expect(cap.getLaunchUrl).toHaveBeenCalledTimes(1));
    await flush();
    expect(assign).not.toHaveBeenCalled();
    cleanup();
    setOnline(true);
    mod = await load();
    render(<mod.NativeAppLinks />);
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
  });

  it('a navigation that never commits leaves the link retryable (and other links unblocked)', async () => {
    setNative(true);
    const mod = await load();
    render(<mod.NativeAppLinks />);
    await waitFor(() => expect(cap.getLaunchUrl).toHaveBeenCalled());
    await flush();
    vi.useFakeTimers();
    cap.listener!({ url: LINK }); // onLine lied: the request fails, the page stays
    expect(assign).toHaveBeenCalledTimes(1);
    cap.listener!({ url: LINK2 }); // same document, navigation still in flight
    expect(assign).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(mod.COMMIT_TIMEOUT_MS);
    expect(window.sessionStorage.getItem('po.appLinks.consumed')).toBeNull();
    cap.listener!({ url: LINK }); // the user taps the same link again
    expect(assign).toHaveBeenCalledTimes(2);
  });

  it('keeps the raw link (token_hash) out of sessionStorage', async () => {
    setNative(true);
    cap.getLaunchUrl.mockResolvedValue({ url: LINK });
    const { NativeAppLinks } = await load();
    render(<NativeAppLinks />);
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    commit();
    const stored = Object.keys(window.sessionStorage)
      .map((k) => window.sessionStorage.getItem(k) ?? '')
      .join('|');
    expect(stored).not.toBe('');
    expect(stored).not.toContain('t1');
    expect(stored).not.toContain('auth/confirm');
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
