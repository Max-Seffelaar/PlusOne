// @vitest-environment jsdom
/**
 * Platform > Access log visibility (legal v0.3 B3, z8uq9m2hm5).
 *
 * Same shape as platform-audit.visibility.test.tsx: a non-platform-admin who
 * reaches `/app/platform/access` must see the flat "not available" state and
 * must NOT fire the log read or the venue-picker read. RLS is the real
 * boundary; this gate regresses silently if nothing pins it.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { t } from '@/lib/i18n';

const H = vi.hoisted(() => ({
  isPlatformAdmin: false,
  logCalls: [] as Array<{ venueId?: string }>,
  optionsCalls: 0,
}));

vi.mock('../context', () => ({
  useNav: () => ({ push: vi.fn(), back: vi.fn(), canGoBack: false }),
}));
vi.mock('@/features/po/hooks', () => ({
  usePoIsPlatformAdmin: () => H.isPlatformAdmin,
  usePoPlatformAccessLog: (params: { venueId?: string }) => {
    H.logCalls.push(params);
    return {
      data: {
        entries: [
          {
            id: 'l1',
            adminId: 'a1',
            adminName: 'Joeri Platform',
            venueId: 'v1',
            venueName: 'Club Vesper',
            reason: '<b>ticket-42</b>',
            createdAt: '2026-10-05T20:00:00Z',
          },
        ],
        total: 1,
      },
      isLoading: false,
      isError: false,
    };
  },
  usePoPlatformVenueOptions: () => {
    H.optionsCalls += 1;
    return { data: [] };
  },
}));

const { PlatformAccessLog } = await import('./platform-access-log');

afterEach(() => {
  cleanup();
  H.isPlatformAdmin = false;
  H.logCalls = [];
  H.optionsCalls = 0;
});

describe('Platform > Access log visibility (z8uq9m2hm5)', () => {
  it('shows "not available" and fires no read for a non-platform-admin', () => {
    render(<PlatformAccessLog />);
    expect(screen.getByText(t.platform.notAvailable)).toBeDefined();
    expect(H.logCalls).toHaveLength(0);
    expect(H.optionsCalls).toBe(0);
  });

  it('renders the log for a platform admin, reason as plain text', () => {
    H.isPlatformAdmin = true;
    render(<PlatformAccessLog />);
    expect(screen.queryByText(t.platform.notAvailable)).toBeNull();
    expect(screen.getByText(t.platform.accessLogSubtitle)).toBeDefined();
    expect(H.logCalls.length).toBeGreaterThan(0);
    // Rendered once per layout (mobile list + desktop table), never as HTML.
    expect(screen.getAllByText('<b>ticket-42</b>').length).toBeGreaterThan(0);
    expect(document.querySelector('b')).toBeNull();
  });

  it('pre-scopes the venue filter from the venueId prop', () => {
    H.isPlatformAdmin = true;
    render(<PlatformAccessLog venueId="018f3a2e-0000-7000-8000-00000000000a" />);
    expect(H.logCalls[0]?.venueId).toBe('018f3a2e-0000-7000-8000-00000000000a');
  });
});
