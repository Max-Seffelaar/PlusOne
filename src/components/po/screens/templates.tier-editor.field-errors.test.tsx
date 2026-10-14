// @vitest-environment jsdom
/**
 * Template tier editor + "Save as template" (z8uq9m5m8g): a refusal about a
 * field marks that input (every field the server named), puts the message
 * under it, focuses the first in form order, and shows no banner. A refusal
 * without a field (a delete that failed, rights) stays the banner.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { FieldActionError } from '@/lib/field-error';
import { expectFieldError, stubScrollIntoView } from '../../../../tests/unit/helpers/field-error-asserts';

const H = vi.hoisted(() => ({ createTier: vi.fn(), deleteTier: vi.fn(), createTpl: vi.fn() }));
const stub = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });

vi.mock('../context', () => ({ useNav: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock('../shell', () => ({ BottomBar: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/features/po/PoLiveProvider', () => ({ usePoIdentity: () => ({ venueId: 'v1', venueName: 'Club' }) }));
vi.mock('@/features/po/hooks', () => ({
  usePoCanManageTemplates: () => true,
  usePoTemplate: () => ({ data: null }),
  usePoTemplates: () => ({ data: [] }),
  usePoTemplateTiers: () => ({ data: [{ id: 't1', name: 'GA', color: null, max_guests: null, door_price_cents: null, vat_percent: null, aliases: [] }], isLoading: false }),
}));
vi.mock('@/features/po/mutations', () => ({
  usePoCreateTemplate: stub,
  usePoUpdateTemplate: stub,
  usePoDeleteTemplate: stub,
  usePoCreateTemplateTier: () => ({ ...stub(), mutateAsync: H.createTier }),
  usePoDeleteTemplateTier: () => ({ ...stub(), mutateAsync: H.deleteTier }),
  usePoCreateTemplateFromEvent: () => ({ ...stub(), mutateAsync: H.createTpl }),
}));

const { TemplateTierEditor } = await import('./templates');
const { SaveAsTemplate } = await import('./events/save-as-template');

beforeEach(stubScrollIntoView);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function openNewTier(): void {
  render(<TemplateTierEditor templateId="tpl1" canManage />);
  fireEvent.click(screen.getAllByRole('button')[0]);
  fireEvent.change(screen.getByPlaceholderText(t.templates.tierNamePlaceholder), { target: { value: 'VIP' } });
  fireEvent.change(screen.getByPlaceholderText(t.templates.pricePlaceholder), { target: { value: '5000000' } });
}

describe('template tier editor', () => {
  it('marks every field the server named; focus on the first in form order (price before VAT)', async () => {
    H.createTier.mockRejectedValue(
      new FieldActionError('VAT is too high', 'vatPercent', { vatPercent: 'VAT is too high', doorPriceCents: 'Price is too high' }),
    );
    openNewTier();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.templates.addTier) }));
    const price = screen.getByPlaceholderText(t.templates.pricePlaceholder);
    await waitFor(() => expect(price).toHaveAttribute('aria-invalid', 'true'));
    expectFieldError(price, 'Price is too high');
    expectFieldError(screen.getByPlaceholderText(t.events.vatPlaceholder), 'VAT is too high', { focused: false });
  });

  it('a failed remove (no field) is the banner, nothing marked', async () => {
    H.deleteTier.mockRejectedValue(new Error('Not allowed'));
    render(<TemplateTierEditor templateId="tpl1" canManage />);
    fireEvent.click(screen.getByRole('button', { name: t.templates.removeTier }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Not allowed'));
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });
});

describe('save as template', () => {
  it('a refused name is marked under the name input, focused, no banner', async () => {
    H.createTpl.mockRejectedValue(new FieldActionError('Name is too long', 'name'));
    render(<SaveAsTemplate eventId="e1" />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.events.saveTemplateCta) }));
    const name = screen.getByPlaceholderText(t.events.saveTemplatePlaceholder);
    fireEvent.change(name, { target: { value: 'Friday' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.events.saveTemplateConfirm) }));
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));
    expectFieldError(name, 'Name is too long');
  });

  it('a refusal without a field is the line under the buttons', async () => {
    H.createTpl.mockRejectedValue(new Error(t.events.saveTemplateError));
    render(<SaveAsTemplate eventId="e1" />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.events.saveTemplateCta) }));
    fireEvent.change(screen.getByPlaceholderText(t.events.saveTemplatePlaceholder), { target: { value: 'Friday' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.events.saveTemplateConfirm) }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(t.events.saveTemplateError));
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });
});
