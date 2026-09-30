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
  /** The account choice resumePush read (user_metadata.push_opt_in). */
  account: null as null | boolean,
  undecided: true,
  snoozed: false,
  enableResult: 'granted' as string,
  registered: true,
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

import { ASK_DELAY_MS, PushAskCard, canReceivePush, usePushClient } from './push-client';
import { t } from '@/lib/i18n';

const V = '0190f0b2-7c1a-7cc3-9a61-2b3c4d5e6f70';
const V2 = '0190f0b2-7c1a-7cc3-9a61-2b3c4d5e6f7a';
const E = '0190f0b2-7c1a-7cc3-9a61-2b3c4d5e6f71';

const toast = vi.fn();
function Harness({ canReceive = true, onDoor = false }: { canReceive?: boolean; onDoor?: boolean }) {
  const ask = usePushClient({ canReceive, onDoor, activeVenueId: V, switchToVenue: venue.switch, onToast: toast });
  return <PushAskCard ask={ask} />;
}

/** The ask resumePush derives (mirrors the real one; its own unit tests pin it). */
function resumeAsk(): string | null {
  if (!pc.undecided || pc.account === false) return null;
  if (pc.account === true) return pc.perm === 'default' ? 'os-prompt' : null;
  return pc.perm === 'default' || pc.perm === 'granted' ? 'card' : null;
}

async function mountAndWait(props: { canReceive?: boolean; onDoor?: boolean } = {}, ms = ASK_DELAY_MS + 1) {
  const view = render(<Harness {...props} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  p.supported = true;
  pc.perm = 'default';
  pc.account = null;
  pc.undecided = true;
  pc.snoozed = false;
  pc.enableResult = 'granted';
  pc.registered = true;
  pc.resume.mockImplementation(async () => ({ perm: pc.perm, ask: resumeAsk() }));
  pc.enable.mockImplementation(async () => ({ perm: pc.enableResult, registered: pc.enableResult === 'granted' && pc.registered }));
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

describe('the account choice (86ey6bfkb): remembered across logins', () => {
  it('opted in + OS granted → registered silently by resumePush: no card, no prompt', async () => {
    pc.account = true;
    pc.perm = 'granted';
    await mountAndWait({}, ASK_DELAY_MS * 3);
    expect(pc.resume).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(t.push.askTitle)).toBeNull();
    expect(pc.enable).not.toHaveBeenCalled();
  });

  it('opted in + OS prompt (a new device) → the OS prompt once after the delay, no explain card', async () => {
    pc.account = true;
    pc.perm = 'default';
    await mountAndWait({}, ASK_DELAY_MS - 100);
    expect(pc.enable).not.toHaveBeenCalled(); // never at launch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(pc.enable).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(t.push.askTitle)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ASK_DELAY_MS * 3);
    });
    expect(pc.enable).toHaveBeenCalledTimes(1); // once
  });

  it('opted in + OS prompt waits while the Deur tab is open, then asks once the person leaves it', async () => {
    pc.account = true;
    const view = await mountAndWait({ onDoor: true }, ASK_DELAY_MS * 2);
    expect(pc.enable).not.toHaveBeenCalled();
    await act(async () => {
      view.rerender(<Harness onDoor={false} />);
    });
    expect(pc.enable).toHaveBeenCalledTimes(1);
  });

  it('opted in + OS prompt is never shown to a role push v1 does not deliver to', async () => {
    pc.account = true;
    await mountAndWait({ canReceive: false });
    expect(pc.enable).not.toHaveBeenCalled();
  });

  it('opted in + OS prompt denied → the usual denial handling (toast to Profile), no card', async () => {
    pc.account = true;
    pc.enableResult = 'denied';
    await mountAndWait();
    expect(pc.enable).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(t.push.deniedToast);
    expect(screen.queryByText(t.push.askTitle)).toBeNull();
  });

  it('opted out → never the card, never a prompt', async () => {
    pc.account = false;
    await mountAndWait({}, ASK_DELAY_MS * 3);
    expect(screen.queryByText(t.push.askTitle)).toBeNull();
    expect(pc.enable).not.toHaveBeenCalled();
  });

  it('undecided account → the explain-first card, as before', async () => {
    await mountAndWait();
    expect(screen.getByText(t.push.askTitle)).toBeTruthy();
    expect(pc.enable).not.toHaveBeenCalled();
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

describe('re-review nits', () => {
  it('"Turn on" granted but not stored yet → the card goes, and a toast says it finishes later', async () => {
    pc.registered = false;
    await mountAndWait();
    await act(async () => {
      fireEvent.click(screen.getByText(t.push.askEnable));
    });
    expect(screen.queryByText(t.push.askTitle)).toBeNull();
    expect(toast).toHaveBeenCalledWith(t.push.onPending);
    expect(pc.snooze).not.toHaveBeenCalled();
  });

  it('canReceivePush: admins, staff and organizers only (one gate for the card and the Profile row)', () => {
    expect(canReceivePush(['admin'], false)).toBe(true);
    expect(canReceivePush(['staff'], false)).toBe(true);
    expect(canReceivePush(['doorhost'], true)).toBe(true);
    expect(canReceivePush(['doorhost'], false)).toBe(false);
    expect(canReceivePush(['finance'], false)).toBe(false);
    expect(canReceivePush(['user_manager'], false)).toBe(false);
  });
});
