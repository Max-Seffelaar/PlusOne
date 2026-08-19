// @vitest-environment jsdom
//
// Coverage for 86eyd3men: the public request form's inline validation-UX, plus
// 86eyke279: e-mail and phone are hard-required on this form.
//
// The phone field is lazy-loaded (phone-lazy.tsx, #B4/86ey9e8z5) via
// next/dynamic, so it's mocked out to keep the test hermetic and to avoid
// pulling the heavy libphonenumber chunk into a unit test. Since 86eyke279 the
// phone is part of the minimum a submission needs, so the stand-in is a real
// input that forwards its raw value — E.164 formatting is libphonenumber's job
// and the validity verdict comes from the (mocked) isPhoneValid.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('./phone-lazy', () => ({
  CountrySelect: () => null,
  PhoneInput: ({
    value,
    onChange,
    placeholder,
  }: {
    value?: string;
    onChange: (v: string | undefined) => void;
    placeholder?: string;
  }) => (
    <input
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
    />
  ),
  isPhoneValid: vi.fn(async () => true),
}));

import { LandingForm, computeTurnstileBlocking, type LandingEvent, type SubmitResult } from './landing';

const EVENT: LandingEvent = { name: 'Frenzy', date: 'Sat 12 Jul', time: '23:00' };

afterEach(() => {
  vi.clearAllMocks();
});

function fillName(value: string): void {
  fireEvent.change(screen.getByPlaceholderText('First and last name'), { target: { value } });
}

function fillEmail(value: string): void {
  fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value } });
}

function fillPhone(value: string): void {
  fireEvent.change(screen.getByPlaceholderText('6 12 34 56 78'), { target: { value } });
}

/** Everything a submission needs since 86eyke279. */
function fillAll(): void {
  fillName('Jip Jansen');
  fillEmail('jip@voorbeeld.nl');
  fillPhone('+31612345678');
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
    fillPhone('+31612345678');
    fillEmail('max@hoiu.d');
    fireEvent.click(submitBtn());

    // The email check runs inside the same startTransition as the (mocked, but
    // still async) phone check, so give it more headroom than the default 1s
    // under a busy full-suite run.
    await screen.findByText(/doesn't look right/i, {}, { timeout: 3000 });
    const wrapper = alertWrapperFor(/doesn't look right/i);
    expect(wrapper.className).toMatch(/text-red-300/);
    expect(action).not.toHaveBeenCalled();
  });

  it('submits with a valid name, e-mail and phone', async () => {
    const action = vi.fn<unknown[], Promise<SubmitResult>>(async () => ({ ok: true, statusToken: 'tok' }));
    render(<LandingForm event={EVENT} slug="frenzy" action={action} />);

    fillAll();
    fireEvent.click(submitBtn());

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(action.mock.calls[0][0]).toMatchObject({
      slug: 'frenzy',
      fullName: 'Jip Jansen',
      email: 'jip@voorbeeld.nl',
      phone: '+31612345678',
    });
    await screen.findByText(/request sent/i);
  });
});

// ── 86eyke279: e-mail + phone are required on the public request form ────────
// The RPC enforces the same rule independently (migration 20260819110000);
// this describe covers the form half only.
describe('LandingForm — e-mail and phone are required', () => {
  it('labels every required field as required, and the optional one as optional', () => {
    const action = vi.fn<unknown[], Promise<SubmitResult>>();
    render(<LandingForm event={EVENT} slug="frenzy" action={action} />);

    // THREE required badges: name, e-mail and phone. The visual QA caught the
    // form shipping three required fields with only two badges — name is just
    // as blocking as the other two, so a reader who trusts the badges was
    // reading a wrong form. The message field keeps its "optional" one; the
    // contrast is what carries the meaning.
    expect(screen.getAllByText('required')).toHaveLength(3);
    expect(screen.getAllByText('optional')).toHaveLength(1);
  });

  it('blocks submission and names the missing field when the e-mail is empty', async () => {
    const action = vi.fn<unknown[], Promise<SubmitResult>>();
    render(<LandingForm event={EVENT} slug="frenzy" action={action} />);

    fillName('Jip Jansen');
    fillPhone('+31612345678');
    fireEvent.click(submitBtn());

    await screen.findByText(/add your email/i, {}, { timeout: 3000 });
    expect(alertWrapperFor(/add your email/i).className).toMatch(/text-red-300/);
    expect(action).not.toHaveBeenCalled();
  });

  it('blocks submission and names the missing field when the phone is empty', async () => {
    const action = vi.fn<unknown[], Promise<SubmitResult>>();
    render(<LandingForm event={EVENT} slug="frenzy" action={action} />);

    fillName('Jip Jansen');
    fillEmail('jip@voorbeeld.nl');
    fireEvent.click(submitBtn());

    await screen.findByText(/add your phone number/i, {}, { timeout: 3000 });
    expect(alertWrapperFor(/add your phone number/i).className).toMatch(/text-red-300/);
    expect(action).not.toHaveBeenCalled();
  });

  it('treats whitespace-only contact details as empty, not as a value', async () => {
    const action = vi.fn<unknown[], Promise<SubmitResult>>();
    render(<LandingForm event={EVENT} slug="frenzy" action={action} />);

    fillName('Jip Jansen');
    fillEmail('   ');
    fillPhone('   ');
    fireEvent.click(submitBtn());

    // "Add your …", not "that doesn't look right" — a blank box is missing,
    // not malformed.
    await screen.findByText(/add your email/i, {}, { timeout: 3000 });
    await screen.findByText(/add your phone number/i, {}, { timeout: 3000 });
    expect(action).not.toHaveBeenCalled();
  });

  it('reports all three missing fields at once, not one per attempt', async () => {
    const action = vi.fn<unknown[], Promise<SubmitResult>>();
    render(<LandingForm event={EVENT} slug="frenzy" action={action} />);

    fireEvent.click(submitBtn());

    await screen.findByText(/add your name/i, {}, { timeout: 3000 });
    await screen.findByText(/add your email/i, {}, { timeout: 3000 });
    await screen.findByText(/add your phone number/i, {}, { timeout: 3000 });
    expect(action).not.toHaveBeenCalled();
  });

  it('clears each contact error as soon as the requester types in that field', async () => {
    const action = vi.fn<unknown[], Promise<SubmitResult>>();
    render(<LandingForm event={EVENT} slug="frenzy" action={action} />);

    fireEvent.click(submitBtn());
    await screen.findByText(/add your email/i, {}, { timeout: 3000 });

    fillEmail('jip@voorbeeld.nl');
    await waitFor(() => expect(screen.queryByText(/add your email/i)).not.toBeInTheDocument());

    fillPhone('+31612345678');
    await waitFor(() => expect(screen.queryByText(/add your phone number/i)).not.toBeInTheDocument());
  });

  it('trims padded contact details before handing them to the action', async () => {
    const action = vi.fn<unknown[], Promise<SubmitResult>>(async () => ({ ok: true }));
    render(<LandingForm event={EVENT} slug="frenzy" action={action} />);

    fillName('Jip Jansen');
    fillEmail('  jip@voorbeeld.nl  ');
    fillPhone('  +31612345678  ');
    fireEvent.click(submitBtn());

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(action.mock.calls[0][0]).toMatchObject({
      email: 'jip@voorbeeld.nl',
      phone: '+31612345678',
    });
  });
});

// Review round 2, finding 2: 'ready' (script loaded) is not the same as a
// token existing — submit must stay blocked until a token is actually in
// hand, and 'failed' always blocks regardless of a stale token.
describe('computeTurnstileBlocking', () => {
  it('keyless (off) never blocks', () => {
    expect(computeTurnstileBlocking('off', false)).toBe(false);
    expect(computeTurnstileBlocking('off', true)).toBe(false);
  });

  it('failed always blocks, even with a stale token', () => {
    expect(computeTurnstileBlocking('failed', false)).toBe(true);
    expect(computeTurnstileBlocking('failed', true)).toBe(true);
  });

  it('loading and ready block until a token exists', () => {
    expect(computeTurnstileBlocking('loading', false)).toBe(true);
    expect(computeTurnstileBlocking('ready', false)).toBe(true);
    expect(computeTurnstileBlocking('ready', true)).toBe(false);
  });
});

// Review round 2, finding 3: next/script's onError never fires for a script
// request that hangs silently (dropped by a proxy/firewall, no HTTP error),
// so without the watchdog 'loading' — and a disabled submit button with no
// explanation — would persist forever.
describe('Turnstile watchdog — stuck script load', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('flips loading to failed after the timeout, disables submit, and shows a notice', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'pk_test');
    vi.useFakeTimers();
    const { LandingForm: LandingFormWithKey } = await import('./landing');
    const action = vi.fn<unknown[], Promise<SubmitResult>>();
    render(<LandingFormWithKey event={EVENT} slug="frenzy" action={action} />);

    fillName('Jip Jansen');
    // jsdom never actually loads the Turnstile script — this test IS the
    // "hangs forever" scenario, no mocking of a hang required.
    expect(submitBtn()).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    // Plain getByText, not findByText: findByText's internal wait-poll uses
    // its own setTimeout loop, which deadlocks under fake timers unless
    // advanced again — the state is already settled synchronously by the
    // act() above, so no further waiting is needed.
    expect(screen.getByText(/verification couldn't load/i)).toBeInTheDocument();
    expect(submitBtn()).toBeDisabled();
  });
});
