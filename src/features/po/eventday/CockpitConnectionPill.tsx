'use client';

/**
 * Connection pill in the desktop Check-in cockpit header (z8uq9m0hw4) — the
 * cockpit's counterpart of the mobile door's SyncBar dot: same kit `SyncDot`,
 * same `deriveSyncStatus` semantics (via ./cockpitConnection), fed by the
 * cockpit's own realtime channel + query freshness. Visible in every phase, so
 * a doorhost setting up before doors can see the screen is connected.
 *
 * Its own component (sibling of the 1100-line cockpit) so the 15s clock tick
 * that ages the status re-renders only this pill, never the virtualised list.
 */
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { fmt, t } from '@/lib/i18n';
import { SYNC_STATUS_COLOR, SyncDot } from '@/components/po/kit';
import { cockpitConnection, type CockpitConnectionKind } from './cockpitConnection';

// Same cadence as the door's SyncBar clock (useDoorSync TICK_MS).
const TICK_MS = 15_000;

const LABEL: Record<CockpitConnectionKind, string> = {
  live: t.cockpit.connLive,
  stale: t.cockpit.connStale,
  offline: t.cockpit.connOffline,
  warn: t.cockpit.connWarn,
};
const HINT: Record<CockpitConnectionKind, string> = {
  live: t.cockpit.connLiveHint,
  stale: t.cockpit.connStaleHint,
  offline: t.cockpit.connOfflineHint,
  warn: t.cockpit.connWarnHint,
};

export function CockpitConnectionPill({
  online,
  realtimeConnected,
  lastSyncAt,
}: {
  online: boolean;
  realtimeConnected: boolean;
  /** Oldest successful load across the cockpit's tracked reads (useCockpitSync). */
  lastSyncAt: number | null;
}): JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  // A fresh sync must not wait up to a tick to turn the pill green.
  useEffect(() => setNow(Date.now()), [lastSyncAt, realtimeConnected, online]);

  const { status, kind } = cockpitConnection({ online, realtimeConnected, lastSyncAt, now });
  const label = LABEL[kind];
  return (
    <span
      role="status"
      aria-label={fmt(t.cockpit.connAria, { state: label })}
      title={HINT[kind]}
      className="inline-flex h-[40px] items-center gap-[9px] whitespace-nowrap rounded-full border border-line bg-elev px-[14px] font-body text-[12.5px] font-bold"
      style={kind === 'warn' ? { color: SYNC_STATUS_COLOR.warn } : undefined}
    >
      <SyncDot status={status} />
      <span className={kind === 'warn' ? undefined : 'text-dim'}>{label}</span>
    </span>
  );
}
