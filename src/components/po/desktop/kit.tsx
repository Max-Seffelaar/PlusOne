'use client';

/** Desktop-only primitives (from `dash.jsx`). Reuses Icon/Avatar/Label from the
 *  shared kit; desktop Btn/Card/chips differ slightly in radius + sizing. */
import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Icon, type IconName } from '../icon';

const press = 'transition-[filter,transform,background,border-color,color] hover:brightness-[1.08] active:scale-[0.985]';

type DKind = 'primary' | 'dark' | 'ghost';
const DK: Record<DKind, string> = {
  primary: 'bg-acc text-on-acc border-transparent',
  dark: 'bg-elev2 text-text border-line',
  ghost: 'bg-transparent text-text border-line',
};

export function DBtn({ children, kind = 'primary', icon, onClick, sm, className }: { children: ReactNode; kind?: DKind; icon?: IconName; onClick?: () => void; sm?: boolean; className?: string }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-[12px] border font-display font-bold tracking-[-0.01em]', press, sm ? 'px-[14px] py-[9px] text-[13.5px]' : 'px-[18px] py-[12px] text-[15px]', DK[kind], className)}
    >
      {icon && <Icon name={icon} size={sm ? 16 : 18} sw={2.1} />}
      {children}
    </button>
  );
}

export function DCard({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={cn('rounded-[20px] border border-line bg-elev transition-colors', className)}>{children}</div>;
}

const ACTION_LABEL: Record<string, string> = {
  check_in: 'Check-in',
  refuse: 'Weigering',
  tier_change: 'Tier',
  lock: 'Lock',
  unlock: 'Unlock',
  quota_grant: 'Quotum',
  create: 'Toegevoegd',
  delete: 'Verwijderd',
  approve: 'Goedgekeurd',
  deny: 'Afgewezen',
  update: 'Wijziging',
};
const ACCENT_ACTIONS = ['check_in', 'quota_grant', 'approve', 'tier_change'];

export function ActionChip({ action }: { action: string }): JSX.Element {
  const accent = ACCENT_ACTIONS.includes(action);
  return (
    <span className={cn('inline-flex items-center rounded-[7px] border px-[9px] py-1 font-body text-[11px] font-bold uppercase tracking-[0.03em]', accent ? 'border-transparent bg-acc-dim text-acc' : 'border-line text-dim')}>
      {ACTION_LABEL[action] ?? action}
    </span>
  );
}

export function Tag({ t, acc }: { t: string; acc?: boolean }): JSX.Element {
  return <span className={cn('rounded-[8px] border px-[11px] py-[5px] font-display text-[11.5px] font-bold', acc ? 'border-transparent bg-acc-dim text-acc' : 'border-line bg-elev2 text-dim')}>{t}</span>;
}

/** Small round approve/reject button used in the dashboard approvals summary. */
export function MiniIconBtn({ name, accent, stroke }: { name: IconName; accent?: boolean; stroke?: string }): JSX.Element {
  return (
    <button type="button" className={cn('flex h-[30px] w-[30px] items-center justify-center rounded-[9px] border', press, accent ? 'border-transparent bg-acc' : 'border-line bg-transparent')}>
      <Icon name={name} size={accent ? 15 : 14} sw={accent ? 2.4 : 1.9} stroke={stroke ?? (accent ? '#16132B' : 'rgba(255,255,255,0.40)')} />
    </button>
  );
}

// ── Modal (centered overlay) ──────────────────────────────────────────────────
/** Dark centered modal for desktop panels (new event / new guest / event edit).
 *  Closes on backdrop click and Escape; the body is the polished elev surface. */
export function DModal({
  title,
  sub,
  onClose,
  children,
  footer,
  width = 520,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6 po-screen-anim"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-[20px] border border-line bg-elev shadow-2xl"
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-start gap-3 border-b border-line2 px-6 py-5">
          <div className="min-w-0 flex-1">
            <div className="font-display text-[20px] font-extrabold tracking-[-0.02em] text-text">{title}</div>
            {sub && <div className="mt-0.5 text-[13px] text-faint">{sub}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Sluiten"
            className={cn('flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border border-line bg-transparent text-faint', press)}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-[10px] border-t border-line2 px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

// ── Form field labels + inputs (dark) ──────────────────────────────────────────
/** Uppercase field label, matching the prototype's `Label` but local to forms. */
export function DFieldLabel({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={cn('mb-2 font-body text-[12px] font-bold uppercase tracking-[0.04em] text-faint', className)}>{children}</div>;
}

const inputBase =
  'w-full rounded-[12px] border border-line bg-elev2 px-[14px] py-[11px] text-[14.5px] text-text outline-none transition-colors placeholder:text-faint focus:border-acc';

/** Text input in the dark desktop style. */
export function DInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  inputMode,
  onEnter,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  inputMode?: 'text' | 'numeric' | 'email' | 'tel';
  onEnter?: () => void;
  className?: string;
}): JSX.Element {
  return (
    <input
      value={value}
      autoFocus={autoFocus}
      inputMode={inputMode}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onEnter ? (e) => e.key === 'Enter' && onEnter() : undefined}
      placeholder={placeholder}
      className={cn(inputBase, className)}
    />
  );
}

/** datetime-local input in the dark desktop style (dark color-scheme). */
export function DDateTime({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}): JSX.Element {
  return (
    <input
      type="datetime-local"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(inputBase, '[color-scheme:dark]', className)}
    />
  );
}
