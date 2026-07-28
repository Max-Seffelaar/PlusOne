// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { DoorQueryProvider } from './DoorQueryProvider';

// Stub the IndexedDB layer so PersistQueryClientProvider's restore/persist resolve
// without a real IndexedDB (same pattern as offline/persister.test.ts). An empty
// restore is all this test needs — it asserts the CLIENT INSTANCE, not cache content.
vi.mock('./offline/idb', () => ({
  idbGet: vi.fn(() => Promise.resolve(undefined)),
  idbSet: vi.fn(() => Promise.resolve()),
  idbDel: vi.fn(() => Promise.resolve()),
}));

/** Captures the door QueryClient visible at this point in the tree on every render. */
function ClientProbe({ sink }: { sink: QueryClient[] }): null {
  sink.push(useQueryClient());
  return null;
}

// The real proof of the fix (86ey9e8pm / L1): before, each mount of DoorQueryProvider
// produced a brand-new client (the leak — an abandoned client per Deur-tab visit);
// now the provider reuses the module singleton, so an unmount→remount cycle (exactly
// what a /app screen navigation does to the shell) hands back the SAME instance.
describe('DoorQueryProvider — one client across remounts (86ey9e8pm / L1)', () => {
  it('serves the same QueryClient instance after an unmount → remount cycle', async () => {
    const seen: QueryClient[] = [];

    const first = render(
      <DoorQueryProvider>
        <ClientProbe sink={seen} />
      </DoorQueryProvider>,
    );
    await act(async () => {}); // flush the async IndexedDB restore
    const beforeRemount = seen[0];
    first.unmount();

    render(
      <DoorQueryProvider>
        <ClientProbe sink={seen} />
      </DoorQueryProvider>,
    );
    await act(async () => {});
    const afterRemount = seen[seen.length - 1];

    expect(beforeRemount).toBeDefined();
    expect(afterRemount).toBe(beforeRemount);
  });
});
