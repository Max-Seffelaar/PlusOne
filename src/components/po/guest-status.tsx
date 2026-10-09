/** The /s/[token] guest status page (Gastcommunicatie F, z8uq9m2vpy): the
 *  "Check your status" button in every guest mail with a spot.
 *
 *  view=null is the neutral not-found (the /r/[token] rule): an invalid,
 *  expired, anonymized or throttled token all render the identical "Nothing
 *  here." with no event info. A found token shows the event, where the spot
 *  stands (on the list / in / off the list / event canceled), the spot itself
 *  while it holds, the house rules, the calendar links and the company's
 *  guest-facing contact. Every value is a React text node, never HTML. No
 *  hooks: renders on the server. Bearer URL, so outbound links carry
 *  `noreferrer`. */
import type { JSX, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { fmt, t } from '@/lib/i18n';
import type { GuestStatusView } from '@/features/mail/guest-status-view';
import { googleCalendarUrl } from '@/features/mail/ics';
import { guestMailShared } from '@/features/mail/templates/guest-copy';
import { Icon, type IconName } from './icon';
import { LandingFooter, LandingWrap } from './landing-frame';

function MetaChip({ icon, children }: { icon: IconName; children: ReactNode }): JSX.Element {
  return (
    <div className="inline-flex max-w-full items-start gap-[7px] rounded-[11px] border border-line bg-elev px-[13px] py-2 text-left text-[13px] font-semibold leading-[1.35] text-dim">
      <Icon name={icon} size={15} className="mt-px shrink-0 text-faint" />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

const linkClass =
  'inline-flex min-h-[44px] items-center gap-[6px] rounded-[10px] px-1 font-display text-[13.5px] font-bold text-acc underline-offset-2 hover:underline';

const CHANNEL_LABEL = {
  phone: () => t.guestStatus.channelPhone,
  instagram: () => t.guestStatus.channelInstagram,
  facebook: () => t.guestStatus.channelFacebook,
  snapchat: () => t.guestStatus.channelSnapchat,
  tiktok: () => t.guestStatus.channelTiktok,
} as const;

export function GuestStatus({ view, icsHref }: { view: GuestStatusView | null; icsHref: string }): JSX.Element {
  if (!view) {
    return (
      <LandingWrap>
        <div className="rounded-[24px] border border-line bg-elev px-[26px] py-[34px] text-center">
          <div className="mx-auto mb-5 flex h-[62px] w-[62px] items-center justify-center rounded-[20px] bg-elev2">
            <Icon name="warn" size={30} className="text-faint" />
          </div>
          <h1 className="m-0 mb-[10px] font-display text-[26px] font-extrabold tracking-[-0.02em]">{t.landing.statusNotFoundTitle}</h1>
        </div>
        <LandingFooter />
      </LandingWrap>
    );
  }

  const g = t.guestStatus;
  const holds = view.state === 'on_list' || view.state === 'checked_in';
  const head = {
    on_list: { icon: 'check2' as IconName, on: true, title: g.onListTitle, body: g.onListBody },
    checked_in: { icon: 'check2' as IconName, on: true, title: g.checkedInTitle, body: g.checkedInBody },
    off_list: { icon: 'warn' as IconName, on: false, title: g.offListTitle, body: g.offListBody },
    canceled: { icon: 'warn' as IconName, on: false, title: g.canceledTitle, body: g.canceledBody },
  }[view.state];

  return (
    <LandingWrap>
      <div className="mb-[22px] text-center">
        <h1 className="m-0 break-words font-display text-[40px] font-extrabold leading-[0.98] tracking-[-0.03em]">{view.eventName}</h1>
        <div className="mt-[12px] flex flex-wrap items-center justify-center gap-[8px]">
          <MetaChip icon="cal">{view.date}</MetaChip>
          {view.time && <MetaChip icon="clock">{view.time}</MetaChip>}
          {view.location && <MetaChip icon="pin">{view.location}</MetaChip>}
        </div>
      </div>

      <div data-testid="guest-status" data-state={view.state} className="rounded-[24px] border border-line bg-elev px-[26px] py-[30px] text-center">
        <div className={cn('mx-auto mb-5 flex h-[62px] w-[62px] items-center justify-center rounded-[20px]', head.on ? 'bg-acc' : 'bg-elev2')}>
          <Icon name={head.icon} size={30} stroke={head.on ? '#16132B' : undefined} className={head.on ? undefined : 'text-faint'} sw={head.on ? 2.4 : undefined} />
        </div>
        <h2 className="m-0 mb-[10px] font-display text-[26px] font-extrabold tracking-[-0.02em]">{head.title}</h2>
        {view.firstName && <p className="m-0 text-[15px] font-bold text-text">{view.firstName}</p>}
        {view.spotLine && <p className="mx-auto mt-[6px] max-w-[330px] text-[15px] leading-[1.55] text-text">{view.spotLine}</p>}
        {view.priceLine && <p className="mx-auto mt-[4px] max-w-[330px] text-[13.5px] leading-[1.5] text-dim">{view.priceLine}</p>}
        <p className="mx-auto mt-[10px] max-w-[330px] text-[15px] leading-[1.55] text-dim">{head.body}</p>

        {view.houseRules && (
          <div className="mt-[20px] rounded-[14px] border border-line bg-elev2 px-4 py-[13px] text-left">
            <div className="mb-[6px] font-body text-[11.5px] font-bold uppercase tracking-[0.04em] text-faint">{g.houseRulesLabel}</div>
            <p className="m-0 whitespace-pre-line break-words text-[14.5px] leading-[1.5] text-text">{view.houseRules}</p>
          </div>
        )}

        {holds && (
          <div className="mt-[18px] text-left">
            <div className="mb-1 font-body text-[11.5px] font-bold uppercase tracking-[0.04em] text-faint">{g.calendarLabel}</div>
            <div className="flex flex-wrap gap-x-4">
              <a href={icsHref} className={linkClass} rel="noreferrer">
                <Icon name="cal" size={15} />
                {guestMailShared.calendarIcs}
              </a>
              <a href={googleCalendarUrl(view.calendar)} className={linkClass} target="_blank" rel="noopener noreferrer">
                <Icon name="cal" size={15} />
                {guestMailShared.calendarGoogle}
              </a>
            </div>
          </div>
        )}
      </div>

      {(view.contactEmail || view.channels.length > 0 || view.website) && (
        <div className="mt-[14px] rounded-[20px] border border-line bg-elev px-[22px] py-[18px] text-left">
          <div className="mb-[6px] font-body text-[11.5px] font-bold uppercase tracking-[0.04em] text-faint">{g.contactLabel}</div>
          {view.contactEmail && (
            <p className="m-0 break-words text-[14.5px] leading-[1.5] text-text">
              {fmt(g.contactBody, { company: view.company, contact_email: view.contactEmail })}
            </p>
          )}
          {(view.channels.length > 0 || view.website) && (
            <ul className="m-0 mt-[8px] list-none p-0">
              {view.channels.map((c) => (
                <li key={c.key} className="text-[13.5px] leading-[1.7] text-dim">
                  <span className="text-faint">{CHANNEL_LABEL[c.key]()}: </span>
                  <span className="break-words text-text">{c.value}</span>
                </li>
              ))}
              {view.website && (
                <li className="text-[13.5px] leading-[1.7] text-dim">
                  <a href={view.website} className={linkClass} target="_blank" rel="noopener noreferrer">
                    {g.channelWebsite}
                  </a>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
      <LandingFooter />
    </LandingWrap>
  );
}
