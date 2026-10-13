// @vitest-environment jsdom
/**
 * Promotion forms point at the field (z8uq9m5m8g): the create-link flow, the
 * link edit sheet and the promoter sheet. Client checks (name too short, half
 * an expiry) and server fields (incl. the "+ New" promoter's `name` and the
 * link's `maxHeadcount`, mapped onto this form's inputs) land the same way;
 * a refusal without a field stays the banner.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { FieldActionError } from '@/lib/field-error';
import { expectFieldError, stubScrollIntoView } from '../../../../../tests/unit/helpers/field-error-asserts';

const H = vi.hoisted(() => ({ createLink: vi.fn(), createInf: vi.fn(), updateLink: vi.fn(), updateInf: vi.fn() }));
const stub = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });

vi.mock('../../context', () => ({ useNav: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock('../../shell', () => ({ Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/features/po/PoLiveProvider', () => ({ usePoIdentity: () => ({ venueId: 'v1', roles: ['admin'] }) }));
vi.mock('@/features/po/hooks', () => ({
  usePoTiers: () => ({ data: [], isLoading: false }),
  usePoInfluencers: () => ({ data: [] }),
  usePoEventForEdit: () => ({ data: null }),
  usePoEventOptions: () => ({ data: [] }),
  usePoRequestLinks: () => ({ data: [], isLoading: false }),
}));
vi.mock('@/features/po/mutations', () => ({
  usePoCreateLink: () => ({ ...stub(), mutateAsync: H.createLink }),
  usePoCreateInfluencer: () => ({ ...stub(), mutateAsync: H.createInf }),
  usePoUpdateLink: () => ({ ...stub(), mutateAsync: H.updateLink }),
  usePoUpdateInfluencer: () => ({ ...stub(), mutateAsync: H.updateInf }),
  usePoRotateStatsToken: stub,
  usePoRevokeStatsToken: stub,
}));

const { CreateLinkFlow } = await import('./create-link-flow');
const { LinkSheet } = await import('./event-links');
const { InfluencerSheet } = await import('./roster');

beforeEach(stubScrollIntoView);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const dateInput = () => document.querySelector<HTMLInputElement>('input[type="date"]')!;
const timeInput = () => document.querySelector<HTMLInputElement>('input[type="time"]')!;

describe('create-link flow', () => {
  function open(): void {
    render(<CreateLinkFlow eventId="e1" eventName="Friday" onClose={vi.fn()} />);
  }
  const create = () => fireEvent.click(screen.getByRole('button', { name: new RegExp(t.links.createCta) }));

  it('client check: a one-letter new promoter name points at that input', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: t.links.chipNew }));
    fireEvent.change(screen.getByPlaceholderText(t.links.newInfluencerPlaceholder), { target: { value: 'A' } });
    create();
    expectFieldError(screen.getByPlaceholderText(t.links.newInfluencerPlaceholder), t.links.errNewInfluencerName);
    expect(H.createInf).not.toHaveBeenCalled();
  });

  it('client check: a date without a time points at the time input', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: t.links.chipLabelOnly }));
    fireEvent.change(screen.getByPlaceholderText(t.links.labelPlaceholder), { target: { value: 'Insta' } });
    fireEvent.change(dateInput(), { target: { value: '2026-12-01' } });
    create();
    expectFieldError(timeInput(), t.links.errExpiry);
  });

  it('server field: the link refuses maxHeadcount → the max-heads input', async () => {
    H.createLink.mockRejectedValue(new FieldActionError(t.links.errMaxHeadsRange, 'maxHeadcount'));
    open();
    fireEvent.click(screen.getByRole('button', { name: t.links.chipLabelOnly }));
    fireEvent.change(screen.getByPlaceholderText(t.links.labelPlaceholder), { target: { value: 'Insta' } });
    const max = screen.getByPlaceholderText(t.links.maxHeadsPlaceholder);
    fireEvent.change(max, { target: { value: '999999' } });
    create();
    await waitFor(() => expect(max).toHaveAttribute('aria-invalid', 'true'));
    expectFieldError(max, t.links.errMaxHeadsRange);
  });

  it('server field: the "+ New" promoter refuses its name → the new-name input', async () => {
    H.createInf.mockRejectedValue(new FieldActionError('Enter a name', 'name'));
    open();
    fireEvent.click(screen.getByRole('button', { name: t.links.chipNew }));
    const nm = screen.getByPlaceholderText(t.links.newInfluencerPlaceholder);
    fireEvent.change(nm, { target: { value: 'Al' } });
    create();
    await waitFor(() => expect(nm).toHaveAttribute('aria-invalid', 'true'));
    expectFieldError(nm, 'Enter a name');
  });

  it('no identity picked: the banner (the chips are not an input)', () => {
    open();
    create();
    expect(screen.getByRole('alert')).toHaveTextContent(t.links.errIdentity);
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });
});

describe('link edit sheet', () => {
  const link = {
    id: 'l1', eventId: 'e1', slug: 'insta-abc', isDefault: false, active: true, autoApprove: false,
    influencerId: null, influencerName: null, label: 'Insta', tierId: null, maxHeadcount: null, expiresAt: null,
  } as never;

  it('client check: an empty label points at the label input', () => {
    render(<LinkSheet eventId="e1" link={link} tiers={[]} tiersLoading={false} influencers={[]} onClose={vi.fn()} onSaved={vi.fn()} />);
    const label = screen.getByPlaceholderText(t.links.labelPlaceholder);
    fireEvent.change(label, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.links.saveCta) }));
    expectFieldError(label, t.links.errIdentity);
  });

  it('server field: expiresAt → the expiry date input', async () => {
    H.updateLink.mockRejectedValue(new FieldActionError('Invalid datetime', 'expiresAt'));
    render(<LinkSheet eventId="e1" link={link} tiers={[]} tiersLoading={false} influencers={[]} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(dateInput(), { target: { value: '2026-12-01' } });
    fireEvent.change(timeInput(), { target: { value: '23:00' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.links.saveCta) }));
    await waitFor(() => expect(dateInput()).toHaveAttribute('aria-invalid', 'true'));
    expectFieldError(dateInput(), 'Invalid datetime');
  });
});

describe('promoter sheet', () => {
  it('client check: a one-letter name points at the name input', () => {
    render(<InfluencerSheet influencer={null} onClose={vi.fn()} />);
    const name = screen.getByPlaceholderText(t.links.namePlaceholder);
    fireEvent.change(name, { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.links.addCta) }));
    expectFieldError(name, t.links.errInfluencerName);
  });

  it('server field: a refused handle points at the handle input', async () => {
    H.createInf.mockRejectedValue(new FieldActionError('Keep it to 80 characters.', 'handle'));
    render(<InfluencerSheet influencer={null} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(t.links.namePlaceholder), { target: { value: 'Alex' } });
    const handle = screen.getByPlaceholderText(t.links.handlePlaceholder);
    fireEvent.change(handle, { target: { value: '@alex' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.links.addCta) }));
    await waitFor(() => expect(handle).toHaveAttribute('aria-invalid', 'true'));
    expectFieldError(handle, 'Keep it to 80 characters.');
  });

  it('no field: the banner', async () => {
    H.createInf.mockRejectedValue(new Error('Not allowed'));
    render(<InfluencerSheet influencer={null} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(t.links.namePlaceholder), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.links.addCta) }));
    await waitFor(() => expect(screen.getByText('Not allowed')).toBeInTheDocument());
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });
});
