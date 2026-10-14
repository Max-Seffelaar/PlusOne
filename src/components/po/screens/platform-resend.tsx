'use client';

/**
 * Platform → Invited → Resend with a cooldown (z8uq9m5m8h).
 *
 * The database allows one invite mail per address per minute
 * (`mail_recipient_window()`, PM429 → INVITE_RECENTLY_SENT_MESSAGE). After a
 * send, and after that "recent" refusal, the button stays disabled for the
 * seconds left with a visible countdown, and the refusal reads as a neutral
 * notice, not an error: nothing broke, the operator only has to wait.
 *
 * Client-only timing. The server stays the source of truth: a reload simply
 * re-enables the button and the server refuses as before. Nothing moves, so
 * there is nothing for prefers-reduced-motion to stop: only the number changes
 * (tabular figures, so the label does not jitter). Screen readers hear the
 * wait through a polite live region that changes once per 10 seconds, not
 * every second.
 */
import { type JSX, type ReactNode, useEffect, useRef, useState } from 'react';
import { t, fmt } from '@/lib/i18n';
import { INVITE_RECENTLY_SENT_MESSAGE } from '@/lib/db-errors';
import { usePoResendBetaInvite } from '@/features/po/mutations';
import { Btn } from '../kit';

/** Mirrors `mail_recipient_window()` (60 s). Only the client's estimate: the DB decides. */
export const RECIPIENT_WINDOW_MS = 60_000;
/** The live region speaks at most this often. */
const LIVE_STEP_S = 10;

/** True for the per-address "recent" refusal; the hourly budget and real failures stay errors. */
export function isRecentlySent(e: unknown): boolean {
  return e instanceof Error && e.message === INVITE_RECENTLY_SENT_MESSAGE;
}

function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : t.platform.loadError;
}

/** Seconds left until `until` (epoch ms); 0 when unset or passed. Ticks once a second. */
export function useCountdown(): { left: number; start: (until: number) => void } {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  useEffect(() => {
    if (left <= 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [left > 0]); // eslint-disable-line react-hooks/exhaustive-deps -- only (re)arm on start/stop
  return {
    left,
    start: (at: number) => {
      setNow(Date.now());
      setUntil(at);
    },
  };
}

/**
 * When the window for this address ends, after the server said "recent". The
 * row's `last_sent_at` is the best clue; if it points at the past or more than a
 * window ahead (a skewed clock, or a send that never touched this row), wait a
 * whole window.
 */
export function recentWindowEnd(lastSentAt: string, now = Date.now()): number {
  const end = Date.parse(lastSentAt) + RECIPIENT_WINDOW_MS;
  return Number.isFinite(end) && end > now && end <= now + RECIPIENT_WINDOW_MS ? end : now + RECIPIENT_WINDOW_MS;
}

/** The Resend button + its outcome line + the polite live region, for one open invite row. */
export function InviteResend({
  inviteId,
  lastSentAt,
  children,
  help,
}: {
  inviteId: string;
  lastSentAt: string;
  /** The rest of the action row, beside Resend (Stop following up). */
  children?: ReactNode;
  /** The help line under the row, above the outcome. */
  help?: ReactNode;
}): JSX.Element {
  const resend = usePoResendBetaInvite();
  const { left, start } = useCountdown();
  const counted = useRef(false);
  if (left > 0) counted.current = true;

  const onResend = (): void => {
    if (left > 0) return;
    resend.mutate(inviteId, {
      onSuccess: () => start(Date.now() + RECIPIENT_WINDOW_MS),
      onError: (e) => {
        if (isRecentlySent(e)) start(recentWindowEnd(lastSentAt));
      },
    });
  };

  // Rounded UP to the 10 s step, so 60 → 50 → … and never a "0 seconds".
  const liveSeconds = Math.ceil(left / LIVE_STEP_S) * LIVE_STEP_S;
  const live = left > 0 ? fmt(t.platform.resendWaitLive, { seconds: liveSeconds }) : counted.current ? t.platform.resendReadyLive : '';
  const recent = resend.isError && isRecentlySent(resend.error);

  return (
    <>
      <div className="mt-[11px] flex flex-wrap gap-2">
        <Btn
          kind="ghost"
          sm
          icon="refresh"
          className="min-h-[44px] tabular-nums"
          disabled={resend.isPending || left > 0}
          onClick={onResend}
        >
          {resend.isPending ? t.platform.resending : left > 0 ? fmt(t.platform.resendIn, { seconds: left }) : t.platform.resend}
        </Btn>
        {children}
      </div>
      {help}
      <span className="sr-only" aria-live="polite" data-testid="resend-live">
        {live}
      </span>
      {resend.isError &&
        (recent ? (
          <p className="mt-2 text-[12.5px] leading-[1.45] text-dim" role="status" data-tone="neutral">
            {errorText(resend.error)}
          </p>
        ) : (
          <p className="mt-2 text-[12.5px] leading-[1.45] text-red-300" role="alert">
            {errorText(resend.error)}
          </p>
        ))}
      {resend.isSuccess && !resend.isPending && (
        <p className="mt-2 text-[12.5px] leading-[1.45] text-acc" role="status">
          {resend.data?.message ?? ''}
        </p>
      )}
    </>
  );
}
