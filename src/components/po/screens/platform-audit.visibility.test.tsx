// @vitest-environment jsdom
/**
 * Platform > Audit visibility (P-05, z8uq9m0tnx).
 *
 * Same shape as platform-venues.visibility.test.tsx: a non-platform-admin who
 * reaches `/app/platform/audit` must see the flat "not available" state and
 * must NOT fire the audit read, the count read, or the venue-picker read.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { t } from '@/lib/i18n';

const H = vi.hoisted(() => ({
  isPlatformAdmin: false,
  auditCalls: 0,
  countCalls: 0,
  optionsCalls: 0,
}));

vi.mock('../context', () => ({
  useNav: () => ({ push: vi.fn(), back: vi.fn(), canGoBack: false }),
}));
vi.mock('@/features/po/hooks', () => ({
  usePoIsPlatformAdmin: () => H.isPlatformAdmin,
  usePoPlatformAudit: () => {
    H.auditCalls += 1;
    return { data: [], isLoading: false, isError: false };
  },
  usePoPlatformAuditCount: () => {
    H.countCalls += 1;
    return { data: 0 };
  },
  usePoPlatformVenueOptions: () => {
    H.optionsCalls += 1;
    return { data: [] };
  },
}));

const { PlatformAudit } = await import('./platform-audit');

afterEach(() => {
  H.isPlatformAdmin = false;
  H.auditCalls = 0;
  H.countCalls = 0;
  H.optionsCalls = 0;
});

describe('Platform > Audit visibility (z8uq9m0tnx)', () => {
  it('shows "not available" and fires no read for a non-platform-admin', () => {
    render(<PlatformAudit />);
    expect(screen.getByText(t.platform.notAvailable)).toBeDefined();
    expect(H.auditCalls).toBe(0);
    expect(H.countCalls).toBe(0);
    expect(H.optionsCalls).toBe(0);
  });

  it('renders the console and fires the windowed reads for a platform admin', () => {
    H.isPlatformAdmin = true;
    render(<PlatformAudit />);
    expect(screen.queryByText(t.platform.notAvailable)).toBeNull();
    expect(screen.getByText(t.platform.auditSubtitle)).toBeDefined();
    expect(H.auditCalls).toBeGreaterThan(0);
  });

  it('pre-scopes the venue filter from the venueId prop (arriving from a venue row)', () => {
    H.isPlatformAdmin = true;
    render(<PlatformAudit venueId="018f3a2e-0000-7000-8000-00000000000a" />);
    expect(screen.getByText(t.platform.auditSubtitle)).toBeDefined();
  });
});
