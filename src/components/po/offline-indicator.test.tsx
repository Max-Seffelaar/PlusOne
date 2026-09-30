// @vitest-environment jsdom
/**
 * Quiet offline indicator (N7 follow-up): blip → nothing; ≥3 s → chip; ~4 s →
 * the once-per-episode hint; back online → gone and the episode resets.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { t } from '@/lib/i18n';
import {
  OFFLINE_CHIP_AFTER_MS,
  OFFLINE_HINT_AFTER_MS,
  OFFLINE_HINT_OFF_KEY,
  OfflineIndicator,
} from './offline-indicator';

let online = true;

function goOffline(): void {
  online = false;
  act(() => {
    window.dispatchEvent(new Event('offline'));
  });
}
function goOnline(): void {
  online = true;
  act(() => {
    window.dispatchEvent(new Event('online'));
  });
}
function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const chip = () => screen.queryByRole('button', { name: t.shared.offline.chipAria });
const hint = () => screen.queryByRole('button', { name: t.shared.offline.dontShowAgain });

beforeEach(() => {
  vi.useFakeTimers();
  online = true;
  vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => online);
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('OfflineIndicator', () => {
  it('(a) a blip under 3 s shows nothing', () => {
    const view = render(<OfflineIndicator surface="app" />);
    goOffline();
    advance(OFFLINE_CHIP_AFTER_MS - 1);
    goOnline();
    advance(10_000);
    expect(view.container.innerHTML).toBe('');
  });

  it('(b) after 3 s offline the chip appears and opens the explanation', () => {
    render(<OfflineIndicator surface="app" />);
    goOffline();
    advance(OFFLINE_CHIP_AFTER_MS - 1);
    expect(chip()).toBeNull();
    advance(1);
    expect(chip()).not.toBeNull();
    expect(chip()!.closest('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
    expect(hint()).toBeNull();

    fireEvent.click(chip()!);
    expect(screen.getByText(t.shared.offline.body)).toBeTruthy();
  });

  it('(b) starts an episode for a device that mounts already offline', () => {
    online = false;
    render(<OfflineIndicator surface="app" />);
    advance(OFFLINE_CHIP_AFTER_MS);
    expect(chip()).not.toBeNull();
  });

  it('(c) the hint shows once per episode at ~4 s, "Got it" closes it and the chip stays', () => {
    render(<OfflineIndicator surface="app" />);
    goOffline();
    advance(OFFLINE_HINT_AFTER_MS);
    expect(hint()).not.toBeNull();
    expect(screen.getAllByText(t.shared.offline.body)).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: t.shared.offline.gotIt }));
    expect(hint()).toBeNull();
    expect(chip()).not.toBeNull();

    // Still the same episode: no second hint, however long it lasts.
    advance(60_000);
    expect(hint()).toBeNull();
    expect(window.localStorage.getItem(OFFLINE_HINT_OFF_KEY)).toBeNull();

    // A new episode brings it back.
    goOnline();
    goOffline();
    advance(OFFLINE_HINT_AFTER_MS);
    expect(hint()).not.toBeNull();
  });

  it('(c) "Don\'t show again" is remembered on the device; the chip still explains', () => {
    const first = render(<OfflineIndicator surface="app" />);
    goOffline();
    advance(OFFLINE_HINT_AFTER_MS);
    fireEvent.click(hint()!);
    expect(hint()).toBeNull();
    expect(window.localStorage.getItem(OFFLINE_HINT_OFF_KEY)).toBe('1');
    goOnline();
    first.unmount();

    // A fresh mount (reload) and a new episode: no hint, chip works.
    render(<OfflineIndicator surface="app" />);
    goOffline();
    advance(OFFLINE_HINT_AFTER_MS + 5000);
    expect(hint()).toBeNull();
    expect(chip()).not.toBeNull();
    fireEvent.click(chip()!);
    expect(screen.getByText(t.shared.offline.body)).toBeTruthy();
  });

  it('(c) renders and dismisses normally when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    render(<OfflineIndicator surface="app" />);
    goOffline();
    advance(OFFLINE_HINT_AFTER_MS);
    expect(hint()).not.toBeNull();
    expect(() => fireEvent.click(hint()!)).not.toThrow();
    expect(hint()).toBeNull();
    expect(chip()).not.toBeNull();
  });

  it('(d) back online clears the chip, the hint and an open explanation', () => {
    const view = render(<OfflineIndicator surface="app" />);
    goOffline();
    advance(OFFLINE_HINT_AFTER_MS);
    fireEvent.click(chip()!);
    expect(hint()).not.toBeNull();
    goOnline();
    expect(view.container.innerHTML).toBe('');
    expect(screen.queryByText(t.shared.offline.body)).toBeNull();

    // The episode reset: the next one waits the full 3 s again.
    goOffline();
    advance(OFFLINE_CHIP_AFTER_MS - 1);
    expect(chip()).toBeNull();
    advance(1);
    expect(chip()).not.toBeNull();
  });

  it('on the Deur tab: no chip beside the sync bar, the hint explains the queue', () => {
    render(<OfflineIndicator surface="door" />);
    goOffline();
    advance(OFFLINE_HINT_AFTER_MS);
    expect(chip()).toBeNull();
    // jsdom has no fine pointer → the outbox door.
    expect(screen.getByText(t.shared.offline.bodyDoor)).toBeTruthy();
    expect(screen.queryByText(t.shared.offline.body)).toBeNull();
  });

  it('renders nothing under SSR and survives a missing navigator', () => {
    expect(renderToString(<OfflineIndicator surface="app" />)).toBe('');

    vi.restoreAllMocks();
    vi.stubGlobal('navigator', undefined);
    try {
      const view = render(<OfflineIndicator surface="app" />);
      advance(10_000);
      expect(view.container.innerHTML).toBe('');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
