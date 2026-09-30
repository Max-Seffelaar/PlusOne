'use client';

/**
 * Platform > Audit (P-05, z8uq9m0tnx) — actor + name + venue + action +
 * before/after diff across EVERY venue, so a PlusOne platform admin can see
 * back who did what. Filterable by venue and period, windowed.
 *
 * Security shape (CLAUDE.md #1 — RLS is the boundary):
 *  - Gated on `usePoIsPlatformAdmin()` for the UI only, exactly like the
 *    Platform tab (P-04) and Platform > Venues (P-05) — a non-admin who types
 *    the URL gets the flat "not available" state and no read fires.
 *    `platform_audit_overview()`/`_count()` are SECURITY DEFINER RPCs that
 *    re-check `is_platform_admin()` and return zero rows for anyone else.
 *  - `is_support_action` (actor holds no CURRENT venue_memberships row at the
 *    audited venue) is computed IN SQL, never derived here from two separate
 *    reads — a client-side join would need the full membership table.
 *  - The diff is rendered as PLAIN TEXT ONLY (`JSON.stringify`, inside a
 *    `<pre>`), never `dangerouslySetInnerHTML` — it can contain guest names,
 *    notes and other free-form input from anywhere in the product.
 *  - Windowed (p_limit/p_offset, hard-capped in the RPC); the venue filter
 *    dropdown reads `platform_venue_options()` (id+name only, capped 500),
 *    never the full row set.
 *
 * Capacitor (#37): a client-side React Query read only, no writes at all.
 */
import { type JSX, useState } from 'react';
import { t, fmt } from '@/lib/i18n';
import {
  usePoIsPlatformAdmin,
  usePoPlatformAudit,
  usePoPlatformAuditCount,
  usePoPlatformVenueOptions,
} from '@/features/po/hooks';
import type { PlatformAuditEntry } from '@/features/po/adapters';
import { formatWhen } from '@/features/audit/translate';
import { useNav } from '../context';
import { Btn, Empty, Field, Label, MiniChip, PageNav, Scroll, Select, Top } from '../kit';

const col = 'flex h-full flex-col';
const PAGE_SIZE = 50;

export function PlatformAudit({ venueId: initialVenueId }: { venueId?: string } = {}): JSX.Element {
  const nav = useNav();
  const isPlatformAdmin = usePoIsPlatformAdmin();

  if (!isPlatformAdmin) {
    return (
      <div className={col}>
        <Top big title={t.platform.auditTitle} onBack={nav.canGoBack ? nav.back : undefined} />
        <Scroll bottom={90}>
          <Empty text={t.platform.notAvailable} />
        </Scroll>
      </div>
    );
  }
  // Keyed on the pre-scope (review finding, z8uq9m0tnx): arriving here a
  // SECOND time with a different `?venue=` (e.g. "View audit" tapped on a
  // different venue card while this screen is already mounted) must reset
  // the filter to the new venue, not keep whatever the first mount's
  // useState captured — a plain prop change wouldn't re-run that initial
  // state. 'all' is a safe key for "no pre-scope" since a real venue id is
  // always a UUID, never that literal string.
  return <AuditConsole key={initialVenueId ?? 'all'} initialVenueId={initialVenueId} />;
}

function AuditConsole({ initialVenueId }: { initialVenueId?: string }): JSX.Element {
  const nav = useNav();
  const [venueId, setVenueId] = useState<string | undefined>(initialVenueId);
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [page, setPage] = useState(0);
  const offset = page * PAGE_SIZE;

  const filters = {
    venueId,
    // Both built as LOCAL midnight, not one UTC + one local (review finding,
    // z8uq9m0tnx): `new Date('YYYY-MM-DD')` parses as UTC midnight, which is
    // hours off from `new Date('YYYY-MM-DDT23:59:59')`'s local-time parse in
    // most timezones — a "From" filter that silently excluded part of the
    // selected start day.
    since: since ? new Date(`${since}T00:00:00`).toISOString() : undefined,
    until: until ? new Date(`${until}T23:59:59`).toISOString() : undefined,
  };

  const venuesQ = usePoPlatformVenueOptions();
  const entriesQ = usePoPlatformAudit({ ...filters, limit: PAGE_SIZE, offset });
  const countQ = usePoPlatformAuditCount(filters);
  const entries = entriesQ.data ?? [];
  const total = countQ.data ?? 0;
  const filtersActive = !!venueId || !!since || !!until;

  return (
    <div className={col}>
      <Top big title={t.platform.auditTitle} sub={t.platform.auditSubtitle} onBack={nav.canGoBack ? nav.back : undefined} />
      <Scroll bottom={100}>
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-[16px] border border-line bg-elev p-[12px]">
          <div className="min-w-[200px] flex-1">
            <Label className="mb-1">{t.platform.auditFilterVenueLabel}</Label>
            <Select
              value={venueId ?? ''}
              onChange={(v) => {
                setVenueId(v || undefined);
                setPage(0);
              }}
              ariaLabel={t.platform.auditFilterVenueLabel}
              placeholder={t.platform.auditFilterAllVenues}
              options={(venuesQ.data ?? []).map((v) => ({ value: v.venueId, label: v.name }))}
            />
          </div>
          <div className="min-w-[140px] flex-1">
            <Label className="mb-1">{t.platform.auditFilterSinceLabel}</Label>
            <Field
              icon="cal"
              type="date"
              ariaLabel={t.platform.auditFilterSinceLabel}
              value={since}
              onChange={(v) => {
                setSince(v);
                setPage(0);
              }}
            />
          </div>
          <div className="min-w-[140px] flex-1">
            <Label className="mb-1">{t.platform.auditFilterUntilLabel}</Label>
            <Field
              icon="cal"
              type="date"
              ariaLabel={t.platform.auditFilterUntilLabel}
              value={until}
              onChange={(v) => {
                setUntil(v);
                setPage(0);
              }}
            />
          </div>
          {filtersActive && (
            <Btn
              kind="ghost"
              sm
              className="min-h-[44px]"
              onClick={() => {
                setVenueId(undefined);
                setSince('');
                setUntil('');
                setPage(0);
              }}
            >
              {t.platform.auditFilterClear}
            </Btn>
          )}
        </div>

        {entriesQ.isLoading ? (
          <Empty text={t.platform.auditLoading} />
        ) : entriesQ.isError ? (
          <Empty text={t.platform.auditLoadError} />
        ) : entries.length === 0 ? (
          <Empty text={t.platform.auditEmpty} />
        ) : (
          <>
            <ul className="flex flex-col gap-1.5 md:hidden">
              {entries.map((e) => (
                <AuditRow key={e.id} entry={e} />
              ))}
            </ul>
            <div className="hidden overflow-hidden rounded-[16px] border border-line bg-elev md:block">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-elev2 [&>th]:px-3 [&>th]:py-[11px] [&>th]:font-body [&>th]:text-[11px] [&>th]:font-bold [&>th]:uppercase [&>th]:tracking-[0.04em] [&>th]:text-faint">
                    <th className="!pl-4">{t.platform.auditColWho}</th>
                    <th>{t.platform.auditColAction}</th>
                    <th>{t.platform.auditColVenue}</th>
                    <th className="!pr-4 text-right">{t.platform.auditColWhen}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <AuditTableRow key={e.id} entry={e} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Only while there is a real page to show — never "0 of 0" under
                an empty/loading/error state (review finding, z8uq9m0tnx). */}
            <PageNav
              summary={fmt(t.platform.auditCountOf, { shown: offset + entries.length, total })}
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

/** The diff, as plain text — NEVER dangerouslySetInnerHTML (it can carry any
 *  free-form input from anywhere in the product). */
function DiffText({ diff }: { diff: unknown }): JSX.Element {
  if (diff == null) {
    return <p className="text-[12px] text-faint">{t.platform.auditNoDiff}</p>;
  }
  let text: string;
  try {
    text = JSON.stringify(diff, null, 2);
  } catch {
    text = String(diff);
  }
  return (
    <pre className="mt-1.5 max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-[11px] bg-elev2 px-[11px] py-[8px] text-[11.5px] leading-[1.5] text-dim">
      {text}
    </pre>
  );
}

function SupportBadge(): JSX.Element {
  return (
    <span title={t.platform.auditSupportHint}>
      <MiniChip className="border-transparent bg-acc-dim text-acc">{t.platform.auditSupportBadge}</MiniChip>
    </span>
  );
}

function AuditRow({ entry }: { entry: PlatformAuditEntry }): JSX.Element {
  return (
    <li className="rounded-[14px] border border-line bg-elev p-[12px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[13.5px] font-semibold text-text">
          {entry.actorName ?? t.platform.auditUnknownActor}
        </span>
        <span className="text-[12px] text-faint">{entry.action}</span>
        {entry.isSupportAction && <SupportBadge />}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] text-faint">
        <span>{entry.venueName ?? t.platform.auditNoVenue}</span>
        <span className="text-ghost">·</span>
        <span>{entry.entityType}</span>
        <span className="text-ghost">·</span>
        <span>{formatWhen(entry.createdAt)}</span>
      </div>
      <DiffText diff={entry.diff} />
    </li>
  );
}

function AuditTableRow({ entry }: { entry: PlatformAuditEntry }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr
        onClick={() => setOpen((o) => !o)}
        className="cursor-pointer border-t border-line2 transition-colors hover:bg-elev2 [&>td]:px-3 [&>td]:py-[11px] [&>td]:align-middle"
      >
        <td className="!pl-4">
          <span className="font-display text-[13.5px] font-bold text-text">
            {entry.actorName ?? t.platform.auditUnknownActor}
          </span>
        </td>
        <td>
          <span className="flex items-center gap-2 text-[13px] text-dim">
            {entry.entityType} · {entry.action}
            {entry.isSupportAction && <SupportBadge />}
          </span>
        </td>
        <td>
          <span className="block max-w-[180px] truncate text-[13px] text-dim">
            {entry.venueName ?? t.platform.auditNoVenue}
          </span>
        </td>
        <td className="!pr-4 text-right">
          <span className="whitespace-nowrap font-display text-[12.5px] text-faint">
            {formatWhen(entry.createdAt)}
          </span>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-line2">
          <td colSpan={4} className="!px-4 !py-3">
            <div className="text-[11.5px] font-semibold uppercase tracking-[0.03em] text-faint">
              {t.platform.auditDiffLabel}
            </div>
            <DiffText diff={entry.diff} />
          </td>
        </tr>
      )}
    </>
  );
}
