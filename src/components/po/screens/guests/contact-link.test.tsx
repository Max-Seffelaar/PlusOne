// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ContactLinkAmbiguous, ContactLinkOffer } from './contact-link';
import { t } from '@/lib/i18n';

describe('ContactLinkOffer (K2/K3)', () => {
  it('a match is pre-selected and names the contact', () => {
    render(<ContactLinkOffer contactName="Juri Braakman" linked onToggle={() => {}} />);
    expect(screen.getByText(/Juri Braakman/)).toBeTruthy();
    expect(screen.getByRole('button', { pressed: true }).textContent).toBe(t.guests.contactLink.undo);
    cleanup();
  });

  it('one tap undoes the link, and the control offers to put it back', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<ContactLinkOffer contactName="Juri Braakman" linked onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<ContactLinkOffer contactName="Juri Braakman" linked={false} onToggle={onToggle} />);
    expect(screen.getByRole('button', { pressed: false }).textContent).toBe(t.guests.contactLink.redo);
    expect(screen.getByText(t.guests.contactLink.off)).toBeTruthy();
    cleanup();
  });
});

describe('ContactLinkAmbiguous', () => {
  it('says how many contacts share the name and offers no link at all', () => {
    render(<ContactLinkAmbiguous count={2} />);
    expect(screen.getByText('2 contacts with this name')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
  });
});
