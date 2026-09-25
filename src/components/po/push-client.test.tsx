// @vitest-environment jsdom
/**
 * usePushClient + PushAskCard (Fase 17 N5): never ask on first paint, only for
 * roles push v1 delivers to, respect "Not now" and a denial, and route a tap
 * to the right Requests screen (through the chrome's venue switch when needed).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PushMessage } from '@/features/notifications/provider';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => {
  const router = { push: nav.push };
  return { useRouter: () => router };
});
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
const venue = vi.hoisted(() => ({ switch: vi.fn((_id: string, _landing: string) => {}) }));

const p = vi.hoisted(() => ({
  supported: true,
  tap: null as null | ((m: PushMessage) => void),
  fg: null as null | ((m: PushMessage) => void),
}));
vi.mock('@/features/notifications/provider', () => ({
  getNotificationProvider: () => ({
    isSupported: () => p.supported,
    onRegistration: () => () => {},
    onTap: (cb: (m: PushMessage) => void) => ((p.tap = cb), () => (p.tap = null)),
    onForeground: (cb: (m: PushMessage) => void) => ((p.fg = cb), () => (p.fg = null)),
  }),
}));
const pc = vi.hoisted(() => ({
  perm: 'default' as string,
  undecided: true,
  snoozed: false,
  enableResult: 'granted' as string,
  snooze: vi.fn(),
  enable: vi.fn(),
  resume: vi.fn(),
}));
vi.mock('@/features/notifications/push-client', () => ({
  resumePush: pc.resume,
  enablePush: pc.enable,
  isPushUndecided: () => pc.undecided,
  isPushPromptSnoozed: () => pc.snoozed,
  snoozePushPrompt: pc.snooze,
  savePushToken: vi.fn(async () => true),
}));

import { ASK_DELAY_MS, PushAskCard, usePushClient } from './push-client';
import { t } from '@/lib/i18n';

const V = '0190f0b2-7c1a-7cc3-9a61-2b3c4d5e6f70';
const V2 = '0190f0b2-7c1a-7cc3-9a61-2b3c4d5e6f7a';
const E = '0190f0b2-7c1a-7cc3-9a61-2b3c4d5e6f71';

const toast = vi.fn();
function Harness({ canReceive = true }: { canReceive?: boolean }) {
  const ask = usePushClient({ canReceive, activeVenueId: V, switchToVenue: venue.switch, onToast: toast });
  return <PushAskCard ask={ask} />;
}

async function mountAndWait(props: { canReceive?: boolean } = {}, ms = ASK_DELAY_MS + 1) {
  render(<Harness {...props} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  p.supported = true;
  pc.perm = 'default';
  pc.undecided = true;
  pc.snoozed = false;
  pc.enableResult = 'granted';
  pc.resume.mockImplementation(async () => pc.perm);
  pc.enable.mockImplementation(async () => pc.enableResult);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('the ask', () => {
  it('is not shown on first paint, only after the delay', async () => {
    await mountAndWait({}, ASK_DELAY_MS - 100);
    expect(screen.queryByText(t.push.askTitle)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.getByText(t.push.askTitle)).toBeTruthy();
    expect(pc.enable).not.toHaveBeenCalled(); // no OS prompt until the user says so
  });

  it('is shown on Android ≤12 too, where the OS grants from install: the card is the consent step', async () => {
    pc.perm = 'granted';
    await mountAndWait();
    expect(screen.getByText(t.push.askTitle)).toBeTruthy();
  });

  it.each([
    ['denied before', () => (pc.perm = 'denied')],
    ['unsupported build', () => (pc.perm = 'unsupported')],
    ['already decided on this device (on, off, or declined)', () => (pc.undecided = false)],
    ['snoozed', () => (pc.snoozed = true)],
  ])('is never shown when %s', async (_l, setup) => {
    setup();
    await mountAndWait();
    expect(screen.queryByText(t.push.askTitle)).toBeNull();
  });

  it('is never shown to a role push v1 does not deliver to', async () => {
    await mountAndWait({ canReceive: false });
    expect(screen.queryByText(t.push.askTitle)).toBeNull();
  });

  it('does nothing at all on the web', async () => {
    p.supported = false;
    await mountAndWait();
    expect(pc.resume).not.toHaveBeenCalled();
    expect(p.tap).toBeNull();
    expect(screen.queryByText(t.push.askTitle)).toBeNull();
  });

  it('"Not now" snoozes and hides it', async () => {
    await mountAndWait();
    fireEvent.click(screen.getByText(t.push.askLater));
    expect(pc.snooze).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(t.push.askTitle)).toBeNull();
  });

  it('"Turn on" → granted hides it quietly', async () => {
    await mountAndWait();
    await act(async () => {
      fireEvent.click(screen.getByText(t.push.askEnable));
    });
    expect(pc.enable).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(t.push.askTitle)).toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });

  it.each(['denied', 'default'])('"Turn on" → %s is respected: card gone, snoozed on top of enablePush\'s record, a toast points at Profile', async (result) => {
    // 'default' = Android 13+ after a first "Don't allow" (prompt-with-rationale).
    pc.enableResult = result;
    await mountAndWait();
    await act(async () => {
      fireEvent.click(screen.getByText(t.push.askEnable));
    });
    expect(screen.queryByText(t.push.askTitle)).toBeNull();
    expect(pc.snooze).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(t.push.deniedToast);
  });

  it('first denial → the next launch does not bring the card back', async () => {
    pc.enableResult = 'default';
    await mountAndWait();
    await act(async () => {
      fireEvent.click(screen.getByText(t.push.askEnable));
    });
    cleanup();
    // What enablePush recorded: no longer undecided (and snoozed on top).
    pc.undecided = false;
    pc.snoozed = true;
    await mountAndWait();
    expect(screen.queryByText(t.push.askTitle)).toBeNull();
  });
});

describe('taps and foreground receipts', () => {
  it('a tap opens the event\'s quota queue in the active venue', async () => {
    await mountAndWait({}, 0);
    act(() => p.tap!({ data: { kind: 'quota_request_created', venue_id: V, event_id: E } }));
    expect(nav.push).toHaveBeenCalledWith(`/app/requests/quota?event=${E}`);
    expect(venue.switch).not.toHaveBeenCalled();
  });

  it('a tap for another venue goes through the chrome\'s venue switch, landing on the target', async () => {
    await mountAndWait({}, 0);
    await act(async () => {
      p.tap!({ data: { kind: 'guest_request_created', venue_id: V2, event_id: E } });
    });
    expect(venue.switch).toHaveBeenCalledWith(V2, `/app/requests?event=${E}`);
    // No navigation of its own: a refused switch must stay put (switchToVenue toasts).
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('a malformed tap payload navigates nowhere', async () => {
    await mountAndWait({}, 0);
    act(() => p.tap!({ data: { kind: 'guest_request_created', venue_id: V, event_id: '../platform' } }));
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('a foreground push becomes an in-app toast from our own copy', async () => {
    await mountAndWait({}, 0);
    act(() => p.fg!({ data: { kind: 'quota_request_decided', venue_id: V, event_id: E, status: 'approved' } }));
    expect(toast).toHaveBeenCalledWith(t.push.foreground.quota_request_decided);
  });
});
