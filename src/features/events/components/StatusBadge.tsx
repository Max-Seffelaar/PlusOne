import { STATUS_LABELS, type EventStatus } from '../status';

// Status pill: a coloured dot + the readable Dutch word. One accent (live)
// carries weight; the rest live on white/grey, per the design-system "statussen
// leven van wit/grijs + het ene accent". Readable case (not uppercase) so it
// reads as a status, not a label.
const DOT: Record<EventStatus, string> = {
  draft: 'bg-faint',
  open: 'bg-text',
  live: 'bg-acc',
  closed: 'bg-ghost',
};

const PILL: Record<EventStatus, string> = {
  draft: 'border-line text-dim',
  open: 'border-line text-text',
  live: 'border-acc bg-acc-dim text-acc-soft',
  closed: 'border-line2 text-faint',
};

export function StatusBadge({ status }: { status: EventStatus }): JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${PILL[status]}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${DOT[status]} ${status === 'live' ? 'animate-pulse' : ''}`}
        aria-hidden
      />
      {STATUS_LABELS[status]}
    </span>
  );
}
