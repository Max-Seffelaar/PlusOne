/**
 * Snapshot → view-model for the door screens. Keeps all derivation in one pure,
 * tested place: inside = a check_in row exists (RLS comment §2; logboek is built
 * from guests/check_ins, never audit_log); refused guests drop off the list; the
 * guest card shows tier colour/icon, +N, "toegevoegd door" and the last 4 phone
 * digits (decision #27).
 */
import type { IconName } from '@/components/po/icon';
import type { CheckInRow, DoorEventMeta, DoorSnapshot, GuestRow, TierRow } from './queries';

export type NotePriority = 'none' | 'low' | 'high';

export interface DoorGuest {
  id: string;
  name: string;
  plus: number;
  tierId: string;
  tierName: string;
  tierColor: string;
  tierIcon: IconName;
  addedByName: string;
  addedAt: string;
  /** Last 4 digits of the phone number, or null (decision #27). */
  last4: string | null;
  note: string | null;
  notePriority: NotePriority;
  acknowledged: boolean;
  ackByName?: string;
  inside: boolean;
  /** Had a check-in that was undone at the door (soft void) → back to "onderweg". */
  voided: boolean;
  /** Door payment required — inert until guest_tiers.door_price lands (#34). */
  pay: boolean;
  inAt?: string;
  inByName?: string;
  arrived?: number;
}

export interface DoorView {
  event: DoorEventMeta;
  guests: DoorGuest[];
  tiers: TierRow[];
  insideCount: number;
  waitingCount: number;
}

export interface DoorTask {
  guest: DoorGuest;
  high: boolean;
  done: boolean;
}

const FALLBACK_TIER_COLOR = '#8E8E93';

/** Map a free-form tier name to a RoleChip glyph + short label (design-system). */
export function tierRole(name: string): { label: string; icon: IconName } {
  const n = name.toLowerCase();
  if (n.includes('vip')) return { label: 'VIP', icon: 'crown' };
  if (n.includes('all access') || n.includes('allaccess') || n.includes('access'))
    return { label: 'All Access', icon: 'shield' };
  if (n.includes('artist') || n.includes('artiest') || n.includes('dj')) return { label: 'Artist', icon: 'star' };
  if (n.includes('pers') || n.includes('press') || n.includes('media')) return { label: 'Pers', icon: 'note' };
  if (n.includes('crew') || n.includes('prod') || n.includes('staff')) return { label: 'Crew', icon: 'users' };
  // Free-form tier: show its own (short) name, generic glyph.
  return { label: name.length > 0 && name.length <= 16 ? name : 'Gast', icon: 'user' };
}

export function lastFour(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : digits || null;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

/** Earliest check-in per guest (the first wins, decision #11). */
export function indexCheckIns(checkIns: CheckInRow[]): Map<string, CheckInRow> {
  const map = new Map<string, CheckInRow>();
  for (const c of checkIns) {
    const prev = map.get(c.guest_id);
    if (!prev || c.checked_at < prev.checked_at) map.set(c.guest_id, c);
  }
  return map;
}

function toDoorGuest(
  g: GuestRow,
  tierById: Map<string, TierRow>,
  checkInByGuest: Map<string, CheckInRow>,
  profiles: Record<string, string>,
): DoorGuest {
  const tier = tierById.get(g.tier_id);
  const role = tierRole(tier?.name ?? '');
  const ci = checkInByGuest.get(g.id);
  // A voided check-in does not count as present — the guest is "onderweg" again.
  const active = ci != null && ci.voided_at == null;
  return {
    id: g.id,
    name: g.full_name,
    plus: g.plus_ones,
    tierId: g.tier_id,
    tierName: role.label,
    tierColor: tier?.color ?? FALLBACK_TIER_COLOR,
    tierIcon: role.icon,
    addedByName: profiles[g.added_by] ?? 'Onbekend',
    addedAt: formatDate(g.created_at),
    last4: lastFour(g.phone),
    note: g.note,
    notePriority: g.note_priority,
    acknowledged: g.note_acknowledged_at != null,
    ackByName: g.note_acknowledged_by ? profiles[g.note_acknowledged_by] : undefined,
    inside: active,
    voided: ci != null && ci.voided_at != null,
    pay: false,
    inAt: active ? formatTime(ci.checked_at) : undefined,
    inByName: active ? profiles[ci.checked_by] ?? 'Deur' : undefined,
    arrived: active ? ci.plus_ones_arrived : undefined,
  };
}

export function buildDoorView(snapshot: DoorSnapshot): DoorView {
  const tierById = new Map(snapshot.tiers.map((t) => [t.id, t]));
  const checkInByGuest = indexCheckIns(snapshot.checkIns);
  const refusedSet = new Set(snapshot.refusals.map((r) => r.guest_id));

  const guests = snapshot.guests
    .filter((g) => !refusedSet.has(g.id))
    .map((g) => toDoorGuest(g, tierById, checkInByGuest, snapshot.profiles));

  const insideCount = guests.filter((g) => g.inside).length;
  return {
    event: snapshot.event,
    guests,
    tiers: snapshot.tiers,
    insideCount,
    waitingCount: guests.length - insideCount,
  };
}

/** Tasks (#39): every guest with a note is an opdracht; high priority first;
 *  done = acknowledged ("Gezien & opgepakt"). Matches the prototype's Taken tab. */
export function buildTasks(view: DoorView): DoorTask[] {
  return view.guests
    .filter((g) => !!g.note)
    .map((g) => ({ guest: g, high: g.notePriority === 'high', done: g.acknowledged }));
}
