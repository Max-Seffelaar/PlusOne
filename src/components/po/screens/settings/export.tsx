'use client';

// Legal v0.3 E1 — self-service data export (plan §3 E1). Two entry points:
//   * <ExportDataCard/> in Venue settings: "Export everything" (venue scope);
//   * <ExportEventRow/> on an event's detail screen: "Export this event".
// Admin only — finance/staff/doorhost never see either (the server action and
// the audit RPC refuse them anyway). Never behind the billing gate: ToS 6.2
// promises read access on a lapsed trial, and this is read access.
// Native shell (#37): the webview cannot save a blob download, so both entry
// points say "export from the web app" instead (same seam as billing).

import { type JSX } from 'react';
import { useMutation } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { isNativeShell } from '@/lib/platform';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { exportVenueData, type ExportVenueDataResult } from '@/features/export/actions';
import { Icon } from '../../icon';
import { Btn, Label, Note, downloadFile, press } from '../../kit';

type ExportScope = 'venue' | { eventId: string };
type ExportOk = Extract<ExportVenueDataResult, { ok: true }>;

class ExportError extends Error {
  constructor(readonly code: Extract<ExportVenueDataResult, { ok: false }>['error']) {
    super(code);
  }
}

function errorText(error: unknown): string {
  const code = error instanceof ExportError ? error.code : 'failed';
  if (code === 'too_large') return t.settings.export.errorTooLarge;
  if (code === 'unauthorized') return t.settings.export.errorUnauthorized;
  return t.settings.export.errorFailed;
}

function useExportVenueData() {
  const { venueId } = usePoIdentity();
  return useMutation<ExportOk, Error, ExportScope>({
    mutationFn: async (scope) => {
      if (!venueId) throw new ExportError('unauthorized');
      const res = await exportVenueData({ venueId, scope });
      if (!res.ok) throw new ExportError(res.error);
      if (!downloadFile(res.zipBase64, res.filename, 'application/zip')) throw new ExportError('failed');
      return res;
    },
  });
}

function useCanExport(): boolean {
  const { roles } = usePoIdentity();
  return roles.includes('admin');
}

/** Venue settings card: "Export everything". Renders nothing for non-admins. */
export function ExportDataCard(): JSX.Element | null {
  const canExport = useCanExport();
  const run = useExportVenueData();
  if (!canExport) return null;
  const native = isNativeShell();

  return (
    <section aria-labelledby="po-export-title" className="mt-[22px]">
      <Label className="mb-[10px]">
        <span id="po-export-title">{t.settings.export.title}</span>
      </Label>
      <div className="rounded-[18px] border border-line bg-elev p-[15px]">
        <p className="mb-[12px] text-[13px] leading-[1.45] text-dim">{t.settings.export.body}</p>
        {native ? (
          <Note icon="dl">{t.settings.export.nativeOnly}</Note>
        ) : (
          <Btn kind="dark" full icon="dl" disabled={run.isPending} onClick={() => run.mutate('venue')}>
            {run.isPending ? t.settings.export.busy : t.settings.export.everything}
          </Btn>
        )}
        <ExportStatus run={run} />
        <p className="mt-[10px] text-[11.5px] text-faint">{t.settings.export.logged}</p>
      </div>
    </section>
  );
}

function ExportStatus({ run }: { run: ReturnType<typeof useExportVenueData> }): JSX.Element | null {
  if (run.isError) {
    return (
      <p role="alert" className="mt-[10px] text-[12.5px] text-red-300">
        {errorText(run.error)}
      </p>
    );
  }
  if (run.isSuccess) {
    return (
      <p role="status" className="mt-[10px] text-[12.5px] text-acc-soft">
        {fmt(t.settings.export.done, { ...run.data.counts })}
      </p>
    );
  }
  return null;
}

/** Event-detail row: "Export this event". Renders nothing for non-admins. */
export function ExportEventRow({ eventId }: { eventId: string }): JSX.Element | null {
  const canExport = useCanExport();
  const run = useExportVenueData();
  if (!canExport) return null;
  const native = isNativeShell();

  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={native || run.isPending}
        onClick={() => run.mutate({ eventId })}
        className={cn(
          'flex w-full items-center gap-[12px] rounded-[16px] border border-line bg-elev p-[13px] text-left',
          !native && press,
        )}
      >
        <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] border border-line bg-elev2 text-acc">
          <Icon name="dl" size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-body text-[15px] font-semibold text-text">
            {run.isPending ? t.settings.export.busy : t.settings.export.eventOnly}
          </span>
          <span className="mt-px block text-[12.5px] text-faint">
            {native ? t.settings.export.nativeOnly : t.settings.export.logged}
          </span>
        </span>
      </button>
      <ExportStatus run={run} />
    </div>
  );
}

/** Compact recap-screen button (past events): same export, `quiet` Btn. Null
 *  for non-admins and in the native shell (the venue card explains why). */
export function ExportEventButton({ eventId }: { eventId: string }): JSX.Element | null {
  const canExport = useCanExport();
  const run = useExportVenueData();
  if (!canExport || isNativeShell()) return null;
  return (
    <div className="min-w-0 flex-1">
      <Btn kind="quiet" full icon="dl" disabled={run.isPending} onClick={() => run.mutate({ eventId })}>
        {run.isPending ? t.settings.export.busy : t.events.exportLabel}
      </Btn>
      <ExportStatus run={run} />
    </div>
  );
}
