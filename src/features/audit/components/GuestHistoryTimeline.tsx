// Per-guest "geschiedenis" (#15/#39) — the "wat is hier gebeurd?"-view. The full
// log for one guest (its row changes + check-ins/refusals), oldest first as a
// story. Server component; reuses the shared kit. Reusable as a guest-detail tab.
import Link from 'next/link';
import { Icon } from '@/components/po/icon';
import { Avatar, Label } from '@/components/po/kit';
import { ActionChip, DCard } from '@/components/po/desktop/kit';
import { formatWhen, type AuditLine } from '../translate';
import type { GuestHistory } from '../queries';

const STATUS_LABELS: Record<string, string> = {
  pending: 'In afwachting',
  approved: 'Op de lijst',
  denied: 'Afgewezen',
  checked_in: 'Binnen',
  refused: 'Geweigerd',
  removed: 'Verwijderd',
};

function Line({ line, last }: { line: AuditLine; last: boolean }): JSX.Element {
  return (
    <li className="relative flex gap-4 pl-1">
      {/* Rail + node */}
      <div className="relative flex w-6 shrink-0 flex-col items-center">
        <span className="z-10 mt-1 h-3 w-3 rounded-full border-2 border-acc bg-bg" />
        {!last && <span className="absolute top-1 h-full w-px bg-line2" />}
      </div>
      <div className="flex-1 pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <ActionChip action={line.action} />
          <span className="font-display text-[12.5px] text-faint">{formatWhen(line.iso)}</span>
        </div>
        <p className="mt-2 text-[14px] text-dim">
          <span className="font-semibold text-text">{line.actor}</span> {line.text}
        </p>
        <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-faint">
          <Avatar name={line.actor} size={18} />
          <span>{line.actor}</span>
          <span className="text-ghost">·</span>
          <span>{line.device}</span>
        </div>
      </div>
    </li>
  );
}

export function GuestHistoryTimeline({
  history,
  venueId,
}: {
  history: GuestHistory;
  venueId: string;
}): JSX.Element {
  const { guest, lines } = history;

  return (
    <div className="flex flex-col gap-5">
      <Link
        href={`/admin/audit?venue=${venueId}`}
        className="inline-flex w-fit items-center gap-1.5 text-[13px] text-dim transition-colors hover:text-text"
      >
        <Icon name="back" size={16} /> Terug naar audit log
      </Link>

      <DCard className="p-6">
        <Label>Geschiedenis van</Label>
        {guest ? (
          <>
            <div className="mt-1 flex items-center gap-3">
              <Avatar name={guest.fullName} size={44} />
              <div>
                <div className="font-display text-[22px] font-extrabold tracking-[-0.02em] text-text">
                  {guest.fullName}
                  {guest.plusOnes > 0 && <span className="text-acc"> +{guest.plusOnes}</span>}
                </div>
                <div className="text-[13px] text-faint">
                  {[guest.eventName, guest.tierName, STATUS_LABELS[guest.status] ?? guest.status]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            </div>
          </>
        ) : (
          <p className="mt-1 text-[14px] text-dim">Deze gast is niet (meer) zichtbaar.</p>
        )}
      </DCard>

      <DCard className="p-6">
        <div className="mb-5 font-display text-[17px] font-bold text-text">Tijdlijn</div>
        {lines.length === 0 ? (
          <p className="text-[14px] text-faint">Nog geen gebeurtenissen voor deze gast.</p>
        ) : (
          <ul className="flex flex-col">
            {lines.map((line, i) => (
              <Line key={line.id} line={line} last={i === lines.length - 1} />
            ))}
          </ul>
        )}
      </DCard>
    </div>
  );
}
