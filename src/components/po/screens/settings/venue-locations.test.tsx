// @vitest-environment jsdom
/**
 * Company settings → Locations (z8uq9m444c). An admin lists, adds, edits and
 * archives saved locations; everyone else who can open Company settings sees
 * the list read-only. RLS is the boundary; this pins that the UI offers no
 * write control to a non-admin and that writes carry the right payload.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { fmt, t } from '@/lib/i18n';

const H = vi.hoisted(() => ({
  locations: [] as Array<Record<string, unknown>>,
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
}));

vi.mock('@/features/po/hooks', () => ({
  usePoCompanyLocations: () => ({ data: H.locations, isLoading: false, isError: false }),
  usePoVenueSettings: () => ({ data: { country: 'NL' } }),
}));
vi.mock('@/features/po/mutations', () => ({
  usePoCreateCompanyLocation: () => ({ mutateAsync: H.create, isPending: false, error: null }),
  usePoUpdateCompanyLocation: () => ({ mutateAsync: H.update, isPending: false, error: null }),
  usePoArchiveCompanyLocation: () => ({
    mutate: (id: string, opts?: { onSuccess?: () => void }) => {
      H.archive(id);
      opts?.onSuccess?.();
    },
    reset: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

const { VenueLocations } = await import('./venue-locations');

const paradiso = {
  id: 'loc-1', name: 'Paradiso', addressLine: 'Weteringschans 6', postalCode: '1017 SG', city: 'Amsterdam',
  country: 'NL', placeId: null, address: 'Weteringschans 6, 1017 SG Amsterdam',
};

beforeEach(() => {
  H.locations = [];
  H.create.mockReset().mockResolvedValue('new-id');
  H.update.mockReset().mockResolvedValue({ ok: true });
  H.archive.mockReset();
});
afterEach(cleanup);

describe('VenueLocations', () => {
  it('empty state, and an admin can add one', async () => {
    render(<VenueLocations canEdit />);
    expect(screen.getByText(t.settings.locations.empty)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.settings.locations.add) }));
    const save = screen.getByRole('button', { name: new RegExp(t.settings.locations.save) });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: t.settings.locations.nameLabel }), { target: { value: 'Melkweg' } });
    fireEvent.change(screen.getByRole('combobox', { name: t.settings.venue.streetFieldLabel }), { target: { value: 'Lijnbaansgracht 234A' } });
    fireEvent.change(screen.getByRole('textbox', { name: t.settings.venue.cityFieldLabel }), { target: { value: 'Amsterdam' } });
    fireEvent.click(save);
    await waitFor(() => expect(H.create).toHaveBeenCalledTimes(1));
    expect(H.create).toHaveBeenCalledWith({
      name: 'Melkweg', addressLine: 'Lijnbaansgracht 234A', postalCode: '', city: 'Amsterdam', country: 'NL',
    });
  });

  it('lists a location with its address; an admin edits it in place', async () => {
    H.locations = [paradiso];
    render(<VenueLocations canEdit />);
    expect(screen.getByText('Paradiso')).toBeInTheDocument();
    expect(screen.getByText('Weteringschans 6, 1017 SG Amsterdam')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: fmt(t.settings.locations.editAria, { name: 'Paradiso' }) }));
    const nameBox = screen.getByRole('textbox', { name: t.settings.locations.nameLabel });
    expect(nameBox).toHaveValue('Paradiso');
    fireEvent.change(nameBox, { target: { value: 'Paradiso Noord' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.settings.locations.save) }));
    await waitFor(() => expect(H.update).toHaveBeenCalledTimes(1));
    expect(H.update.mock.calls[0][0]).toMatchObject({ locationId: 'loc-1', name: 'Paradiso Noord', city: 'Amsterdam' });
  });

  it('archiving asks first and names what stays', () => {
    H.locations = [paradiso];
    render(<VenueLocations canEdit />);
    fireEvent.click(screen.getByRole('button', { name: fmt(t.settings.locations.archiveAria, { name: 'Paradiso' }) }));
    expect(screen.getByText(fmt(t.settings.locations.archiveConfirm, { name: 'Paradiso' }))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.settings.locations.archiveYes) }));
    expect(H.archive).toHaveBeenCalledWith('loc-1');
  });

  it('read-only for a non-admin: the list, no add/edit/archive', () => {
    H.locations = [paradiso];
    render(<VenueLocations canEdit={false} />);
    expect(screen.getByText('Paradiso')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(t.settings.locations.add) })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: fmt(t.settings.locations.editAria, { name: 'Paradiso' }) })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: fmt(t.settings.locations.archiveAria, { name: 'Paradiso' }) })).not.toBeInTheDocument();
  });
});
