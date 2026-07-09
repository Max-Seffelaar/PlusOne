import type { IconName } from '@/components/po/icon';
import type { Role } from './types';

/**
 * Best-effort tier-name → role badge + door glyph. The single source of truth
 * for the substring taxonomy that used to live twice (po/adapters.ts returning
 * just `Role`; door/model.ts returning `{label, icon}`) — this is their union:
 * `role` for callers that only need the badge enum, `icon`/`label` for the
 * door's glyph + free-form fallback name (a custom tier keeps its own identity
 * instead of collapsing to "Guest", feedback 1/7).
 */
export function tierRole(name: string): { role: Role; icon: IconName; label: string } {
  const n = name.toLowerCase();
  if (n.includes('vip')) return { role: 'VIP', icon: 'crown', label: 'VIP' };
  if (n.includes('all access') || n.includes('allaccess') || n.includes('access') || n === 'aa')
    return { role: 'All Access', icon: 'shield', label: 'All Access' };
  if (n.includes('artist') || n.includes('artiest') || n.includes('dj'))
    return { role: 'Artist', icon: 'star', label: 'Artist' };
  if (n.includes('pers') || n.includes('press') || n.includes('media'))
    return { role: 'Press', icon: 'note', label: 'Press' };
  if (n.includes('crew') || n.includes('prod') || n.includes('staff'))
    return { role: 'Crew', icon: 'users', label: 'Crew' };
  // Free-form tier: show its own (short) name, generic glyph, Guest badge.
  return { role: 'Guest', icon: 'user', label: name.length > 0 && name.length <= 16 ? name : 'Guest' };
}
