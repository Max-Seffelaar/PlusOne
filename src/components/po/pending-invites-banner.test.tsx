// @vitest-environment jsdom
/**
 * The Home banner (z8uq9m2yvp): each invite has its own Accept and Decline;
 * Decline asks first; the list follows the query and refetches after a change; a
 * card the server reports as no longer open disappears (no dead buttons).
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { t } from '@/lib/i18n';

const H = vi.hoisted(() => ({
  accept: vi.fn(),
  decline: vi.fn(),
  refresh: vi.fn(),
  invites: { data: [] as Array<{ id: string; label: string; venueName: string }> },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: H.refresh }) }));
vi.mock('@/features/auth/invite-actions', () => ({ acceptInviteAction: H.accept, declineInviteAction: H.decline }));
vi.mock('@/features/po/hooks', () => ({ usePoMyPendingInvites: () => H.invites }));

const { PendingInvitesBanner } = await import('./pending-invites-banner');

afterEach(() => {
  cleanup();
  H.accept.mockReset();
  H.decline.mockReset();
  H.refresh.mockReset();
});

const s = t.shared.invites;
const a = { id: 'i-a', label: 'Club Vesper (Staff)', venueName: 'Club Vesper' };
const b = { id: 'i-b', label: 'Crew · Crew Night at De Marktzaal', venueName: 'De Marktzaal' };

function renderBanner() {
  const qc = new QueryClient();
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  render(
    <QueryClientProvider client={qc}>
      <PendingInvitesBanner />
    </QueryClientProvider>,
  );
  return { invalidate };
}

describe('PendingInvitesBanner', () => {
  it('renders nothing without invites', () => {
    H.invites.data = [];
    renderBanner();
    expect(screen.queryByText(s.note)).toBeNull();
  });

  it('accepts exactly the tapped invite and refreshes', async () => {
    H.invites.data = [a, b];
    H.accept.mockResolvedValue({ ok: true });
    renderBanner();
    fireEvent.click(screen.getAllByRole('button', { name: s.accept })[1]!);
    await waitFor(() => expect(H.refresh).toHaveBeenCalled());
    expect(H.accept).toHaveBeenCalledWith('i-b');
    expect(H.decline).not.toHaveBeenCalled();
  });

  it('Decline asks first; Keep backs out with no server call', () => {
    H.invites.data = [a];
    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: s.decline }));
    expect(screen.getByText('Decline this invite? You can ask Club Vesper to invite you again later.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: s.keep }));
    expect(H.decline).not.toHaveBeenCalled();
  });

  it('a confirmed decline calls the server once, confirms in place and refetches the list', async () => {
    H.invites.data = [a];
    H.decline.mockResolvedValue({ ok: true });
    const { invalidate } = renderBanner();
    fireEvent.click(screen.getByRole('button', { name: s.decline }));
    fireEvent.click(screen.getByRole('button', { name: s.declineConfirm }));
    expect(await screen.findByRole('status')).toHaveTextContent('You declined the invite from Club Vesper.');
    expect(H.decline).toHaveBeenCalledTimes(1);
    expect(H.decline).toHaveBeenCalledWith('i-a');
    expect(invalidate).toHaveBeenCalled();
    expect(screen.queryByText(a.label)).toBeNull();
    expect(H.refresh).not.toHaveBeenCalled();
  });

  it('a card that is no longer open disappears and says why, the other stays', async () => {
    H.invites.data = [a, b];
    H.accept.mockResolvedValue({ ok: false, error: s.notOpen, code: 'not_open' });
    renderBanner();
    fireEvent.click(screen.getAllByRole('button', { name: s.accept })[0]!);
    expect(await screen.findByRole('alert')).toHaveTextContent(s.notOpen);
    expect(screen.queryByText(a.label)).toBeNull();
    expect(screen.getByText(b.label)).toBeInTheDocument();
  });
});
