// @vitest-environment jsdom
/**
 * Platform > Mail log (z8uq9m49k1): a non-platform-admin sees "not available"
 * and fires no read; a platform admin sees the masked address, never the full
 * one, and "Show address" asks for a ticket before anything is revealed.
 */
import '@testing-library/jest-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { t } from '@/lib/i18n';

const H = vi.hoisted(() => ({
  isPlatformAdmin: false,
  logCalls: 0,
  reveal: vi.fn(),
}));

vi.mock('../context', () => ({ useNav: () => ({ push: vi.fn(), back: vi.fn(), canGoBack: false }) }));
vi.mock('@/features/po/hooks', () => ({
  usePoIsPlatformAdmin: () => H.isPlatformAdmin,
  usePoPlatformVenueOptions: () => ({ data: [] }),
}));
vi.mock('@/features/po/platform-mail-log', () => ({
  usePoPlatformMailLog: () => {
    H.logCalls += 1;
    return {
      data: {
        rows: [
          {
            id: 'm1',
            type: 'guest_on_list',
            status: 'bounced',
            errorCode: null,
            isTest: false,
            createdAt: '2026-10-11T10:00:00Z',
            venueId: 'v1',
            venueName: 'Club Vesper',
            eventName: 'Neon Friday',
            recipient: 'l***@e***.com',
          },
        ],
        total: 1,
      },
      isLoading: false,
      isError: false,
    };
  },
  usePoRevealMailRecipient: () => ({ mutate: H.reveal, isPending: false, isSuccess: false, isError: false, data: undefined }),
  usePoSendTestMail: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isSuccess: false, isError: false }),
}));

const { PlatformMailLog } = await import('./platform-mail-log');

afterEach(() => {
  cleanup();
  H.isPlatformAdmin = false;
  H.logCalls = 0;
  H.reveal.mockClear();
});

describe('Platform > Mail log', () => {
  it('shows "not available" and fires no read for a non-platform-admin', () => {
    render(<PlatformMailLog />);
    expect(screen.getByText(t.platform.notAvailable)).toBeInTheDocument();
    expect(H.logCalls).toBe(0);
  });

  it('a platform admin sees type, company, event, status and the masked address', () => {
    H.isPlatformAdmin = true;
    render(<PlatformMailLog />);
    const row = screen.getByTestId('mail-log-row');
    expect(row).toHaveTextContent('guest_on_list');
    expect(row).toHaveTextContent('Club Vesper');
    expect(row).toHaveTextContent('Neon Friday');
    expect(row).toHaveTextContent(t.platform.mailLogStatusBounced);
    expect(screen.getByTestId('mail-log-recipient')).toHaveTextContent('l***@e***.com');
    expect(screen.getByTestId('test-mail')).toBeInTheDocument();
  });

  it('"Show address" needs a ticket before it asks the server', () => {
    H.isPlatformAdmin = true;
    render(<PlatformMailLog />);
    fireEvent.click(screen.getByRole('button', { name: t.platform.mailLogShowAddress }));
    const confirm = screen.getAllByRole('button', { name: t.platform.mailLogRevealConfirm }).at(-1) as HTMLElement;
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(t.platform.mailLogRevealTicket), { target: { value: 'ClickUp 86abc' } });
    fireEvent.click(confirm);
    expect(H.reveal).toHaveBeenCalledWith({ mailLogId: 'm1', ticket: 'ClickUp 86abc' });
  });
});
