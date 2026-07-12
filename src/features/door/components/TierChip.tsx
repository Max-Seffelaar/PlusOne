/** A tier-name chip coloured by the guest's tier (decision #27: tier colour + icon). */
import { Icon, type IconName } from '@/components/po/icon';

export function TierChip({ name, color, icon }: { name: string; color: string; icon: IconName }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-[5px] rounded-[7px] border border-line bg-elev2 px-2 py-[3px] font-body text-[11px] font-bold uppercase tracking-[0.04em] text-text">
      <Icon name={icon} size={11} sw={2} stroke={color} />
      {name}
    </span>
  );
}
