'use client';

/**
 * One row of the desktop cockpit's guest list, plus the two controls that sit at
 * its right edge. Extracted from `EventDayCockpit.tsx` (ADE UX round, item O) so
 * that file does not grow past its size line and so the row is unit-testable
 * without mounting the whole cockpit or its virtualizer.
 *
 * Rendering only: every action arrives as a callback from the cockpit, which
 * still owns the mutations, the toasts and the flash highlight.
 *
 * The check-in slot has three shapes, and which one you get is the whole point
 * of item O:
 *  - on the way        → ✓ button, "Check in"
 *  - partly inside     → ✓ button, "{x} of {y} inside · add more" (top-up)
 *  - fully inside      → a STATIC badge, not a button. There is nothing left to
 *                        check in, so a pressable ✓ was only ever an invitation
 *                        to a no-op toast. The badge keeps the same 40px
 *                        footprint so rows don't jump when a party completes.
 */
import { type JSX } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { Icon } from '@/components/po/icon';
import { Avatar, Btn, pressDesktop } from '@/components/po/kit';
import { tierInk, tintTier } from '@/lib/po/tier-colors';
import { formatDateTime } from '@/features/po/format';
import type { Guest } from '@/lib/po/types';

const press = pressDesktop;

/** Same box as `ChkBtn` so the row keeps its geometry when the party completes. */
const SLOT = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] border';

/**
 * Static "this party is fully inside" marker (ADE UX round, item O).
 *
 * Deliberately NOT a button: no `type="button"`, no click handler, no press
 * animation, default cursor. `role="img"` + an `aria-label` give screen readers
 * the same sentence a sighted host reads from the check mark, including the
 * arrival time when one is known (the event can cross midnight, so the caller
 * passes a date+time label, not a bare "23:07" — #26).
 */
export function InsideBadge({ at }: { at?: string }): JSX.Element {
  const label = at ? fmt(t.cockpit.insideBadgeSince, { time: at }) : t.cockpit.insideBadge;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(SLOT, 'cursor-default border-transparent bg-acc-dim text-acc')}
    >
      <Icon name="check" size={19} sw={2.4} />
    </span>
  );
}

export function ChkBtn({
  kind,
  active,
  disabled,
  /** kind='out' on a guest who isn't inside: the slot becomes "Refuse" instead
   *  of a no-op void (G2 door-parity) — same slot, no row-width growth. */
  refuse,
  /** Overrides the default tooltip. The ✓ on a partly-inside party uses it to
   *  say what pressing it does ("2 of 3 inside · add more"), item O. */
  title: titleOverride,
  onClick,
}: {
  kind: 'in' | 'out';
  active: boolean;
  disabled?: boolean;
  refuse?: boolean;
  title?: string;
  onClick: () => void;
}): JSX.Element {
  const isIn = kind === 'in';
  const title =
    titleOverride ??
    (isIn
      ? t.cockpit.checkInTitle
      : refuse
        ? t.cockpit.refuseRowTitle
        : disabled
          ? t.cockpit.checkOutDisabledTitle
          : t.cockpit.checkOutTitle);
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-pressed={active}
      title={title}
      className={cn(
        SLOT,
        !disabled && press,
        // Rows are now filled with the guest's tier colour (feedback Max
        // 13/7), so a transparent/outlined button all but disappears against
        // it — every non-disabled state needs an OPAQUE fill to stay legible
        // regardless of what colour is behind it. Check-in is always the
        // solid accent (the button to reach for); void/refuse is always a
        // solid neutral chip, clearly secondary.
        disabled
          ? 'cursor-not-allowed border-line bg-transparent text-ghost opacity-50'
          : isIn
            ? 'border-transparent bg-acc text-on-acc'
            : 'border-transparent bg-elev2 text-text',
      )}
    >
      <Icon name={disabled ? 'lock' : isIn ? 'check' : 'close'} size={isIn ? 19 : 16} sw={2.4} />
    </button>
  );
}

export function CockpitGuestRow({
  g,
  tierColor,
  tierName,
  arrival,
  flash,
  canCheckIn,
  allowUncheck,
  onCheckInClick,
  onVoid,
  onRefuseClick,
  onUndoRefuse,
}: {
  g: Guest;
  tierColor: string;
  tierName: string;
  arrival?: { arrived: number; at: string };
  flash: boolean;
  canCheckIn: boolean;
  allowUncheck: boolean;
  onCheckInClick: (g: Guest) => void;
  onVoid: (g: Guest) => void;
  onRefuseClick: (g: Guest) => void;
  onUndoRefuse: (g: Guest) => void;
}): JSX.Element {
  const isRefused = g.status === 'refused';
  const isIn = g.status === 'in';
  const arrivedCount = arrival ? arrival.arrived : g.plus;
  const partial = isIn && arrivedCount < g.plus;
  const fully = isIn && !partial;
  // Date + time (not just "18:07"): the event can cross midnight (#26),
  // so a bare time would make a post-midnight arrival read as earlier
  // than a 23:50 one.
  const atIso = arrival?.at ?? g.at;
  const atLabel = atIso ? formatDateTime(atIso) : undefined;
  // Whole-row tier fill (feedback Max 13/7 — matches the door's
  // CheckInList): a checked-in guest mutes to a low-alpha tint +
  // white ink so "inside" still reads as dimmed, everyone else gets
  // the solid tier colour. Refused rows opt out of the fill
  // entirely (mirrors the door/Guests-tab convention).
  const ink = isRefused ? undefined : fully ? '#FFFFFF' : tierInk(tierColor);
  return (
    <div
      className={cn(
        'grid grid-cols-[1fr_96px] items-center gap-3 rounded-[14px] px-[14px] py-[10px] transition-shadow duration-500',
        isRefused && 'border border-line2',
        flash && 'ring-2 ring-acc',
      )}
      style={
        isRefused
          ? undefined
          : {
              background: fully ? tintTier(tierColor, 0.14) : tierColor,
              ...(partial ? { boxShadow: 'inset 0 0 0 2px #B5A6FF' } : {}),
            }
      }
    >
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={g.name} size={36} accent={isIn} />
        <div className="min-w-0 flex-1" style={ink ? { color: ink } : undefined}>
          <div className="flex items-baseline gap-1.5">
            {g.flag === 'high' && (
              <Icon name="flag" size={13} stroke={ink ?? '#B5A6FF'} fill={ink ?? '#B5A6FF'} className="shrink-0" />
            )}
            <span className="truncate font-display text-[15px] font-bold">
              {g.name}
              {g.plus > 0 && <span className="font-semibold opacity-80"> +{g.plus}</span>}
            </span>
          </div>
          <div
            className={cn(
              'truncate text-[11px] font-bold uppercase tracking-[0.03em]',
              isRefused ? 'text-faint normal-case' : 'opacity-80',
            )}
          >
            {isRefused
              ? t.cockpit.rowRefused
              : partial
                ? fmt(t.cockpit.rowInsidePartial, { arrived: arrivedCount + 1, total: g.plus + 1 })
                : fully && atLabel
                  ? `${tierName} · ${atLabel}`
                  : tierName}
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-[7px]">
        {!canCheckIn ? (
          <span className="text-[11px] opacity-60" style={ink ? { color: ink } : undefined}>
            —
          </span>
        ) : isRefused ? (
          <Btn desktop kind="ghost" sm onClick={() => onUndoRefuse(g)}>
            {t.door.undo}
          </Btn>
        ) : (
          <>
            {fully ? (
              <InsideBadge at={atLabel} />
            ) : (
              <ChkBtn
                kind="in"
                active={isIn}
                title={
                  partial
                    ? fmt(t.cockpit.checkInTopUpTitle, { arrived: arrivedCount + 1, total: g.plus + 1 })
                    : undefined
                }
                onClick={() => onCheckInClick(g)}
              />
            )}
            <ChkBtn
              kind="out"
              active={!isIn}
              disabled={isIn && !allowUncheck}
              refuse={!isIn}
              onClick={() => (isIn ? onVoid(g) : onRefuseClick(g))}
            />
          </>
        )}
      </div>
    </div>
  );
}
