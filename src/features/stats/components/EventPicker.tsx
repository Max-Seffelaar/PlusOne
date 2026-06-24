'use client';

// Event picker for the statistics screen — selecting an event rewrites the URL
// (?event=…) and the server re-fetches that event's stats. Keeps the venue param.
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Icon } from '@/components/po/icon';

export interface PickerOption {
  id: string;
  label: string;
}

export function EventPicker({
  options,
  current,
}: {
  options: PickerOption[];
  current: string;
}): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function onChange(eventId: string): void {
    const next = new URLSearchParams(params.toString());
    next.set('event', eventId);
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  }

  return (
    <div className="inline-flex items-center gap-[9px] rounded-[12px] border border-line bg-elev px-[14px] py-[10px]">
      <span className="h-2 w-2 rounded-full bg-acc" />
      <select
        aria-label="Pick an event"
        value={current}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer border-none bg-transparent font-display text-[14px] font-bold text-text outline-none"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevD" size={15} className="text-ghost" />
    </div>
  );
}
