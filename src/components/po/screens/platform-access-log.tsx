'use client';

/**
 * Platform > Access log (legal v0.3 B3, z8uq9m2hm5) — every time a PlusOne
 * platform admin switched INTO a venue they hold no membership at, through the
 * app (decision 3). Read-only, newest first, filterable by venue, windowed.
 *
 * Security shape (CLAUDE.md #1 — RLS is the boundary):
 *  - Gated on `usePoIsPlatformAdmin()` for the UI only, exactly like the other
 *    Platform screens — a non-admin who types the URL gets the flat "not
 *    available" state and no read fires. The real boundary is the
 *    `platform_access_log_select` policy (`is_platform_admin()`): a venue admin
 *    reading the table directly gets zero rows (decision 3: the customer never
 *    sees this; we share it on request, DPA 4.4).
 *  - No writes at all here. Rows are written only by `switchActiveVenueAction`
 *    and are append-only for every app role (no UPDATE/DELETE grant).
 *  - `reason` is free-form operator text — rendered as plain text only.
 *  - Windowed (≤ 50 per page) with the total from the same request; the venue
 *    picker reads `platform_venue_options()` (id + name, capped), never all rows.
 *
 * Capacitor (#37): a client-side React Query read only; nothing door-adjacent,
 * no browser-only API, no billing UI.
 */
import { type JSX, useState } from 'react';
import { t, fmt } from '@/lib/i18n';
import {
  usePoIsPlatformAdmin,
  usePoPlatformAccessLog,
  usePoPlatformVenueOptions,
} from '@/features/po/hooks';
import type { PlatformAccessLogEntry } from '@/features/po/adapters';
import { formatWhen } from '@/features/audit/translate';
import { useNav } from '../context';
import { Btn, Empty, Label, PageNav, Scroll, Select, Top } from '../kit';

const col = 'flex h-full flex-col';
const PAGE_SIZE = 50;

export function PlatformAccessLog({ venueId: initialVenueId }: { venueId?: string } = {}): JSX.Element {
  const nav = useNav();
  const isPlatformAdmin = usePoIsPlatformAdmin();

  if (!isPlatformAdmin) {
    return (
      <div className={col}>
        <Top big title={t.platform.accessLogTitle} onBack={nav.canGoBack ? nav.back : undefined} />
        <Scroll bottom={90}>
          <Empty text={t.platform.notAvailable} />
        </Scroll>
      </div>
    );
  }
  // Keyed on the pre-scope, same reason as Platform > Audit: arriving again
  // with a different `?venue=` must reset the filter, not keep the first
  // mount's state. A real venue id is a UUID, never the literal 'all'.
  return <AccessLogConsole key={initialVenueId ?? 'all'} initialVenueId={initialVenueId} />;
}

function AccessLogConsole({ initialVenueId }: { initialVenueId?: string }): JSX.Element {
  const nav = useNav();
  const [venueId, setVenueId] = useState<string | undefined>(initialVenueId);
  const [page, setPage] = useState(0);
  const offset = page * PAGE_SIZE;

  const venuesQ = usePoPlatformVenueOptions();
  const logQ = usePoPlatformAccessLog({ venueId, limit: PAGE_SIZE, offset });
  const entries = logQ.data?.entries ?? [];
  const total = logQ.data?.total ?? 0;

  return (
    <div className={col}>
      <Top
        big
        title={t.platform.accessLogTitle}
        sub={t.platform.accessLogSubtitle}
        onBack={nav.canGoBack ? nav.back : undefined}
      />
      <Scroll bottom={100}>
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-[16px] border border-line bg-elev p-[12px]">
          <div className="min-w-[200px] flex-1">
            <Label className="mb-1">{t.platform.accessLogFilterVenueLabel}</Label>
            <Select
              value={venueId ?? ''}
              onChange={(v) => {
                setVenueId(v || undefined);
                setPage(0);
              }}
              ariaLabel={t.platform.accessLogFilterVenueLabel}
              placeholder={t.platform.accessLogFilterAllVenues}
              options={(venuesQ.data ?? []).map((v) => ({ value: v.venueId, label: v.name }))}
            />
          </div>
          {venueId && (
            <Btn
              kind="ghost"
              sm
              className="min-h-[44px]"
              onClick={() => {
                setVenueId(undefined);
                setPage(0);
              }}
            >
              {t.platform.accessLogFilterClear}
            </Btn>
          )}
        </div>

        {logQ.isLoading ? (
          <Empty text={t.platform.accessLogLoading} />
        ) : logQ.isError ? (
          <Empty text={t.platform.accessLogLoadError} />
        ) : entries.length === 0 ? (
          <Empty text={t.platform.accessLogEmpty} />
        ) : (
          <>
            <ul className="flex flex-col gap-1.5 md:hidden">
              {entries.map((e) => (
                <AccessRow key={e.id} entry={e} />
              ))}
            </ul>
            <div className="hidden overflow-hidden rounded-[16px] border border-line bg-elev md:block">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-elev2 [&>th]:px-3 [&>th]:py-[11px] [&>th]:font-body [&>th]:text-[11px] [&>th]:font-bold [&>th]:uppercase [&>th]:tracking-[0.04em] [&>th]:text-faint">
                    <th className="!pl-4">{t.platform.accessLogColWho}</th>
                    <th>{t.platform.accessLogColVenue}</th>
                    <th>{t.platform.accessLogColReason}</th>
                    <th className="!pr-4 text-right">{t.platform.accessLogColWhen}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <AccessTableRow key={e.id} entry={e} />
                  ))}
                </tbody>
              </table>
            </div>

            <PageNav
              summary={fmt(t.platform.accessLogCountOf, { shown: offset + entries.length, total })}
              hasPrev={page > 0}
              hasNext={offset + entries.length < total}
              onPrev={() => setPage((p) => Math.max(0, p - 1))}
              onNext={() => setPage((p) => p + 1)}
              prevLabel={t.platform.pagePrev}
              nextLabel={t.platform.pageNext}
            />
          </>
        )}
      </Scroll>
    </div>
  );
}

function AccessRow({ entry }: { entry: PlatformAccessLogEntry }): JSX.Element {
  return (
    <li className="rounded-[14px] border border-line bg-elev p-[12px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[13.5px] font-semibold text-text">
          {entry.adminName ?? t.platform.accessLogUnknownAdmin}
        </span>
        <span className="text-[12px] text-faint">→</span>
        <span className="min-w-0 truncate text-[13px] text-dim">
          {entry.venueName ?? t.platform.accessLogUnknownVenue}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] text-faint">
        <span className="break-words">{entry.reason ?? t.platform.accessLogNoReason}</span>
        <span className="text-ghost">·</span>
        <span>{formatWhen(entry.createdAt)}</span>
      </div>
    </li>
  );
}

function AccessTableRow({ entry }: { entry: PlatformAccessLogEntry }): JSX.Element {
  return (
    <tr className="border-t border-line2 [&>td]:px-3 [&>td]:py-[11px] [&>td]:align-middle">
      <td className="!pl-4">
        <span className="font-display text-[13.5px] font-bold text-text">
          {entry.adminName ?? t.platform.accessLogUnknownAdmin}
        </span>
      </td>
      <td>
        <span className="block max-w-[220px] truncate text-[13px] text-dim">
          {entry.venueName ?? t.platform.accessLogUnknownVenue}
        </span>
      </td>
      <td>
        <span className="block max-w-[260px] truncate text-[13px] text-faint">
          {entry.reason ?? t.platform.accessLogNoReason}
        </span>
      </td>
      <td className="!pr-4 text-right">
        <span className="whitespace-nowrap font-display text-[12.5px] text-faint">
          {formatWhen(entry.createdAt)}
        </span>
      </td>
    </tr>
  );
}
