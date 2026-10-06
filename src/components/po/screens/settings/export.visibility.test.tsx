// @vitest-environment jsdom
/**
 * Data export entry points (legal v0.3 E1, z8uq9m2hm6).
 *
 *  - admin sees "Export everything" and the click calls exportVenueData with
 *    the venue scope, then hands the ZIP to the kit's downloadFile;
 *  - finance / staff see neither the venue card nor the event row (the action
 *    and the audit RPC refuse them anyway — this pins the UI half);
 *  - a platform admin in a venue they hold no membership at (roles []) DOES see
 *    them — the server admits them and logs platform_access_log (#49);
 *  - the native shell shows "export from the web app" and never calls the
 *    action (the webview cannot save a blob download);
 *  - "too_large" surfaces the "export per event" copy.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';

const H = vi.hoisted(() => ({
  roles: ['admin'] as string[],
  platformAdmin: false,
  native: false,
  result: { ok: true, filename: 'x.zip', zipBase64: 'UEs=', counts: { guests: 3, contacts: 2, requests: 1, door: 0 } } as unknown,
  calls: [] as unknown[],
  downloads: [] as string[],
}));

vi.mock('@/features/po/PoLiveProvider', () => ({
  usePoIdentity: () => ({ roles: H.roles, venueId: '018f3a2e-0000-7000-8000-00000000000a' }),
}));
vi.mock('@/features/po/hooks', () => ({ usePoIsPlatformAdmin: () => H.platformAdmin }));
vi.mock('@/lib/platform', () => ({ isNativeShell: () => H.native }));
vi.mock('@/features/export/actions', () => ({
  exportVenueData: async (input: unknown) => {
    H.calls.push(input);
    return H.result;
  },
}));
vi.mock('../../kit', async (orig) => ({
  ...(await orig<typeof import('../../kit')>()),
  downloadFile: (_b64: string, filename: string) => {
    H.downloads.push(filename);
    return true;
  },
}));

const { ExportDataCard, ExportEventRow } = await import('./export');

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  H.roles = ['admin'];
  H.platformAdmin = false;
  H.native = false;
  H.calls = [];
  H.downloads = [];
  H.result = { ok: true, filename: 'x.zip', zipBase64: 'UEs=', counts: { guests: 3, contacts: 2, requests: 1, door: 0 } };
});

describe('ExportDataCard', () => {
  it('lets an admin export the whole venue', async () => {
    wrap(<ExportDataCard />);
    fireEvent.click(screen.getByRole('button', { name: t.settings.export.everything }));
    await waitFor(() => expect(H.downloads).toEqual(['x.zip']));
    expect(H.calls).toEqual([{ venueId: '018f3a2e-0000-7000-8000-00000000000a', scope: 'venue' }]);
    expect(await screen.findByRole('status')).toHaveTextContent('3 guests');
  });

  it.each([[['finance']], [['staff']], [['doorhost', 'staff']]])('is hidden for %j', (roles) => {
    H.roles = roles;
    const { container } = wrap(
      <>
        <ExportDataCard />
        <ExportEventRow eventId="018f3a2e-0000-7000-8000-0000000000e1" />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows both entry points to a platform admin without a membership (roles [])', async () => {
    H.roles = [];
    H.platformAdmin = true;
    wrap(
      <>
        <ExportDataCard />
        <ExportEventRow eventId="018f3a2e-0000-7000-8000-0000000000e1" />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: t.settings.export.everything }));
    await waitFor(() => expect(H.downloads).toEqual(['x.zip']));
    expect(H.calls).toEqual([{ venueId: '018f3a2e-0000-7000-8000-00000000000a', scope: 'venue' }]);
    expect(screen.getByRole('button', { name: new RegExp(t.settings.export.eventOnly) })).toBeInTheDocument();
  });

  it('points to the web app in the native shell and never calls the action', () => {
    H.native = true;
    wrap(<ExportDataCard />);
    expect(screen.getByText(t.settings.export.nativeOnly)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.settings.export.everything })).toBeNull();
    expect(H.calls).toEqual([]);
  });

  it('says "export per event" when the venue is too large', async () => {
    H.result = { ok: false, error: 'too_large' };
    wrap(<ExportDataCard />);
    fireEvent.click(screen.getByRole('button', { name: t.settings.export.everything }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t.settings.export.errorTooLarge);
    expect(H.downloads).toEqual([]);
  });
});

describe('ExportEventRow', () => {
  it('exports one event for an admin', async () => {
    wrap(<ExportEventRow eventId="018f3a2e-0000-7000-8000-0000000000e1" />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.settings.export.eventOnly) }));
    await waitFor(() => expect(H.downloads).toEqual(['x.zip']));
    expect(H.calls).toEqual([
      { venueId: '018f3a2e-0000-7000-8000-00000000000a', scope: { eventId: '018f3a2e-0000-7000-8000-0000000000e1' } },
    ]);
  });
});
