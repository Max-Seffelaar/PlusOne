// @vitest-environment jsdom
//
// N1 leftover (86ey6bfam webview-prep follow-up): same external-link fix as
// ConsentScreen — the consent links (since z8uq9m2vg5: the DPA link) were bare `<a target="_blank">`,
// which Capacitor's remote-URL webview loads INSIDE itself with no way back
// (#37). They now go through the kit's `ExternalLink`, mirroring the pattern
// `onboarding.tsx`'s VenueCreate already used from PR #331. The links sit
// inside the `<label>` that wraps the consent checkbox, so a click on either
// link must not also toggle that checkbox.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DPA_URL } from '@/lib/legal';

vi.mock('@/features/venues/actions', () => ({
  createVenueAction: vi.fn(async () => ({ ok: true, venueId: '018f3a2e-0000-7000-8000-00000000000e' })),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

const { VenueStep } = await import('./VenueStep');

describe('VenueStep — external links (N1 leftover)', () => {
  it('renders the DPA link via ExternalLink: href kept, no target attribute', () => {
    render(<VenueStep onCreated={vi.fn()} />);

    const dpa = screen.getByRole('link', { name: 'Data Processing Agreement' });

    expect(dpa).toHaveAttribute('href', DPA_URL);
    expect(dpa).not.toHaveAttribute('target');
  });

  it('does not toggle the adjacent consent checkbox when the link is clicked', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<VenueStep onCreated={vi.fn()} />);

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(screen.getByRole('link', { name: 'Data Processing Agreement' }));

    expect(open).toHaveBeenCalledWith(DPA_URL, '_blank', 'noopener,noreferrer');
    expect(checkbox.checked).toBe(false);
  });
});

// One consent per moment (#40, Onboarding A z8uq9m2vg5): Terms + Privacy were
// accepted with the account at /consent; creating a company accepts the DPA
// only, on behalf of the company named in the form.
describe('VenueStep — DPA only', () => {
  it('asks for the DPA on behalf of the typed company, never Terms or Privacy', () => {
    render(<VenueStep onCreated={vi.fn()} />);
    expect(screen.getByText(/on behalf of my company\./)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('e.g. LOFI'), { target: { value: 'Club Vesper' } });
    expect(screen.getByText(/on behalf of Club Vesper\./)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Terms' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Privacy Policy' })).toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });
});
