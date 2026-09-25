// @vitest-environment jsdom
/**
 * Store-review demo account (86ey6bfug): a deep link to the venue quick-create
 * (/app/venues/new) shows the refusal instead of the form. UX only —
 * createVenueAction and the DB guard still refuse the demo account.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { t } from '@/lib/i18n';

const H = vi.hoisted(() => ({ demo: false, createVenueAction: vi.fn() }));

vi.mock('../app-shell-data', () => ({ useIsDemoAccount: () => H.demo }));
vi.mock('@/features/venues/actions', () => ({ createVenueAction: H.createVenueAction, switchActiveVenueAction: vi.fn() }));
vi.mock('../context', () => ({ useNav: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

const { VenueCreate } = await import('./onboarding');
const vc = t.onboarding.venueCreate;

afterEach(cleanup);

describe('VenueCreate for the demo account', () => {
  it('demo: note only, no form, nothing submitted', () => {
    H.demo = true;
    render(<VenueCreate />);
    expect(screen.getByText(t.auth.demoNoVenues)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(vc.companyNamePlaceholder)).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(vc.submit) })).toBeNull();
    expect(H.createVenueAction).not.toHaveBeenCalled();
  });

  it('admin: the form renders as before', () => {
    H.demo = false;
    render(<VenueCreate />);
    expect(screen.queryByText(t.auth.demoNoVenues)).toBeNull();
    expect(screen.getByPlaceholderText(vc.companyNamePlaceholder)).toBeInTheDocument();
  });
});
