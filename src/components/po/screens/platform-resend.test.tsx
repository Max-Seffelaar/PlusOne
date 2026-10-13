// @vitest-environment jsdom
/**
 * Resend cooldown (z8uq9m5m8h): after a send, and after the per-address "recent"
 * refusal (mail_recipient_window(), PM429), Resend is disabled for the seconds
 * left with a visible countdown; the refusal reads neutral, not error red; a
 * polite live region speaks at most every 10 s. Client-only timing: a fresh
 * mount (= a reload) starts enabled.
 */
import '@testing-library/jest-dom';
import type { JSX } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { t, fmt } from '@/lib/i18n';
import { INVITE_RECENTLY_SENT_MESSAGE } from '@/lib/db-errors';

const H = vi.hoisted(() => ({ send: vi.fn<[string], Promise<{ ok: true; message: string }>>() }));
vi.mock('@/features/po/mutations', () => ({
  usePoResendBetaInvite: () => useMutation({ mutationFn: (id: string) => H.send(id) }),
}));

import { InviteResend, recentWindowEnd, RECIPIENT_WINDOW_MS } from './platform-resend';

const NOW = Date.parse('2026-10-13T12:00:00Z');

function mount(lastSentAt = new Date(NOW - 18_000).toISOString()): void {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  function Wrap(): JSX.Element {
    return (
      <QueryClientProvider client={qc}>
        <InviteResend inviteId="inv-1" lastSentAt={lastSentAt} />
      </QueryClientProvider>
    );
  }
  render(<Wrap />);
}

const button = (): HTMLElement => screen.getByRole('button');
const live = (): HTMLElement => screen.getByTestId('resend-live');
async function click(): Promise<void> {
  await act(async () => {
    fireEvent.click(button());
  });
  // React Query batches its notify on a 0 ms timer: flush it without moving the clock.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}
function tick(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(NOW);
  H.send.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('InviteResend cooldown', () => {
  it('after a send: disabled with "Resend in 60 s", counting down, enabled again at 0', async () => {
    H.send.mockResolvedValue({ ok: true, message: 'Invite sent again.' });
    mount();
    expect(button()).toBeEnabled();
    expect(button()).toHaveTextContent(t.platform.resend);
    await click();
    expect(H.send).toHaveBeenCalledWith('inv-1');
    expect(button()).toBeDisabled();
    expect(button()).toHaveTextContent(fmt(t.platform.resendIn, { seconds: 60 }));
    expect(screen.getByRole('status')).toHaveTextContent('Invite sent again.');
    tick(18_000);
    expect(button()).toHaveTextContent(fmt(t.platform.resendIn, { seconds: 42 }));
    expect(button()).toBeDisabled();
    // A click while waiting sends nothing.
    fireEvent.click(button());
    expect(H.send).toHaveBeenCalledTimes(1);
    tick(42_000);
    expect(button()).toBeEnabled();
    expect(button()).toHaveTextContent(t.platform.resend);
  });

  it('after the "recent" refusal: a neutral status (no red, no alert) and a wait for the rest of the window', async () => {
    H.send.mockRejectedValue(new Error(INVITE_RECENTLY_SENT_MESSAGE));
    mount(new Date(NOW - 18_000).toISOString()); // sent 18 s ago → 42 s left
    await click();
    const note = screen.getByRole('status');
    expect(note).toHaveTextContent(INVITE_RECENTLY_SENT_MESSAGE);
    expect(note).toHaveAttribute('data-tone', 'neutral');
    expect(note.className).toContain('text-dim');
    expect(note.className).not.toContain('text-red-300');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(button()).toBeDisabled();
    expect(button()).toHaveTextContent(fmt(t.platform.resendIn, { seconds: 42 }));
    tick(42_000);
    expect(button()).toBeEnabled();
  });

  it('any other failure stays a red alert and does not start a countdown', async () => {
    H.send.mockRejectedValue(new Error('Too many invite emails just now. Try again in a bit.'));
    mount();
    await click();
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('text-red-300');
    expect(button()).toBeEnabled();
    expect(button()).toHaveTextContent(t.platform.resend);
    expect(live()).toHaveTextContent('');
  });

  it('the live region is polite and changes once per 10 s, then says it is ready', async () => {
    H.send.mockResolvedValue({ ok: true, message: 'Sent.' });
    mount();
    expect(live()).toHaveAttribute('aria-live', 'polite');
    expect(live()).toHaveTextContent('');
    await click();
    const seen: string[] = [live().textContent ?? ''];
    for (let s = 0; s < 60; s++) {
      tick(1000);
      const now = live().textContent ?? '';
      if (now !== seen[seen.length - 1]) seen.push(now);
    }
    expect(seen).toEqual([
      ...[60, 50, 40, 30, 20, 10].map((seconds) => fmt(t.platform.resendWaitLive, { seconds })),
      t.platform.resendReadyLive,
    ]);
  });

  it('a fresh mount (a reload) starts enabled: the server stays the judge', () => {
    mount(new Date(NOW - 1000).toISOString());
    expect(button()).toBeEnabled();
    expect(button()).toHaveTextContent(t.platform.resend);
  });
});

describe('recentWindowEnd', () => {
  it('ends a window after last_sent_at, or a whole window from now when that clue is off', () => {
    expect(recentWindowEnd(new Date(NOW - 18_000).toISOString(), NOW)).toBe(NOW + 42_000);
    expect(recentWindowEnd(new Date(NOW - 90_000).toISOString(), NOW)).toBe(NOW + RECIPIENT_WINDOW_MS);
    expect(recentWindowEnd(new Date(NOW - 59_000).toISOString(), NOW)).toBe(NOW + 1000);
    expect(recentWindowEnd(new Date(NOW + 90_000).toISOString(), NOW)).toBe(NOW + RECIPIENT_WINDOW_MS);
    expect(recentWindowEnd('not a date', NOW)).toBe(NOW + RECIPIENT_WINDOW_MS);
  });
});
