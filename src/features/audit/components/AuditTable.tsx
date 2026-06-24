// Chronological audit table — the desktop mock's Audit view (AUDIT_GRID layout),
// reused with real, translated lines. Server component: the only interactivity
// is a link per guest to its "geschiedenis". Times are formatted server-side in
// Amsterdam TZ (formatWhen) so there is no hydration drift.
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/po/icon';
import { Avatar, Label } from '@/components/po/kit';
import { ActionChip, DCard } from '@/components/po/desktop/kit';
import { formatWhen, type AuditLine } from '../translate';

const AUDIT_GRID = 'grid-cols-[minmax(120px,150px)_120px_1fr_120px_104px]';

function isDoorDevice(device: string): boolean {
  return /deur|door/i.test(device);
}

export function AuditTable({
  lines,
  venueId,
}: {
  lines: AuditLine[];
  venueId: string;
}): JSX.Element {
  if (lines.length === 0) {
    return (
      <DCard className="p-8 text-center text-[14px] text-faint">
        Nothing logged for these filters.
      </DCard>
    );
  }

  return (
    <DCard className="overflow-hidden p-0">
      <div className={cn('grid border-b border-line bg-bg px-[22px] py-[13px]', AUDIT_GRID)}>
        {['Who', 'Action', 'What', 'When', 'Device'].map((h) => (
          <Label key={h}>{h}</Label>
        ))}
      </div>
      {lines.map((a, i) => (
        <div
          key={a.id}
          className={cn(
            'grid items-center px-[22px] py-[14px] transition-colors hover:bg-white/[0.025]',
            AUDIT_GRID,
            i < lines.length - 1 && 'border-b border-line2'
          )}
        >
          <div className="flex items-center gap-[10px]">
            <Avatar name={a.actor} size={30} />
            <span className="truncate text-[13.5px] font-semibold text-text">{a.actor}</span>
          </div>
          <div>
            <ActionChip action={a.action} />
          </div>
          <div className="pr-4 text-[14px] text-dim">
            <span className="font-semibold text-text">{a.actor}</span> {a.text}
            {a.guestId && (
              <Link
                href={`/admin/audit?venue=${venueId}&guest=${a.guestId}`}
                className="ml-2 whitespace-nowrap text-[12.5px] text-acc-soft underline-offset-2 hover:underline"
              >
                timeline
              </Link>
            )}
          </div>
          <div className="font-display text-[13px] text-faint">{formatWhen(a.iso)}</div>
          <div className="flex items-center gap-1.5 text-[12px] text-faint">
            <span
              className={cn('h-1.5 w-1.5 shrink-0 rounded-full', isDoorDevice(a.device) ? 'bg-acc' : 'bg-ghost')}
            />
            <span className="truncate">{a.device}</span>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2 border-t border-line2 px-[22px] py-3 text-[12px] text-faint">
        <Icon name="shield" size={14} className="text-faint" />
        Append-only · written by database triggers, never by app code (#15). Access requires
        Admin/Finance + MFA.
      </div>
    </DCard>
  );
}
