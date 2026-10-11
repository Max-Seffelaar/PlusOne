'use client';

// Platform > Mail log (ClickUp z8uq9m49k1, decisions Max 2026-10-11 #4/#5):
// one page of platform_mail_log (platform admins only; addresses masked), the
// "Show address" reveal and the test mail. Writes go through server actions.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { revealMailRecipient, sendPlatformTestMail } from '@/features/platform/mail-log-actions';
import { poKeys } from './keys';

export interface PlatformMailLogEntry {
  id: string;
  type: string;
  status: string;
  errorCode: string | null;
  isTest: boolean;
  createdAt: string;
  venueId: string | null;
  venueName: string | null;
  eventName: string | null;
  /** Masked ("l***@g***.com"); null when no source links the address or it changed since. */
  recipient: string | null;
}

export interface PlatformMailLogParams {
  venueId?: string;
  type?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

const logKey = (params: PlatformMailLogParams) => [...poKeys.all, 'platform-mail-log', params] as const;

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

export function toPlatformMailLogEntry(raw: unknown): PlatformMailLogEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const type = str(r.type);
  const status = str(r.status);
  const createdAt = str(r.created_at);
  if (!id || !type || !status || !createdAt) return null;
  return {
    id,
    type,
    status,
    errorCode: str(r.error_code),
    isTest: r.is_test === true,
    createdAt,
    venueId: str(r.venue_id),
    venueName: str(r.venue_name),
    eventName: str(r.event_name),
    recipient: str(r.recipient),
  };
}

export async function fetchPlatformMailLog(
  params: PlatformMailLogParams,
): Promise<{ rows: PlatformMailLogEntry[]; total: number }> {
  const { data, error } = await createClient().rpc('platform_mail_log', {
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
    p_venue_id: params.venueId ?? undefined,
    p_type: params.type ?? undefined,
    p_status: params.status ?? undefined,
  });
  if (error) throw error;
  const j = (data ?? {}) as { total?: unknown; rows?: unknown };
  const rows = Array.isArray(j.rows) ? j.rows.map(toPlatformMailLogEntry).filter((e): e is PlatformMailLogEntry => !!e) : [];
  return { rows, total: typeof j.total === 'number' ? j.total : rows.length };
}

export function usePoPlatformMailLog(params: PlatformMailLogParams, enabled: boolean) {
  return useQuery({
    queryKey: logKey(params),
    enabled,
    queryFn: () => fetchPlatformMailLog(params),
  });
}

export function usePoRevealMailRecipient() {
  return useMutation({
    mutationFn: async (input: { mailLogId: string; ticket: string }) => {
      const res = await revealMailRecipient(input);
      if (!res.ok) throw new Error(res.message);
      return res.address;
    },
  });
}

export function usePoSendTestMail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { type: string; to: string }) => {
      const res = await sendPlatformTestMail(input);
      if (!res.ok) throw new Error(res.message);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: [...poKeys.all, 'platform-mail-log'] }),
  });
}
