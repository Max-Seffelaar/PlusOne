// @vitest-environment jsdom
//
// Field errors through React Query (z8uq9m5m8g): a failed server action
// reaches the form as a FieldActionError that keeps `field` AND `fields`, for
// both result shapes (MutationError and the useActionState-style
// `{ ok, error }`), and a refusal without a message falls back to the English
// catalogue string, never the old Dutch 'Er ging iets mis.'.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { FieldActionError } from '@/lib/field-error';
import { t } from '@/lib/i18n';

const H = vi.hoisted(() => ({
  createRequestLink: vi.fn(),
  createInfluencer: vi.fn(),
  updateProfileAction: vi.fn(),
}));

vi.mock('@/features/links/actions', () => ({
  createRequestLink: H.createRequestLink,
  createInfluencer: H.createInfluencer,
  updateRequestLink: vi.fn(),
  updateInfluencer: vi.fn(),
  rotateInfluencerStatsToken: vi.fn(),
  revokeInfluencerStatsToken: vi.fn(),
}));
vi.mock('@/features/auth/profile-actions', () => ({
  updateProfileAction: H.updateProfileAction,
  updateEmailAction: vi.fn(),
}));
vi.mock('./PoLiveProvider', () => ({
  usePoIdentity: () => ({ venueId: 'venue-1', userId: 'user-1', roles: ['admin'] }),
}));

import { usePoCreateLink, usePoCreateInfluencer, usePoUpdateProfile } from './mutations';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('mutation errors keep the fields', () => {
  it('createRequestLink: field + fields survive onto the thrown error', async () => {
    H.createRequestLink.mockResolvedValue({
      ok: false,
      code: 'invalid',
      message: 'Too many',
      field: 'maxHeadcount',
      fields: { maxHeadcount: 'Too many', expiresAt: 'Bad date' },
    });
    const { result } = renderHook(() => usePoCreateLink('event-1'), { wrapper });
    act(() => result.current.mutate({ eventId: 'event-1', label: 'x', slugBase: 'x' }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    const e = result.current.error;
    expect(e).toBeInstanceOf(FieldActionError);
    expect((e as FieldActionError).field).toBe('maxHeadcount');
    expect((e as FieldActionError).fields).toEqual({ maxHeadcount: 'Too many', expiresAt: 'Bad date' });
  });

  it('a refusal with no message falls back to the English catalogue string', async () => {
    H.createInfluencer.mockResolvedValue({ ok: false, code: 'x', message: '' });
    const { result } = renderHook(() => usePoCreateInfluencer(), { wrapper });
    act(() => result.current.mutate({ venueId: 'venue-1', name: 'Al' }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe(t.settings.common.formError);
    expect(result.current.error?.message).not.toMatch(/iets mis/);
  });

  it('the { ok, error } action shape carries its field too', async () => {
    H.updateProfileAction.mockResolvedValue({ ok: false, error: 'Invalid phone number', field: 'phone' });
    const { result } = renderHook(() => usePoUpdateProfile(), { wrapper });
    act(() => result.current.mutate({ firstName: 'A', lastName: 'B', phone: '12' }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Invalid phone number');
    expect((result.current.error as FieldActionError).field).toBe('phone');
  });
});
