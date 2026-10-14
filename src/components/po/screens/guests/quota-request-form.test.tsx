// @vitest-environment jsdom
/**
 * "Request more spots" without a guest (z8uq9m5kux, Max's retest 2026-10-14):
 * after a send, the next request starts with an empty motivation, and the
 * entry only shows for someone with a personal quota who can add guests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { t } from '@/lib/i18n';

const H = vi.hoisted(() => ({
  quota: { quota: 12, consumed: 8, remaining: 4, exempt: false } as null | { quota: number; consumed: number; remaining: number | null; exempt: boolean },
  roles: ['staff'] as string[],
  mutate: vi.fn(),
}));

vi.mock('@/features/po/hooks', () => ({
  usePoQuota: () => ({ data: H.quota }),
  usePoEventForEdit: () => ({ canManage: false }),
}));
vi.mock('@/features/po/mutations', () => ({
  usePoRequestExtraSlots: () => ({ mutate: H.mutate, isPending: false, isError: false, error: null }),
}));
vi.mock('@/features/po/PoLiveProvider', () => ({ usePoIdentity: () => ({ roles: H.roles }) }));

const { GuestListQuotaBar } = await import('./quota-request-form');

beforeEach(() => {
  H.quota = { quota: 12, consumed: 8, remaining: 4, exempt: false };
  H.roles = ['staff'];
  // A successful send: the action resolves and calls onSuccess.
  H.mutate.mockReset().mockImplementation((_input: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.());
});

const motivationField = (): HTMLTextAreaElement =>
  screen.getByPlaceholderText(t.guests.add.requestMotivPlaceholder) as HTMLTextAreaElement;

describe('GuestListQuotaBar', () => {
  it('send → reopen: the motivation is empty again', () => {
    render(<GuestListQuotaBar eventId="e1" />);
    fireEvent.click(screen.getByText(t.guests.add.requestMoreSpots));
    fireEvent.change(motivationField(), { target: { value: 'dsadada' } });
    fireEvent.click(screen.getByText(t.guests.add.send));

    expect(H.mutate).toHaveBeenCalledWith({ eventId: 'e1', requestedExtra: 1, motivation: 'dsadada' }, expect.anything());
    expect(screen.getByTestId('quota-request-sent')).toBeTruthy();

    fireEvent.click(screen.getByText(t.guests.add.requestMoreSpots));
    expect(motivationField().value).toBe('');
  });

  it('cancel → reopen: empty too', () => {
    render(<GuestListQuotaBar eventId="e1" />);
    fireEvent.click(screen.getByText(t.guests.add.requestMoreSpots));
    fireEvent.change(motivationField(), { target: { value: 'half typed' } });
    fireEvent.click(screen.getByText(t.guests.add.cancel));
    fireEvent.click(screen.getByText(t.guests.add.requestMoreSpots));
    expect(motivationField().value).toBe('');
  });

  it('not for a quota-exempt role, nor for a role that cannot add guests', () => {
    H.quota = { quota: 0, consumed: 0, remaining: null, exempt: true };
    const { unmount } = render(<GuestListQuotaBar eventId="e1" />);
    expect(screen.queryByText(t.guests.add.requestMoreSpots)).toBeNull();
    unmount();

    H.quota = { quota: 12, consumed: 8, remaining: 4, exempt: false };
    H.roles = ['finance'];
    render(<GuestListQuotaBar eventId="e1" />);
    expect(screen.queryByText(t.guests.add.requestMoreSpots)).toBeNull();
  });
});
