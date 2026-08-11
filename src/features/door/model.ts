/**
 * Snapshot → view-model for the door screens. Keeps all derivation in one pure,
 * tested place: inside = a check_in row exists (RLS comment §2; logboek is built
 * from guests/check_ins, never audit_log); refused guests drop off the list; the
 * guest card shows tier colour/icon, +N, "toegevoegd door" and the last 4 phone
 * digits (decision #27).
 */
import type { IconName } from '@/components/po/icon';
import type { CheckInRow, DoorEventMeta, DoorSnapshot, GuestRow, TierRow } from './queries';
import { formatShortDate, formatDateTime } from '@/features/po/format';
import { tierRole } from '@/lib/po/tier';
import { computeHeadcounts, type HeadcountRow } from '@/features/po/headcount';

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
  /**
   * The check_ins row this device currently sees for the guest, or null when
   * there is none. Void/revive send it along so a queued offline write can only
   * ever hit the row it was aimed at, never a colleague's newer check-in (#35).
   */
  checkInId: string | null;
  /** Door payment required — inert until guest_tiers.door_price lands (#34). */
  pay: boolean;
  inAt?: string;
  inByName?: string;
  arrived?: number;
  /** Turned away at the door (guests.status = 'refused'). */
  refused: boolean;
  /** Latest refusal reason, for the "Geweigerd" lijst. */
  refusedReason?: string;
}

export interface DoorView {
  event: DoorEventMeta;
  /** Active guests (onderweg / binnen) — refused are split out below. */
  guests: DoorGuest[];
  /** Geweigerde gasten — shown apart so a foutje is terug te vinden + ongedaan te maken. */
  refused: DoorGuest[];
  tiers: TierRow[];
  /** Guest ROWS (reservations) inside / still onderweg — the door's per-name unit. */
  insideCount: number;
  waitingCount: number;
  /** KOPPEN (incl. +1's, #5) inside / still onderweg — matches EventView/cockpit.
   *  The door shows both units side by side so "1500 gasten · 2100 koppen" is
   *  never ambiguous (S1.3). A partial party splits across the two head totals. */
  insideHeadcount: number;
  waitingHeadcount: number;
}

export interface DoorTask {
  guest: DoorGuest;
  high: boolean;
  done: boolean;
}

const FALLBACK_TIER_COLOR = '#8E8E93';

// tierRole moved to src/lib/po/tier.ts (FE-2) — this used to duplicate
// adapters.ts's version (same taxonomy, different return shape); re-exported
// here so existing importers of './model' (GuestDetail.tsx, model.test.ts)
// don't need to change. Since the 1/7 feedback the door renders the REAL tier
// name everywhere (two tiers matching "vip" must stay distinguishable) — this
// taxonomy only picks the ICON; `.label` is a fallback for a guest whose tier
// row is missing.
export { tierRole };

export function lastFour(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : digits || null;
}

// Pin the door's date/time display to the venue's wall clock. Without an explicit
// timeZone these render in the DEVICE's local zone, so a door phone set to a
// non-CET timezone (or a traveller's laptop) shows check-in times that disagree
// with the cockpit standing beside it (C28). The whole product renders in
// Europe/Amsterdam; the door was the one place that didn't — formatShortDate/
// formatTime (imported above, FE-2's src/features/po/format.ts) are the shared,
// pinned source now; no local formatDate/formatTime wrapper needed (neither
// had any importer outside this file).

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
  refusedReason?: string,
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
    // The REAL tier name — custom tiers keep their identity ("VIP + fles op
    // tafel" ≠ "VIP", feedback 1/7). tierRole only supplies the icon now.
    tierName: tier?.name ?? role.label,
    tierColor: tier?.color ?? FALLBACK_TIER_COLOR,
    tierIcon: role.icon,
    // added_by is NULL only for auto-approved request-link guests (F1) — the
    // system, not a person, put them on the list.
    addedByName: g.added_by ? profiles[g.added_by] ?? 'Unknown' : 'Via request link',
    addedAt: formatShortDate(g.created_at),
    last4: lastFour(g.phone),
    note: g.note,
    notePriority: g.note_priority,
    acknowledged: g.note_acknowledged_at != null,
    ackByName: g.note_acknowledged_by ? profiles[g.note_acknowledged_by] : undefined,
    inside: active,
    voided: ci != null && ci.voided_at != null,
    checkInId: ci?.id ?? null,
    pay: false,
    inAt: active ? formatDateTime(ci.checked_at) : undefined,
    inByName: active ? profiles[ci.checked_by] ?? 'Door' : undefined,
    arrived: active ? ci.plus_ones_arrived : undefined,
    refused: g.status === 'refused',
    refusedReason,
  };
}

export function buildDoorView(snapshot: DoorSnapshot): DoorView {
  const tierById = new Map(snapshot.tiers.map((t) => [t.id, t]));
  const checkInByGuest = indexCheckIns(snapshot.checkIns);

  // Latest refusal reason per guest. Refusals are already in time order: the DB
  // query uses .order('id') (UUIDv7 = monotonic) and optimistic appends go last,
  // so a plain iteration where later writes win gives us the most recent reason.
  const reasonByGuest = new Map<string, string>();
  for (const r of snapshot.refusals) {
    reasonByGuest.set(r.guest_id, r.reason);
  }

  // Split by the denormalised guests.status (authoritative; an undone refusal is
  // back to 'approved' even though its refusal row remains in history).
  const guests: DoorGuest[] = [];
  const refused: DoorGuest[] = [];
  for (const g of snapshot.guests) {
    if (g.status === 'refused') {
      refused.push(toDoorGuest(g, tierById, checkInByGuest, snapshot.profiles, reasonByGuest.get(g.id)));
    } else {
      guests.push(toDoorGuest(g, tierById, checkInByGuest, snapshot.profiles));
    }
  }

  // Canonical M4 selector (spec #44) — the SAME reducer the cockpit uses
  // (src/features/po/headcount.ts), so the two never drift apart again (K-10).
  // `refused` never contributes; `guests` (active list) supplies on-list/inside/
  // on-the-way, koppen-aware (#5) and partial-check-in-aware.
  const rows: HeadcountRow[] = guests.map((g) => ({
    status: g.inside ? 'in' : 'wait',
    plus: g.plus,
    arrivedPlus: g.inside ? g.arrived : undefined,
  }));
  const hc = computeHeadcounts(rows);
  return {
    event: snapshot.event,
    guests,
    refused,
    tiers: snapshot.tiers,
    insideCount: hc.insideRows,
    waitingCount: hc.onTheWayRows,
    insideHeadcount: hc.insideHeads,
    waitingHeadcount: hc.onTheWayHeads,
  };
}

/** Tasks (#39): every guest with a note is an opdracht; high priority first;
 *  done = acknowledged ("Gezien & opgepakt"). Matches the prototype's Taken tab. */
export function buildTasks(view: DoorView): DoorTask[] {
  return view.guests
    .filter((g) => !!g.note)
    .map((g) => ({ guest: g, high: g.notePriority === 'high', done: g.acknowledged }));
}
