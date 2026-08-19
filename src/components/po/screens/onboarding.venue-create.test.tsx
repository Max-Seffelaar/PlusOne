// @vitest-environment jsdom
/**
 * Venue-create switch handling (86eykm7rk, round 2).
 *
 * `VenueCreate` is the second caller of the three-state switch contract, and it
 * answers differently from the po shell's `switchToVenue`: `setError` + early
 * return, no toast and no reload. Round-1 review landed that branch with no
 * coverage at all, so nothing went red if it were deleted or inverted — while
 * its `app.tsx` twin had four tests. These are those four, for this caller.
 *
 * The message matters as much as the branch here. The venue DOES exist by the
 * time the switch is refused (`createVenueAction` already returned `ok`), so
 * reusing `venue.switchFailed` ("you no longer have access to that venue")
 * would state the opposite of the truth to someone who just became its Admin.
 * The `not.toBe(t.venue.switchFailed)` assertion pins that, not just "some
 * error is shown".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { t } from '@/lib/i18n';

const VENUE_NEW = '018f3a2e-0000-7000-8000-00000000000e';

const H = vi.hoisted(() => ({
  createVenueAction: vi.fn(),
  switchActiveVenueAction: vi.fn(),
}));
const assign = vi.fn();

vi.mock('@/features/venues/actions', () => ({
  createVenueAction: H.createVenueAction,
  switchActiveVenueAction: H.switchActiveVenueAction,
}));
vi.mock('../context', () => ({
  useNav: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const { VenueCreate } = await import('./onboarding');

const vc = t.onboarding.venueCreate;

/** Fill the two required fields + consent, then submit — the real form, so the
 *  test can only reach the switch branch the way a user does. */
async function createVenue(container: HTMLElement): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText(vc.companyNamePlaceholder), {
    target: { value: 'LOFI' },
  });
  const consent = container.querySelector('input[type="checkbox"]');
  if (!consent) throw new Error('consent checkbox not found');
  fireEvent.click(consent);
  await act(async () => {
    fireEvent.click(screen.getByText(vc.submit).closest('button') as HTMLButtonElement);
    await Promise.resolve();
  });
}

beforeEach(() => {
  H.createVenueAction.mockReset();
  H.switchActiveVenueAction.mockReset();
  assign.mockClear();
  H.createVenueAction.mockResolvedValue({ ok: true, venueId: VENUE_NEW });
  // jsdom's window.location is [LegacyUnforgeable] — spyOn cannot redefine
  // `assign`, but replacing the whole property works (same trick as
  // app.venue-switch.test.tsx).
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { assign, href: 'http://localhost/app', pathname: '/app', search: '', origin: 'http://localhost' },
  });
});

describe('VenueCreate switch handling (86eykm7rk)', () => {
  it('does NOT reload and shows a create-specific error when the switch is denied', async () => {
    H.switchActiveVenueAction.mockResolvedValue('denied');
    const { container } = render(<VenueCreate />);
    await createVenue(container);

    await waitFor(() => expect(H.switchActiveVenueAction).toHaveBeenCalledWith(VENUE_NEW));
    // "Did not navigate" is the load-bearing half: reloading here drops the new
    // owner back on their PREVIOUS venue, as if the create had never happened.
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByText(vc.createdNotOpened)).toBeDefined();
    // Never the revocation string: the venue exists and this user is its Admin.
    expect(screen.queryByText(t.venue.switchFailed)).toBeNull();
    expect(vc.createdNotOpened).not.toBe(t.venue.switchFailed);
  });

  it('reloads onto /app when the switch succeeds', async () => {
    H.switchActiveVenueAction.mockResolvedValue('ok');
    const { container } = render(<VenueCreate />);
    await createVenue(container);

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/app'));
    expect(screen.queryByText(vc.createdNotOpened)).toBeNull();
  });

  it('still reloads on an expired session, so middleware can route to /login', async () => {
    // Same reasoning as the shell: /login is where that user belongs, and an
    // error box on a screen they cannot use would be a dead end.
    H.switchActiveVenueAction.mockResolvedValue('unauthenticated');
    const { container } = render(<VenueCreate />);
    await createVenue(container);

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/app'));
    expect(screen.queryByText(vc.createdNotOpened)).toBeNull();
  });

  it('does not reload when the create itself failed, and never calls the switch', async () => {
    H.createVenueAction.mockResolvedValue({ ok: false, error: 'invalid_input', message: 'Nope.' });
    const { container } = render(<VenueCreate />);
    await createVenue(container);

    await waitFor(() => expect(screen.getByText('Nope.')).toBeDefined());
    expect(H.switchActiveVenueAction).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});
