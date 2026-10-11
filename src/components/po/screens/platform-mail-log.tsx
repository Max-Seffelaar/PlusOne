'use client';

/**
 * Platform > Mail log (ClickUp z8uq9m49k1, decisions Max 2026-10-11 #4/#5):
 * every mail PlusOne sent (guest, team, billing, invites, digests) with type,
 * company, event where known, time and status; and a test of any template.
 *
 * Security shape:
 *  - Gated on usePoIsPlatformAdmin() for the UI; the boundary is the RPCs
 *    (platform_mail_log / platform_reveal_mail_recipient / log_platform_test_mail
 *    raise 42501 for anyone else).
 *  - Addresses are masked by the database. "Show address" asks for a ticket
 *    reference first and the reveal writes a platform_access_log row (CLAUDE.md
 *    decision 8: full addresses only for a concrete support ticket).
 *  - Read-only otherwise. Windowed (50 per page) with the total.
 *
 * Capacitor (#37): client-side reads, writes through server actions, no
 * browser-only API, nothing door-adjacent, no billing purchase UI.
 */
import { type JSX, useState } from 'react';
import { fmt, t } from '@/lib/i18n';
import { usePoIsPlatformAdmin, usePoPlatformVenueOptions } from '@/features/po/hooks';
import {
  type PlatformMailLogEntry,
  usePoPlatformMailLog,
  usePoRevealMailRecipient,
  usePoSendTestMail,
  usePoTestMailRecipients,
} from '@/features/po/platform-mail-log';
import { LOG_ONLY_MAIL_TYPES, MAIL_LOG_STATUSES, MAIL_TYPE_GROUPS } from '@/lib/mail-type-groups';
import { formatWhen } from '@/features/audit/translate';
import { useNav } from '../context';
import { Btn, Empty, Field, Label, Note, PageNav, Scroll, Select, Top } from '../kit';
import { Sheet } from '../shell';

const col = 'flex h-full flex-col';
const PAGE_SIZE = 50;

const ALL_TYPES = [...Object.values(MAIL_TYPE_GROUPS).flat(), ...LOG_ONLY_MAIL_TYPES];

function statusLabel(status: string): string {
  const p = t.platform;
  switch (status) {
    case 'queued':
      return p.mailLogStatusQueued;
    case 'sent':
      return p.mailLogStatusSent;
    case 'delivered':
      return p.mailLogStatusDelivered;
    case 'delivery_delayed':
      return p.mailLogStatusDelayed;
    case 'bounced':
      return p.mailLogStatusBounced;
    case 'complained':
      return p.mailLogStatusComplained;
    default:
      return p.mailLogStatusFailed;
  }
}

export function PlatformMailLog(): JSX.Element {
  const nav = useNav();
  const isPlatformAdmin = usePoIsPlatformAdmin();
  if (!isPlatformAdmin) {
    return (
      <div className={col}>
        <Top big title={t.platform.mailLogTitle} onBack={nav.canGoBack ? nav.back : undefined} />
        <Scroll bottom={90}>
          <Empty text={t.platform.notAvailable} />
        </Scroll>
      </div>
    );
  }
  return <MailLogConsole />;
}

function MailLogConsole(): JSX.Element {
  const nav = useNav();
  const p = t.platform;
  const [venueId, setVenueId] = useState<string | undefined>();
  const [type, setType] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [page, setPage] = useState(0);
  const [reveal, setReveal] = useState<PlatformMailLogEntry | null>(null);
  const offset = page * PAGE_SIZE;

  const venuesQ = usePoPlatformVenueOptions();
  const logQ = usePoPlatformMailLog({ venueId, type, status, limit: PAGE_SIZE, offset }, true);
  const rows = logQ.data?.rows ?? [];
  const total = logQ.data?.total ?? 0;
  const reset = (): void => setPage(0);

  return (
    <div className={col}>
      <Top big title={p.mailLogTitle} sub={p.mailLogSubtitle} onBack={nav.canGoBack ? nav.back : undefined} />
      <Scroll bottom={100}>
        <TestMailCard />

        <div className="mb-4 grid gap-2 rounded-[16px] border border-line bg-elev p-[12px] md:grid-cols-3">
          <div>
            <Label className="mb-1">{p.accessLogFilterVenueLabel}</Label>
            <Select
              value={venueId ?? ''}
              onChange={(v) => {
                setVenueId(v || undefined);
                reset();
              }}
              ariaLabel={p.accessLogFilterVenueLabel}
              placeholder={p.accessLogFilterAllVenues}
              options={(venuesQ.data ?? []).map((v) => ({ value: v.venueId, label: v.name }))}
            />
          </div>
          <div>
            <Label className="mb-1">{p.mailLogFilterType}</Label>
            <Select
              value={type ?? ''}
              onChange={(v) => {
                setType(v || undefined);
                reset();
              }}
              ariaLabel={p.mailLogFilterType}
              placeholder={p.mailLogFilterAllTypes}
              options={ALL_TYPES.map((v) => ({ value: v, label: v }))}
            />
          </div>
          <div>
            <Label className="mb-1">{p.mailLogFilterStatus}</Label>
            <Select
              value={status ?? ''}
              onChange={(v) => {
                setStatus(v || undefined);
                reset();
              }}
              ariaLabel={p.mailLogFilterStatus}
              placeholder={p.mailLogFilterAllStatuses}
              options={MAIL_LOG_STATUSES.map((v) => ({ value: v, label: statusLabel(v) }))}
            />
          </div>
        </div>

        {logQ.isLoading ? (
          <Empty text={p.mailLogLoading} />
        ) : logQ.isError ? (
          <Empty text={p.mailLogLoadError} />
        ) : rows.length === 0 ? (
          <Empty text={p.mailLogEmpty} />
        ) : (
          <>
            <ul data-testid="mail-log" className="flex flex-col gap-1.5">
              {rows.map((e) => (
                <MailRow key={e.id} entry={e} onReveal={() => setReveal(e)} />
              ))}
            </ul>
            <PageNav
              summary={fmt(p.accessLogCountOf, { shown: offset + rows.length, total })}
              hasPrev={page > 0}
              hasNext={offset + rows.length < total}
              onPrev={() => setPage((x) => Math.max(0, x - 1))}
              onNext={() => setPage((x) => x + 1)}
              prevLabel={p.pagePrev}
              nextLabel={p.pageNext}
            />
          </>
        )}
      </Scroll>
      {reveal && <RevealSheet entry={reveal} onClose={() => setReveal(null)} />}
    </div>
  );
}

function MailRow({ entry, onReveal }: { entry: PlatformMailLogEntry; onReveal: () => void }): JSX.Element {
  const p = t.platform;
  return (
    <li data-testid="mail-log-row" data-type={entry.type} className="rounded-[14px] border border-line bg-elev p-[12px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-display text-[13.5px] font-bold text-text">{entry.type}</span>
        {entry.isTest && (
          <span className="rounded-[7px] border border-line2 px-2 py-[2px] text-[11px] font-bold text-acc-soft">{p.mailLogTest}</span>
        )}
        <span className="ml-auto text-[12.5px] font-semibold text-dim">{statusLabel(entry.status)}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-faint">
        <span>{entry.venueName ?? p.mailLogNoCompany}</span>
        {entry.eventName && (
          <>
            <span className="text-ghost">·</span>
            <span className="truncate">{entry.eventName}</span>
          </>
        )}
        <span className="text-ghost">·</span>
        <span>{formatWhen(entry.createdAt)}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span data-testid="mail-log-recipient" className="font-mono text-[12.5px] text-dim">
          {entry.recipient ?? p.mailLogNoAddress}
        </span>
        {entry.recipient && (
          <Btn kind="quiet" sm className="ml-auto min-h-[44px] lg:[@media(pointer:fine)]:min-h-0" onClick={onReveal}>
            {p.mailLogShowAddress}
          </Btn>
        )}
      </div>
    </li>
  );
}

function RevealSheet({ entry, onClose }: { entry: PlatformMailLogEntry; onClose: () => void }): JSX.Element {
  const p = t.platform;
  const [ticket, setTicket] = useState('');
  const reveal = usePoRevealMailRecipient();
  const done = reveal.isSuccess;
  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-1 font-display text-[19px] font-extrabold text-text">{p.mailLogRevealTitle}</div>
      <p className="mb-3 text-[13px] leading-[1.45] text-faint">{p.mailLogRevealBody}</p>
      {done ? (
        <p data-testid="mail-log-revealed" className="mb-3 break-all font-mono text-[14px] text-text">
          {reveal.data ?? p.mailLogRevealGone}
        </p>
      ) : (
        <>
          <Label className="mb-1">{p.mailLogRevealTicket}</Label>
          <Field
            value={ticket}
            onChange={setTicket}
            placeholder={p.mailLogRevealTicketPlaceholder}
            ariaLabel={p.mailLogRevealTicket}
            maxLength={200}
          />
          <Btn
            full
            className="mt-3"
            disabled={ticket.trim().length < 3 || reveal.isPending}
            onClick={() => reveal.mutate({ mailLogId: entry.id, ticket })}
          >
            {p.mailLogRevealConfirm}
          </Btn>
          {reveal.isError && (
            <div className="mt-2">
              <Note icon="lock">{p.mailLogRevealError}</Note>
            </div>
          )}
        </>
      )}
      <Btn kind="ghost" full className="mt-2" onClick={onClose}>
        {p.cancel}
      </Btn>
    </Sheet>
  );
}

function TestMailCard(): JSX.Element {
  const p = t.platform;
  const [type, setType] = useState<string>(MAIL_TYPE_GROUPS.guest[0]);
  const [toUserId, setToUserId] = useState('');
  const recipientsQ = usePoTestMailRecipients(true);
  const send = usePoSendTestMail();
  const groups: Array<[string, readonly string[]]> = [
    [p.testMailGroupGuest, MAIL_TYPE_GROUPS.guest],
    [p.testMailGroupTeam, MAIL_TYPE_GROUPS.team],
    [p.testMailGroupInvite, MAIL_TYPE_GROUPS.invite],
    [p.testMailGroupBilling, MAIL_TYPE_GROUPS.billing],
  ];
  return (
    <section data-testid="test-mail" className="mb-4 rounded-[16px] border border-line bg-elev p-[14px]">
      <div className="font-display text-[15px] font-bold text-text">{p.testMailTitle}</div>
      <p className="mb-3 mt-0.5 text-[12.5px] leading-[1.45] text-faint">{p.testMailSub}</p>
      <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <div>
          <Label className="mb-1">{p.testMailType}</Label>
          <Select
            value={type}
            onChange={(v) => {
              setType(v);
              send.reset();
            }}
            ariaLabel={p.testMailType}
            options={groups.flatMap(([group, types]) => types.map((v) => ({ value: v, label: `${group} · ${v}` })))}
          />
        </div>
        <div>
          <Label className="mb-1">{p.testMailTo}</Label>
          {/* Platform admins only, enforced by log_platform_test_mail (review #463). */}
          <Select
            value={toUserId}
            onChange={(v) => {
              setToUserId(v);
              send.reset();
            }}
            ariaLabel={p.testMailTo}
            placeholder={p.testMailTo}
            options={(recipientsQ.data ?? []).map((r) => ({
              value: r.userId,
              label: r.name ? `${r.name} · ${r.email}` : r.email,
            }))}
          />
        </div>
        <Btn disabled={!toUserId || send.isPending} onClick={() => send.mutate({ type, toUserId })}>
          {send.isPending ? p.testMailSending : p.testMailSend}
        </Btn>
      </div>
      {send.isSuccess && (
        <div className="mt-2">
          <Note icon="mail">{p.testMailSent}</Note>
        </div>
      )}
      {send.isError && (
        <div className="mt-2">
          <Note icon="mail">{send.error.message}</Note>
        </div>
      )}
    </section>
  );
}
