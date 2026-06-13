'use client';

/** Desktop-only primitives (from `dash.jsx`). Reuses Icon/Avatar/Label from the
 *  shared kit; desktop Btn/Card/chips differ slightly in radius + sizing. */
import type { ReactNode } from 'react';
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
