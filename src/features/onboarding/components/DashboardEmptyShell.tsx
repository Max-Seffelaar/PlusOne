import Link from 'next/link';
import { Icon, type IconName } from '@/components/po/icon';
import { Avatar } from '@/components/po/kit';
import { SignOutButton } from '@/features/auth/components/SignOutButton';
import { FirstEventEmpty } from './FirstEventEmpty';

export interface DashboardNavItem {
  href: string;
  label: string;
  icon: IconName;
  active?: boolean;
}

// The post-onboarding landing for a venue with no events yet: the real dashboard
// shell (sidebar menu + topbar) around the "maak je eerste event" empty state, so
// a new owner can immediately reach events, team invites and venue settings — not
// a bare full-screen page (#40d). The nav links to the real routes; unifying those
// admin pages into this sidebar look is the dashboard live-wiring phase.
export function DashboardEmptyShell({
  venueName,
  userName,
  nav,
}: {
  venueName: string;
  userName: string;
  nav: DashboardNavItem[];
}): JSX.Element {
  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <aside className="flex h-full w-[250px] shrink-0 flex-col border-r border-line2 bg-bg px-4 py-[22px]">
        <div className="flex items-center gap-[11px] px-2 pb-[22px]">
          <div className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-acc font-display text-[17px] font-extrabold tracking-[-0.03em] text-on-acc">
            +1
          </div>
          <div className="font-display text-[19px] font-extrabold tracking-[-0.02em] text-text">
            plusone
          </div>
        </div>

        <Link
          href="/admin/venue"
          className="mb-[18px] flex w-full items-center gap-[10px] rounded-[12px] border border-line bg-elev p-[10px] text-left text-text transition-[filter,transform] hover:brightness-[1.08] active:scale-[0.985]"
        >
          <Avatar name={venueName} size={30} accent />
          <div className="min-w-0 flex-1">
            <div className="overflow-hidden text-ellipsis whitespace-nowrap font-display text-[14px] font-bold">
              {venueName}
            </div>
            <div className="text-[11px] text-faint">Venue beheren</div>
          </div>
          <Icon name="chevD" size={16} className="text-ghost" />
        </Link>

        <div className="px-[10px] pb-2 font-body text-[12px] font-bold uppercase tracking-[0.04em] text-faint">
          Menu
        </div>
        <nav className="flex flex-col gap-[3px]">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={[
                'flex w-full items-center gap-3 whitespace-nowrap rounded-[12px] px-3 py-[11px] text-left font-display text-[14.5px] font-bold',
                item.active
                  ? 'bg-acc-dim text-acc'
                  : 'bg-transparent text-dim transition-colors hover:bg-elev hover:text-text',
              ].join(' ')}
            >
              <Icon name={item.icon} size={19} sw={item.active ? 2.2 : 1.9} />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex-1" />
        <div className="flex items-center gap-[11px] rounded-[12px] border border-line bg-elev p-[10px]">
          <Avatar name={userName} size={34} />
          <div className="min-w-0 flex-1">
            <div className="overflow-hidden text-ellipsis whitespace-nowrap font-display text-[13.5px] font-bold">
              {userName}
            </div>
            <div className="flex items-center gap-1 text-[11px] text-faint">
              <Icon name="shield" size={11} stroke="#B5A6FF" />
              Admin
            </div>
          </div>
          <SignOutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-[18px] border-b border-line2 px-[34px] py-[22px]">
          <div className="min-w-0 flex-1">
            <h1 className="m-0 font-display text-[26px] font-extrabold tracking-[-0.02em] text-text">
              Dashboard
            </h1>
            <div className="mt-[3px] text-[13.5px] text-faint">{venueName}</div>
          </div>
          <Link
            href="/events/new"
            className="inline-flex items-center gap-2 rounded-[12px] border border-transparent bg-acc px-[18px] py-[12px] font-display text-[15px] font-bold tracking-[-0.01em] text-on-acc transition-[filter,transform] hover:brightness-[1.08] active:scale-[0.985]"
          >
            <Icon name="cal" size={18} sw={2.1} />
            Nieuw event
          </Link>
        </div>
        <div className="po-screen-anim min-h-0 flex-1 overflow-y-auto">
          <FirstEventEmpty venueName={venueName} />
        </div>
      </div>
    </div>
  );
}
