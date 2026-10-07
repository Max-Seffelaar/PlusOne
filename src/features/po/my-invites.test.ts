/**
 * The incoming-invite banner read (z8uq9m2yvp): the invitee may not read the
 * inviting company or its events yet, so the names come from the SECURITY
 * DEFINER read my_pending_invites(); a crew invite (no roles) shows its event.
 */
import { describe, expect, it, vi } from 'vitest';
import { fetchMyPendingInvites } from './queries';
import { toPoMyInvite } from './adapters';

describe('fetchMyPendingInvites', () => {
  it('reads through my_pending_invites() and keeps the event only for crew invites', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { id: 'i1', company_name: 'Club Vesper', roles: ['staff'], event_name: null, created_at: 'x' },
        { id: 'i2', company_name: 'De Marktzaal', roles: [], event_name: 'Crew Night', created_at: 'y' },
      ],
      error: null,
    });
    const rows = await fetchMyPendingInvites({ rpc } as never);
    expect(rpc).toHaveBeenCalledWith('my_pending_invites');
    expect(rows).toEqual([
      { id: 'i1', venue_name: 'Club Vesper', roles: ['staff'], event_name: null },
      { id: 'i2', venue_name: 'De Marktzaal', roles: [], event_name: 'Crew Night' },
    ]);
  });

  it('throws on a read error (React Query shows it, the banner stays hidden)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(fetchMyPendingInvites({ rpc } as never)).rejects.toMatchObject({ message: 'boom' });
  });
});

describe('toPoMyInvite', () => {
  it('a team invite reads "Company (Role)"', () => {
    expect(toPoMyInvite({ id: 'i1', venue_name: 'Club Vesper', roles: ['staff'], event_name: null }).label).toBe(
      'Club Vesper (Staff)',
    );
  });

  it('a crew invite reads "Crew · Event at Company"', () => {
    expect(toPoMyInvite({ id: 'i2', venue_name: 'De Marktzaal', roles: [], event_name: 'Crew Night' }).label).toBe(
      'Crew · Crew Night at De Marktzaal',
    );
  });

  it('falls back when a name is missing', () => {
    expect(toPoMyInvite({ id: 'i3', venue_name: null, roles: [], event_name: null }).label).toBe(
      'Crew · an event at a company',
    );
  });
});
