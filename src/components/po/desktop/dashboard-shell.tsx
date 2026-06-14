'use client';

/** Real desktop dashboard shell (PLUSONE design, from `dash.jsx`): sidebar with
 *  the venue switcher, role-aware nav linking to the REAL pages, and the real
 *  user + sign-out. Replaces the old top-nav so every admin screen lives in one
 *  consistent surface. */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Avatar, Label } from '../kit';
import { Icon, type IconName } from '../icon';
import { SignOutButton } from '@/features/auth/components/SignOutButton';
import { setActiveVenueAction } from '@/features/venues/actions';

const press = 'transition-[filter,transform,background,border-color,color] hover:brightness-[1.08] active:scale-[0.985]';

export interface ShellNavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Not built yet (fase 6/10): shown greyed with a "binnenkort" tag, not a link. */
  soon?: boolean;
}

export interface ShellVenue {
  venueId: string;
  venueName: string;
}

// ── Venue switcher with an explicit confirmation step (decision #1) ───────────
function VenueSwitcher({
  venues,
  activeVenueId,
}: {
  venues: ShellVenue[];
  activeVenueId: string | null;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<ShellVenue | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const active = venues.find((v) => v.venueId === activeVenueId) ?? venues[0];
  const multi = venues.length > 1;

  return (
    <div className="relative mb-[18px]">
      <button
        type="button"
        onClick={() => multi && setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center gap-[10px] rounded-[12px] border border-line bg-elev p-[10px] text-left text-text',
          multi ? press : 'cursor-default'
        )}
      >
        <Avatar name={active?.venueName ?? 'PLUSONE'} size={30} accent />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[14px] font-bold">{active?.venueName ?? 'Venue'}</div>
          <div className="text-[11px] text-faint">{multi ? `${venues.length} venues` : 'Actieve venue'}</div>
        </div>
        {multi && <Icon name="chevD" size={16} className="text-ghost" />}
      </button>

      {open && multi && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 rounded-[14px] border border-line bg-elev2 p-2 shadow-xl">
          {confirm ? (
            <div className="p-2">
              <p className="text-[13.5px] font-semibold text-text">Wisselen naar {confirm.venueName}?</p>
              <p className="mt-1 text-[12px] leading-[1.45] text-faint">
                Het hele dashboard schakelt over naar deze venue.
              </p>
              <form ref={formRef} action={setActiveVenueAction} className="mt-3 flex gap-2">
                <input type="hidden" name="venueId" value={confirm.venueId} />
                <button type="submit" className="btn-primary flex-1 text-sm">
                  Wisselen
                </button>
                <button
                  type="button"
                  className="btn-ghost text-sm"
                  onClick={() => {
                    setConfirm(null);
                    setOpen(false);
                  }}
                >
                  Annuleren
                </button>
              </form>
            </div>
          ) : (
            <ul className="flex flex-col">
              {venues.map((v) => {
                const on = v.venueId === active?.venueId;
                return (
                  <li key={v.venueId}>
                    <button
                      type="button"
                      onClick={() => (on ? setOpen(false) : setConfirm(v))}
                      className={cn(
                        'flex w-full items-center gap-[10px] rounded-[10px] px-2 py-[9px] text-left text-[13.5px]',
                        press,
                        on ? 'text-acc' : 'text-dim hover:bg-elev hover:text-text'
                      )}
                    >
                      <Avatar name={v.venueName} size={26} accent={on} />
                      <span className="min-w-0 flex-1 truncate font-semibold">{v.venueName}</span>
                      {on && <Icon name="check" size={15} sw={2.4} stroke="#B5A6FF" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function NavLinks({ items }: { items: ShellNavItem[] }): JSX.Element {
  const pathname = usePathname();
  return (
    <div className="flex flex-col gap-[3px]">
      {items.map((it) => {
        if (it.soon) {
          return (
            <span
              key={it.label}
              className="flex w-full cursor-default items-center gap-3 rounded-[12px] px-3 py-[11px] font-display text-[14.5px] font-bold text-ghost"
            >
              <Icon name={it.icon} size={19} sw={1.9} />
              {it.label}
              <span className="ml-auto rounded-full border border-line2 px-[7px] py-[2px] text-[10px] font-bold text-faint">
                binnenkort
              </span>
            </span>
          );
        }
        const on = pathname === it.href;
        return (
          <Link
            key={it.label}
            href={it.href}
            className={cn(
              'flex w-full items-center gap-3 rounded-[12px] px-3 py-[11px] font-display text-[14.5px] font-bold',
              on ? 'bg-acc-dim text-acc' : 'text-dim transition-colors hover:bg-elev hover:text-text'
            )}
          >
            <Icon name={it.icon} size={19} sw={on ? 2.2 : 1.9} />
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}

export function DashboardShell({
  userName,
  roleLine,
  venues,
  activeVenueId,
  navItems,
  children,
}: {
  userName: string;
  roleLine: string;
  venues: ShellVenue[];
  activeVenueId: string | null;
  navItems: ShellNavItem[];
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="bg-bg text-text flex h-[100dvh] overflow-hidden">
      <aside className="border-line2 bg-bg flex w-[250px] shrink-0 flex-col border-r px-4 py-[22px]">
        <Link href="/dashboard" className="flex items-center gap-[11px] px-2 pb-[22px]">
          <div className="bg-acc text-on-acc font-display flex h-9 w-9 items-center justify-center rounded-[11px] text-[17px] font-extrabold tracking-[-0.03em]">
            +1
          </div>
          <div className="font-display text-text text-[19px] font-extrabold tracking-[-0.02em]">plusone</div>
        </Link>

        {venues.length > 0 && <VenueSwitcher venues={venues} activeVenueId={activeVenueId} />}

        <Label className="px-[10px] pb-2">Beheer</Label>
        <NavLinks items={navItems} />

        <div className="flex-1" />

        <Link
          href="/settings/profile"
          className={cn('border-line bg-elev flex items-center gap-[11px] rounded-[12px] border p-[10px]', press)}
        >
          <Avatar name={userName} size={34} />
          <div className="min-w-0 flex-1">
            <div className="font-display overflow-hidden text-ellipsis whitespace-nowrap text-[13.5px] font-bold">
              {userName}
            </div>
            <div className="text-faint flex items-center gap-1 text-[11px]">{roleLine}</div>
          </div>
        </Link>
        <div className="mt-2 flex justify-end">
          <SignOutButton />
        </div>
      </aside>

      <main className="po-scroll min-h-0 flex-1 overflow-y-auto px-8 py-8">{children}</main>
    </div>
  );
}
