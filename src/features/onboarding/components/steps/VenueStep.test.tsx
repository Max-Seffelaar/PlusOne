// @vitest-environment jsdom
//
// N1 leftover (86ey6bfam webview-prep follow-up): same external-link fix as
// ConsentScreen — the terms/privacy links were bare `<a target="_blank">`,
// which Capacitor's remote-URL webview loads INSIDE itself with no way back
// (#37). They now go through the kit's `ExternalLink`, mirroring the pattern
// `onboarding.tsx`'s VenueCreate already used from PR #331. The links sit
// inside the `<label>` that wraps the consent checkbox, so a click on either
// link must not also toggle that checkbox.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TERMS_URL, PRIVACY_URL } from '@/lib/legal';

vi.mock('@/features/venues/actions', () => ({
  createVenueAction: vi.fn(async () => ({ ok: true, venueId: '018f3a2e-0000-7000-8000-00000000000e' })),
}));

const { VenueStep } = await import('./VenueStep');

describe('VenueStep — external links (N1 leftover)', () => {
  it('renders the terms/privacy links via ExternalLink: href kept, no target attribute', () => {
    render(<VenueStep onCreated={vi.fn()} />);

    const terms = screen.getByRole('link', { name: 'Terms' });
    const privacy = screen.getByRole('link', { name: 'Privacy Policy' });

    expect(terms).toHaveAttribute('href', TERMS_URL);
    expect(terms).not.toHaveAttribute('target');
    expect(privacy).toHaveAttribute('href', PRIVACY_URL);
    expect(privacy).not.toHaveAttribute('target');
  });

  it('does not toggle the adjacent consent checkbox when a link is clicked', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<VenueStep onCreated={vi.fn()} />);

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(screen.getByRole('link', { name: 'Terms' }));

    expect(open).toHaveBeenCalledWith(TERMS_URL, '_blank', 'noopener,noreferrer');
    expect(checkbox.checked).toBe(false);
  });
});
