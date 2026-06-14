import { STATUS_LABELS, type EventStatus } from '../status';

// Status chip. One accent (live) carries weight; the rest live on grey, per the
// design-system "statussen leven van wit/grijs + het ene accent".
const STYLES: Record<EventStatus, string> = {
  draft: 'border-line text-faint',
  open: 'border-line text-text',
  live: 'border-acc bg-acc-dim text-acc-soft',
  closed: 'border-line2 text-ghost',
};

export function StatusBadge({ status }: { status: EventStatus }): JSX.Element {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-label uppercase ${STYLES[status]}`}
    >
      {status === 'live' && (
        <span className="bg-acc mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full" aria-hidden />
      )}
      {STATUS_LABELS[status]}
    </span>
  );
}
