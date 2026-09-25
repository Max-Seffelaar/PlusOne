// @vitest-environment jsdom
//
// N1 leftover (86ey6bfam webview-prep follow-up): the terms/privacy links used
// to be bare `<a target="_blank">`, which Capacitor's remote-URL webview loads
// INSIDE itself with no way back (#37). They now go through the kit's
// `ExternalLink`, same as `onboarding.tsx`'s VenueCreate did in PR #331. Two
// things matter here: no `target` attribute survives, and — because the links
// sit inside the `<label>` that wraps the consent checkbox — clicking a link
// must not also toggle the checkbox.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { t } from '@/lib/i18n';
import { TERMS_URL, PRIVACY_URL } from '@/lib/legal';

vi.mock('@/features/auth/consent-actions', () => ({
  acceptTermsAction: vi.fn(async () => ({ ok: true })),
}));

const { ConsentScreen } = await import('./ConsentScreen');

describe('ConsentScreen — external links (N1 leftover)', () => {
  it('renders the terms/privacy links via ExternalLink: href kept, no target attribute', () => {
    render(<ConsentScreen next="/app" email="max@example.com" needsDetails={false} />);

    const terms = screen.getByRole('link', { name: t.auth.consentTerms });
    const privacy = screen.getByRole('link', { name: t.auth.consentPrivacy });

    expect(terms).toHaveAttribute('href', TERMS_URL);
    expect(terms).not.toHaveAttribute('target');
    expect(privacy).toHaveAttribute('href', PRIVACY_URL);
    expect(privacy).not.toHaveAttribute('target');
  });

  it('does not toggle the adjacent consent checkbox when a link is clicked', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<ConsentScreen next="/app" email="max@example.com" needsDetails={false} />);

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(screen.getByRole('link', { name: t.auth.consentTerms }));

    // The click was routed through openExternal, not left to toggle the
    // label's associated checkbox.
    expect(open).toHaveBeenCalledWith(TERMS_URL, '_blank', 'noopener,noreferrer');
    expect(checkbox.checked).toBe(false);
  });
});
