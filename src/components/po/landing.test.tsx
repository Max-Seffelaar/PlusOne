// @vitest-environment jsdom
//
// Coverage for 86eyd3men: the public request form's inline validation-UX.
// The phone field is lazy-loaded (phone-lazy.tsx, #B4/86ey9e8z5) via
// next/dynamic — none of these cases touch it, so it's mocked out to keep the
// test hermetic and to avoid pulling the heavy libphonenumber chunk into a
// unit test.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('./phone-lazy', () => ({
  CountrySelect: () => null,
  PhoneInput: () => null,
  isPhoneValid: vi.fn(async () => true),
}));

import { LandingForm, type LandingEvent, type SubmitResult } from './landing';

const EVENT: LandingEvent = { name: 'Frenzy', date: 'Sat 12 Jul', time: '23:00' };

afterEach(() => {
  vi.clearAllMocks();
});

function fillName(value: string): void {
  fireEvent.change(screen.getByPlaceholderText('First and last name'), { target: { value } });
}

function submitBtn(): HTMLElement {
  return screen.getByRole('button', { name: /request my spot/i });
}

// The error text sits in a nested <span>; walk up to the `role="alert"`
// wrapper to check its styling (and to make sure it really is announced as
// an alert, not just red text).
function alertWrapperFor(text: RegExp): HTMLElement {
  const node = screen.getByText(text);
  const wrapper = node.closest('[role="alert"]');
  if (!wrapper) throw new Error(`No role="alert" ancestor for text matching ${text}`);
  return wrapper as HTMLElement;
}

describe('LandingForm validation UX', () => {
  it('shows an explicit error and does not submit when the name is empty', async () => {
    const action = vi.fn<unknown[], Promise<SubmitResult>>();
    render(<LandingForm event={EVENT} slug="frenzy" action={action} />);

    fireEvent.click(submitBtn());

    await screen.findByText(/add your name/i);
    const wrapper = alertWrapperFor(/add your name/i);
    expect(wrapper.className).toMatch(/text-red-300/);
    expect(action).not.toHaveBeenCalled();
  });

  it('clears the name error once the requester starts typing', async () => {
    const action = vi.fn<unknown[], Promise<SubmitResult>>();
    render(<LandingForm event={EVENT} slug="frenzy" action={action} />);

    fireEvent.click(submitBtn());
    await screen.findByText(/add your name/i);

    fillName('Jip');
    await waitFor(() => expect(screen.queryByText(/add your name/i)).not.toBeInTheDocument());
  });

  it('rejects a malformed e-mail without submitting, styled as an error', async () => {
    const action = vi.fn<unknown[], Promise<SubmitResult>>();
    render(<LandingForm event={EVENT} slug="frenzy" action={action} />);

    fillName('Jip Jansen');
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'max@hoiu.d' } });
    fireEvent.click(submitBtn());

    // The email check runs inside the same startTransition as the (mocked, but
    // still async) phone check, so give it more headroom than the default 1s
    // under a busy full-suite run.
    await screen.findByText(/doesn't look right/i, {}, { timeout: 3000 });
    const wrapper = alertWrapperFor(/doesn't look right/i);
    expect(wrapper.className).toMatch(/text-red-300/);
    expect(action).not.toHaveBeenCalled();
  });

  it('submits with a valid name and e-mail', async () => {
    const action = vi.fn<unknown[], Promise<SubmitResult>>(async () => ({ ok: true, statusToken: 'tok' }));
    render(<LandingForm event={EVENT} slug="frenzy" action={action} />);

    fillName('Jip Jansen');
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'jip@voorbeeld.nl' } });
    fireEvent.click(submitBtn());

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(action.mock.calls[0][0]).toMatchObject({ slug: 'frenzy', fullName: 'Jip Jansen', email: 'jip@voorbeeld.nl' });
    await screen.findByText(/request sent/i);
  });
});
