'use client';

import { useRouter } from 'next/navigation';
import { Database } from '@/lib/database.types';
import { cn } from '@/lib/utils';

type VenueMembership = Database['public']['Tables']['venue_memberships']['Row'] & {
  venues?: { id: string; name: string } | null;
};

interface VenueSwitcherProps {
  memberships: VenueMembership[];
  currentVenueId: string;
}

export function VenueSwitcher({ memberships, currentVenueId }: VenueSwitcherProps) {
  const router = useRouter();

  if (memberships.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium text-dim">Locatie:</label>
      <select
        value={currentVenueId}
        onChange={(e) => {
          router.push(`/admin/venues/${e.target.value}`);
        }}
        className={cn(
          'px-3 py-2 rounded-lg border border-border',
          'bg-bg text-text',
          'text-sm font-medium',
          'hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50',
        )}
      >
        {memberships.map((m) => (
          <option key={m.id} value={m.venue_id}>
            {m.venues?.name || 'Onbekende locatie'}
          </option>
        ))}
      </select>
    </div>
  );
}
