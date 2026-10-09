// @vitest-environment jsdom
/**
 * Share-import S2: `/app/share` lands on Paste a list with the shared text in
 * it, strips the text from the address bar, defaults to the NEXT upcoming event,
 * counts the preview, and imports through the one existing bulk-add mutation.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { clearSharedText, peekSharedText, putSharedText } from '@/features/guests/share-inbox';

const nav = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), setTab: vi.fn(), openDoor: vi.fn(), canGoBack: false };
const addBulk = { mutateAsync: vi.fn(async () => undefined), isError: false, error: null };

const ev = (id: string, name: string, date: string) => ({
  id, name, venue: 'Club', location: null, time: '23:00', date, mon: 'OCT', month: 'October',
  guests: 0, inside: 0, when: 'upcoming', phase: 'planned', cancelled: false,
});
// newest-first, like usePoEvents: "Late" is further out, "Next" is the soonest.
const EVENTS = [ev('e-late', 'Late', '30'), ev('e-next', 'Next', '12')];
const tier = (id: string, name: string) => ({
  id, name, short: name, role: 'guest', color: '#B5A6FF', max: null, used: 0, doorPrice: 0, vatPercent: null, aliases: [],
});
const TIERS: Record<string, ReturnType<typeof tier>[]> = {
  'e-next': [tier('t-reg', 'Regular'), tier('t-vip', 'VIP')],
  'e-late': [tier('t-late', 'Regular')],
};

vi.mock('@/features/po/hooks', () => ({
  usePoEvents: () => ({ data: EVENTS }),
  usePoTiers: (id: string) => ({ data: TIERS[id] ?? [] }),
  usePoQuota: () => ({ data: { exempt: true, remaining: null } }),
  usePoGuests: () => ({ data: [] }),
  usePoContactNameMatches: () => ({ data: new Map() }),
}));
vi.mock('@/features/po/mutations', () => ({
  usePoAddGuestsBulk: () => addBulk,
  usePoUpdateGuest: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/features/po/queries', () => ({ findEventGuestsByNames: vi.fn(async () => []) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/components/po/context', () => ({ useNav: () => nav }));

import { ShareScreen } from './share';

/** The Paste a list box (its placeholder spans lines, so query the element). */
function textarea(): HTMLTextAreaElement {
  const el = document.querySelector('textarea');
  if (!el) throw new Error('no textarea yet');
  return el;
}

const SHARED = 'Name\tEmail\nMilan Hendriks +2\nFleur Janssen\tfleur@example.com\n- Sem +1';

beforeEach(() => {
  vi.clearAllMocks();
  clearSharedText();
  window.history.replaceState(null, '', '/app/share');
});
afterEach(cleanup);

describe('ShareScreen', () => {
  it('a remount after the URL rewrite (the shell keys screens on the URL) still has the text', async () => {
    window.history.replaceState(null, '', `/app/share?text=${encodeURIComponent('Noor +1')}`);
    const first = render(<ShareScreen />);
    await waitFor(() => expect(textarea()).toHaveValue('Noor +1'));
    first.unmount();
    render(<ShareScreen />);
    await waitFor(() => expect(textarea()).toHaveValue('Noor +1'));
  });

  it('fills Paste a list from ?text= and rewrites the URL without it', async () => {
    window.history.replaceState(null, '', `/app/share?text=${encodeURIComponent(SHARED)}`);
    render(<ShareScreen />);
    const box = await waitFor(() => textarea());
    expect(box).toHaveValue(SHARED);
    expect(window.location.href).not.toContain('Milan');
    expect(window.location.pathname + window.location.search).toBe('/app/share');
  });

  it('reads the in-memory inbox the native plugin fills (S6)', async () => {
    putSharedText('Noor +1');
    render(<ShareScreen />);
    expect(await waitFor(() => textarea())).toHaveValue('Noor +1');
  });

  it('defaults to the next upcoming event and counts the preview (header skipped)', async () => {
    putSharedText(SHARED);
    render(<ShareScreen />);
    const [eventSelect, tierSelect] = await screen.findAllByRole('combobox');
    expect(eventSelect).toHaveValue('e-next');
    expect(tierSelect).toHaveValue('t-reg');
    // 3 entries: Milan (+2) + Fleur + Sem (+1) = 6 guests, 1 with e-mail.
    expect(screen.getByTestId('paste-summary')).toHaveTextContent('3 entries · 6 guests total · 1 with e-mail');
  });

  it('imports into the picked event with the picked tier, then shows that list', async () => {
    putSharedText('Milan Hendriks +2\nFleur Janssen fleur@example.com');
    render(<ShareScreen />);
    const [, tierSelect] = await screen.findAllByRole('combobox');
    fireEvent.change(tierSelect, { target: { value: 't-vip' } });
    fireEvent.click(screen.getByRole('button', { name: /Add 2 guests/ }));
    await waitFor(() => expect(addBulk.mutateAsync).toHaveBeenCalledTimes(1));
    const arg = (addBulk.mutateAsync.mock.calls[0] as unknown as [{ eventId: string; guests: Array<Record<string, unknown>> }])[0];
    expect(arg.eventId).toBe('e-next');
    expect(arg.guests).toEqual([
      expect.objectContaining({ fullName: 'Milan Hendriks', plusOnes: 2, tierId: 't-vip' }),
      expect.objectContaining({ fullName: 'Fleur Janssen', plusOnes: 0, tierId: 't-vip', email: 'fleur@example.com' }),
    ]);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('lijst', { id: 'e-next' }));
    expect(peekSharedText()).toBeNull(); // forgotten once imported
  });

  it('switching the event re-resolves its tiers', async () => {
    putSharedText('Milan');
    render(<ShareScreen />);
    const [eventSelect] = await screen.findAllByRole('combobox');
    fireEvent.change(eventSelect, { target: { value: 'e-late' } });
    const [, tierSelect] = screen.getAllByRole('combobox');
    expect(tierSelect).toHaveValue('t-late');
    expect(textarea()).toHaveValue('Milan');
  });
});
