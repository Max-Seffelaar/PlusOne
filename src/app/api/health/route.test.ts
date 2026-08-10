import { afterEach, describe, expect, it, vi } from 'vitest';

const selectMock = vi.fn();
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock('@/lib/supabase/health-client', () => ({
  createHealthClient: () => ({ from: fromMock }),
}));

async function loadRoute() {
  vi.resetModules();
  return import('./route');
}

describe('GET /api/health', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 ok when the database round-trip succeeds', async () => {
    selectMock.mockReturnValue({ limit: () => Promise.resolve({ error: null }) });
    const { GET } = await loadRoute();

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('returns 503 when the database round-trip fails', async () => {
    selectMock.mockReturnValue({
      limit: () => Promise.resolve({ error: new Error('connection refused') }),
    });
    const { GET } = await loadRoute();

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: 'error' });
  });

  it('returns 503 when the client throws synchronously', async () => {
    fromMock.mockImplementationOnce(() => {
      throw new Error('client init failed');
    });
    const { GET } = await loadRoute();

    const response = await GET();

    expect(response.status).toBe(503);
  });
});
