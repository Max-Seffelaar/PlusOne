// @vitest-environment jsdom
/**
 * Standalone door + Android back (86ey6bfdm follow-up to N3). The door's sheets
 * are React state, not history entries, so back must close the open sheet
 * first — without navigating and without remounting `DoorProvider` (#25) — and
 * only then leave for the `/door` picker (online) or stay put (offline).
 *
 * Renders the real `DoorRoute` + the real `NativeBackButton`; mocks only the
 * Capacitor plugin, the router, the door's data provider and the door screen.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { useEffect, type JSX, type ReactNode } from 'react';
import { render, cleanup, waitFor, act, fireEvent } from '@testing-library/react';

const H = vi.hoisted(() => ({
  pathname: '/door/ev-a',
  back: vi.fn(),
  replace: vi.fn(),
  listener: null as null | ((e: { canGoBack: boolean }) => void),
  minimizeApp: vi.fn(async () => undefined),
  providerMounts: 0,
  providerUnmounts: 0,
}));

vi.mock('next/navigation', () => {
  const router = { back: H.back, replace: H.replace };
  return { usePathname: () => H.pathname, useRouter: () => router };
});
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (_evt: string, fn: (e: { canGoBack: boolean }) => void) => {
      H.listener = fn;
      return { remove: async () => undefined };
    },
    minimizeApp: H.minimizeApp,
  },
}));
// Phone-sized door (the outbox variant) regardless of how DoorRoute picks it.
vi.mock('@/components/po/use-viewport', () => ({ useViewport: () => true }));
vi.mock('../DoorProvider', () => ({
  DoorProvider: ({ children }: { children?: ReactNode }) => {
    useEffect(() => {
      H.providerMounts += 1;
      return () => {
        H.providerUnmounts += 1;
      };
    }, []);
    return <>{children}</>;
  },
}));
vi.mock('@/components/po/screens/door', () => ({
  PoDoorTab: ({
    overlay,
    openGuest,
    openAdd,
  }: {
    overlay: { kind: string } | null;
    openGuest: (id: string) => void;
    openAdd: () => void;
  }): JSX.Element => (
    <div>
      <span data-testid="overlay">{overlay ? overlay.kind : 'none'}</span>
      <button onClick={() => openGuest('g-1')}>guest</button>
      <button onClick={openAdd}>add</button>
    </div>
  ),
}));

import { DoorRoute } from './DoorRoute';
import { NativeBackButton } from '@/components/po/native-back-button';

function setOnline(on: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
}

async function mount() {
  const view = render(
    <>
      <NativeBackButton />
      <DoorRoute eventId="ev-a" />
    </>,
  );
  await waitFor(() => expect(H.listener).not.toBeNull());
  return view;
}

const back = (): void => act(() => H.listener!({ canGoBack: true }));

beforeEach(() => {
  (window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
  H.listener = null;
  H.pathname = '/door/ev-a';
  H.providerMounts = 0;
  H.providerUnmounts = 0;
  setOnline(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as { Capacitor?: unknown }).Capacitor;
  setOnline(true);
});

describe('standalone door: Android back matrix', () => {
  it('no sheet open, online → the /door picker', async () => {
    await mount();
    back();
    expect(H.replace).toHaveBeenCalledWith('/door');
  });

  it('guest sheet open → back closes it; back again → the picker', async () => {
    const view = await mount();
    fireEvent.click(view.getByText('guest'));
    expect(view.getByTestId('overlay').textContent).toBe('guest');

    back();
    expect(view.getByTestId('overlay').textContent).toBe('none');
    expect(H.replace).not.toHaveBeenCalled();
    expect(H.back).not.toHaveBeenCalled();

    back();
    expect(H.replace).toHaveBeenCalledWith('/door');
  });

  it('add sheet open → back closes it, no navigation', async () => {
    const view = await mount();
    fireEvent.click(view.getByText('add'));
    back();
    expect(view.getByTestId('overlay').textContent).toBe('none');
    expect(H.replace).not.toHaveBeenCalled();
  });

  it('offline: back still closes the sheet, then does nothing (door stays up, #25)', async () => {
    setOnline(false);
    const view = await mount();
    fireEvent.click(view.getByText('guest'));
    back();
    expect(view.getByTestId('overlay').textContent).toBe('none');
    back();
    expect(H.replace).not.toHaveBeenCalled();
    expect(H.back).not.toHaveBeenCalled();
    expect(H.minimizeApp).not.toHaveBeenCalled();
  });

  it('closing a sheet never remounts DoorProvider (outbox stays live)', async () => {
    const view = await mount();
    fireEvent.click(view.getByText('guest'));
    back();
    fireEvent.click(view.getByText('add'));
    back();
    expect(H.providerMounts).toBe(1);
    expect(H.providerUnmounts).toBe(0);
  });

  it('on the /door picker, back minimizes', async () => {
    H.pathname = '/door';
    render(<NativeBackButton />);
    await waitFor(() => expect(H.listener).not.toBeNull());
    back();
    expect(H.minimizeApp).toHaveBeenCalledTimes(1);
  });
});
