'use client';

/**
 * App shell: bottom tab bar, accent toast, bottom-sheet modal.
 */
import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Icon, type IconName } from './icon';
import { Btn } from './kit';

export type TabKey = 'start' | 'events' | 'guests' | 'deur' | 'meer';

const TABS: [TabKey, string, IconName][] = [
  ['start', t.nav.home, 'grid'],
  ['events', t.nav.events, 'cal'],
  ['guests', t.nav.guests, 'user'],
  ['deur', t.nav.door, 'door'],
  ['meer', t.nav.more, 'cog'],
];

export function TabBar({
  tab,
  setTab,
  badges,
  show,
}: {
  tab: TabKey;
  setTab: (t: TabKey) => void;
  badges?: Partial<Record<TabKey, number>>;
  /** Which tabs to render (default: all). Lets non-door roles hide Deur/Taken. */
  show?: readonly TabKey[];
}): JSX.Element {
  const tabs = show ? TABS.filter(([k]) => show.includes(k)) : TABS;
  return (
    <div
      className="flex flex-none border-t border-line2 bg-[rgba(11,11,13,0.9)] px-[14px] pt-2 backdrop-blur-[12px]"
      style={{ paddingBottom: 'calc(14px + env(safe-area-inset-bottom))' }}
    >
      {tabs.map(([k, l, ic]) => {
        const on = tab === k;
        const badge = badges?.[k];
        return (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn('flex flex-1 cursor-pointer flex-col items-center gap-1 border-none bg-transparent py-1 transition-[filter] hover:brightness-[1.07]', on ? 'text-acc' : 'text-faint')}
          >
            <span className="relative">
              <Icon name={ic} size={22} sw={on ? 2.2 : 1.9} />
              {badge ? (
                <span className="absolute -right-[9px] -top-[5px] flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-bg bg-acc px-1 font-display text-[10px] font-extrabold text-on-acc">
                  {badge}
                </span>
              ) : null}
            </span>
            <span className="font-body text-[11px] font-bold">{l}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Toast({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="po-anim-toast absolute inset-x-4 bottom-[26px] z-20 rounded-[16px] bg-acc p-[15px] text-center font-display text-[15px] font-bold text-on-acc shadow-[0_16px_40px_rgba(0,0,0,0.4)]">
      {children}
    </div>
  );
}

/** Bottom-sheet modal. `center` matches the prototype's centered "Let op!" sheet;
 *  pass `center={false}` for left-aligned content (event picker, assign sheet). */
export function Sheet({ onClose, children, center = true }: { onClose: () => void; children: ReactNode; center?: boolean }): JSX.Element {
  return (
    <div className="po-anim-fade absolute inset-0 z-40 flex items-end justify-center bg-[rgba(6,6,8,0.66)] p-4 backdrop-blur-[3px]" onClick={onClose}>
      <div
        className={cn(
          // max-h + overflow: tall content (e.g. the inline create-a-tier form in
          // the add-to-event sheet) scrolls inside the sheet instead of spilling
          // past the top of the screen (retest 3/7).
          'po-anim-sheet flex max-h-full w-full flex-col overflow-y-auto rounded-sheet border border-line bg-elev p-[22px] shadow-[0_-20px_60px_rgba(0,0,0,0.5)]',
          center ? 'items-center text-center' : 'items-stretch text-left',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * FE-4: the "title + body + 2 buttons" confirm-dialog skeleton reinvented as
 * `ForgetConfirmSheet`/`PermanentConfirmSheet` (guests/profile.tsx) — the icon
 * badge + title header and the confirm/cancel button pair are identical each
 * time, so those are the ONLY parts this owns; everything between (body copy,
 * a Note, an error line) stays screen-specific via `children`.
 */
export function ConfirmSheet({
  icon,
  iconFilled,
  tone = 'accent',
  title,
  children,
  confirmLabel,
  confirmIcon,
  confirmDisabled,
  onConfirm,
  cancelLabel,
  onClose,
}: {
  icon: IconName;
  /** Solid fill instead of outline (e.g. the "make permanent" star). */
  iconFilled?: boolean;
  tone?: 'accent' | 'danger';
  title: ReactNode;
  children?: ReactNode;
  confirmLabel: ReactNode;
  confirmIcon?: IconName;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  cancelLabel: string;
  onClose: () => void;
}): JSX.Element {
  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-3 flex items-center gap-[12px]">
        <span
          className={cn(
            'flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[13px]',
            tone === 'danger' ? 'bg-red-500/15 text-red-300' : 'bg-acc-dim text-acc',
          )}
        >
          <Icon name={icon} size={22} stroke="currentColor" fill={iconFilled ? 'currentColor' : 'none'} />
        </span>
        <div className="font-display text-[18px] font-bold text-text">{title}</div>
      </div>
      {children}
      <Btn
        full
        kind={tone === 'danger' ? 'danger' : 'primary'}
        icon={confirmIcon ?? icon}
        className={cn('mt-4', tone === 'danger' && 'disabled:opacity-60')}
        disabled={confirmDisabled}
        onClick={onConfirm}
      >
        {confirmLabel}
      </Btn>
      <Btn full kind="ghost" className="mt-2" onClick={onClose}>
        {cancelLabel}
      </Btn>
    </Sheet>
  );
}

/** Sticky action bar pinned to the bottom of a screen (above the tab bar / safe area). */
export function BottomBar({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex-none border-t border-line2 bg-bg px-4 pt-3" style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}>
      {children}
    </div>
  );
}
