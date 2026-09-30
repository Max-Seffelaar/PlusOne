// @vitest-environment jsdom
/**
 * usePushClient + PushAskCard (Fase 17 N5): never ask on first paint, only for
 * roles push v1 delivers to, respect "Not now" and a denial, and route a tap
 * to the right Requests screen (through the chrome's venue switch when needed).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PushMessage } from '@/features/notifications/provider';

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => {
  const router = { push: nav.push, replace: nav.replace };
  return { useRouter: () => router };
});
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
const venue = vi.hoisted(() => ({ switch: vi.fn((_id: string, _landing: string) => {}) }));

const p = vi.hoisted(() => ({
  supported: true,
  tap: null as null | ((m: PushMessage) => void),
  fg: null as null | ((m: PushMessage) => void),
  /** What the cold-start launch read answers (default: no launch tap). */
  launch: (async () => null) as () => Promise<PushMessage | null>,
}));
vi.mock('@/features/notifications/provider', () => ({
  getNotificationProvider: () => ({
    isSupported: () => p.supported,
    onRegistration: () => () => {},
    onTap: (cb: (m: PushMessage) => void) => ((p.tap = cb), () => (p.tap = null)),
    onForeground: (cb: (m: PushMessage) => void) => ((p.fg = cb), () => (p.fg = null)),
    takeLaunchTap: () => p.launch(),
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

import {
  ASK_DELAY_MS,
  LAUNCH_GATE_MS,
  PUSH_NOTICE_MS,
  PushAskCard,
  PushNoticeToast,
  PushOpening,
  __resetPushLaunchForTests,
  canReceivePush,
  usePushClient,
} from './push-client';
import { t } from '@/lib/i18n';

const V = '0190f0b2-7c1a-7cc3-9a61-2b3c4d5e6f70';
const V2 = '0190f0b2-7c1a-7cc3-9a61-2b3c4d5e6f7a';
const E = '0190f0b2-7c1a-7cc3-9a61-2b3c4d5e6f71';

const toast = vi.fn();
const HOME = 'Home screen';
/** Mirrors the chrome: the screen slot (gated by `opening`), then notice → ask card. */
function Harness({
  canReceive = true,
  onDoor = false,
  locationKey = '/app?',
}: {
  canReceive?: boolean;
  onDoor?: boolean;
  locationKey?: string;
}) {
  const push = usePushClient({ canReceive, onDoor, activeVenueId: V, switchToVenue: venue.switch, onToast: toast, locationKey });
  return (
    <>
      {push.opening ? <PushOpening /> : <div>{HOME}</div>}
      {push.notice ? <PushNoticeToast notice={push.notice} /> : <PushAskCard ask={push.ask} />}
    </>
  );
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
  __resetPushLaunchForTests();
  window.history.replaceState(null, '', '/app');
  p.supported = true;
  p.launch = async () => null;
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
  it('a tap opens the event\'s quota queue in the active venue — replace, so Back does not return to a screen never chosen', async () => {
    await mountAndWait({}, 0);
    act(() => p.tap!({ data: { kind: 'quota_request_created', venue_id: V, event_id: E } }));
    expect(nav.replace).toHaveBeenCalledWith(`/app/requests/quota?event=${E}`);
    expect(nav.push).not.toHaveBeenCalled();
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
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('a malformed tap payload navigates nowhere', async () => {
    await mountAndWait({}, 0);
    act(() => p.tap!({ data: { kind: 'guest_request_created', venue_id: V, event_id: '../platform' } }));
    expect(nav.push).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('a foreground push becomes an in-app notice from our own copy', async () => {
    await mountAndWait({}, 0);
    act(() => p.fg!({ data: { kind: 'quota_request_decided', venue_id: V, event_id: E, status: 'approved' } }));
    expect(screen.getByText(t.push.foreground.quota_request_decided)).toBeTruthy();
  });
});

describe('the foreground notice (Bug 6)', () => {
  const fg = (venueId = V) => act(() => p.fg!({ data: { kind: 'quota_request_created', venue_id: venueId, event_id: E } }));

  it('tapping the message opens the target and closes the notice', async () => {
    await mountAndWait({}, 0);
    fg();
    fireEvent.click(screen.getByText(t.push.foreground.quota_request_created));
    expect(nav.replace).toHaveBeenCalledWith(`/app/requests/quota?event=${E}`);
    expect(screen.queryByText(t.push.foreground.quota_request_created)).toBeNull();
  });

  it('"View" opens the target too', async () => {
    await mountAndWait({}, 0);
    fg();
    fireEvent.click(screen.getByText(t.push.foregroundView));
    expect(nav.replace).toHaveBeenCalledWith(`/app/requests/quota?event=${E}`);
  });

  it('for another venue it goes through the venue switch, like a tap', async () => {
    await mountAndWait({}, 0);
    fg(V2);
    fireEvent.click(screen.getByText(t.push.foregroundView));
    expect(venue.switch).toHaveBeenCalledWith(V2, `/app/requests/quota?event=${E}`);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('× dismisses it without navigating', async () => {
    await mountAndWait({}, 0);
    fg();
    fireEvent.click(screen.getByRole('button', { name: t.shared.kit.dismiss }));
    expect(screen.queryByText(t.push.foreground.quota_request_created)).toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('hides by itself after PUSH_NOTICE_MS', async () => {
    await mountAndWait({}, 0);
    fg();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PUSH_NOTICE_MS - 100);
    });
    expect(screen.getByText(t.push.foreground.quota_request_created)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.queryByText(t.push.foreground.quota_request_created)).toBeNull();
  });

  it('every control is a ≥44px target', async () => {
    await mountAndWait({}, 0);
    fg();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3); // message, View, ×
    for (const b of buttons) expect(b.className).toMatch(/min-h-\[44px\]|h-\[44px\]/);
  });

  it('a malformed foreground payload shows nothing', async () => {
    await mountAndWait({}, 0);
    act(() => p.fg!({ data: { kind: 'quota_request_created', venue_id: V, event_id: 'nope' } }));
    expect(screen.queryByText(t.push.foregroundView)).toBeNull();
  });
});

describe('cold-start tap (Bug 5): straight to the target, never Home first', () => {
  const launchTap: PushMessage = { id: 'm-1', data: { kind: 'quota_request_created', venue_id: V, event_id: E } };
  const TARGET = `/app/requests/quota?event=${E}`;

  it('shows "Opening…" — not Home — while the launch read is pending, and replaces to the exact target', async () => {
    let answer!: (m: PushMessage | null) => void;
    p.launch = () => new Promise((r) => (answer = r));
    const { rerender } = render(<Harness />);
    expect(screen.getByText(t.push.opening)).toBeTruthy();
    expect(screen.queryByText(HOME)).toBeNull();
    await act(async () => answer(launchTap));
    expect(nav.replace).toHaveBeenCalledWith(TARGET);
    expect(nav.push).not.toHaveBeenCalled();
    // Still gated until the navigation lands…
    expect(screen.queryByText(HOME)).toBeNull();
    // …then the slot opens (in the real app on the target screen).
    rerender(<Harness locationKey={`/app/requests/quota?event=${E}`} />);
    expect(screen.queryByText(t.push.opening)).toBeNull();
    expect(screen.getByText(HOME)).toBeTruthy();
  });

  it('no launch tap → the screen renders right away', async () => {
    render(<Harness />);
    await act(async () => {});
    expect(screen.queryByText(t.push.opening)).toBeNull();
    expect(screen.getByText(HOME)).toBeTruthy();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('the cap releases: a launch read that never answers cannot hang the app', async () => {
    p.launch = () => new Promise(() => undefined);
    render(<Harness />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LAUNCH_GATE_MS - 50);
    });
    expect(screen.getByText(t.push.opening)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(screen.queryByText(t.push.opening)).toBeNull();
    expect(screen.getByText(HOME)).toBeTruthy();
  });

  it('the cap also releases a tap whose navigation never lands', async () => {
    p.launch = async () => launchTap;
    render(<Harness />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LAUNCH_GATE_MS + 1);
    });
    expect(nav.replace).toHaveBeenCalledWith(TARGET);
    expect(screen.getByText(HOME)).toBeTruthy();
  });

  it('a launch tap for another venue goes through switchToVenue, landing on the target', async () => {
    p.launch = async () => ({ id: 'm-2', data: { kind: 'guest_request_created', venue_id: V2, event_id: E } });
    render(<Harness />);
    await act(async () => {});
    expect(venue.switch).toHaveBeenCalledWith(V2, `/app/requests?event=${E}`);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('a malformed launch payload navigates nowhere and releases at once', async () => {
    p.launch = async () => ({ id: 'm-3', data: { kind: 'quota_request_created', venue_id: V, event_id: '../platform' } });
    render(<Harness />);
    await act(async () => {});
    expect(nav.replace).not.toHaveBeenCalled();
    expect(venue.switch).not.toHaveBeenCalled();
    expect(screen.getByText(HOME)).toBeTruthy();
  });

  it('the same tap arriving again as the retained plugin event is opened once', async () => {
    p.launch = async () => launchTap;
    render(<Harness />);
    await act(async () => {});
    act(() => p.tap!(launchTap));
    expect(nav.replace).toHaveBeenCalledTimes(1);
  });

  it('only the first chrome of a page load is gated', async () => {
    render(<Harness />);
    await act(async () => {});
    cleanup();
    p.launch = () => new Promise(() => undefined);
    render(<Harness />);
    expect(screen.queryByText(t.push.opening)).toBeNull();
    expect(screen.getByText(HOME)).toBeTruthy();
  });

  it('never gated on the web', () => {
    p.supported = false;
    render(<Harness />);
    expect(screen.queryByText(t.push.opening)).toBeNull();
    expect(screen.getByText(HOME)).toBeTruthy();
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
