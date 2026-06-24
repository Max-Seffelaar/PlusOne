'use client';

/** Guest list, guest detail (read-only logboek — check-in lives at the door,
 *  Deur tab), quick-add (#33), bulk-paste, adresboek, permanente gasten. */
import { useState, useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { v7 as uuidv7 } from 'uuid';
import { cn } from '@/lib/utils';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import type { Guest as GuestT, PoEvent } from '@/lib/po/types';
import { normalizeImportPhone } from '@/features/contacts/import/parse';
import type { ContactRole } from '@/features/contacts/schemas';
import { indexGuestsByName, suspectedDuplicates, planBulkAdd, type DupeMode, type BulkRowInput } from '@/features/guests/bulk-dedupe';
import {
  parseQuickAdd,
  parseBulk,
  resolveAmbiguity,
  totalSlots,
  type QuickAddTier,
  type AmbiguityChoice,
  type ParseResult,
} from '@/features/guests/quick-add-parser';
import { resolveDefaultTierId } from '@/features/guests/tiers';
import { usePoEvents, usePoGuests, usePoTiers, usePoQuota, usePoContacts, usePoPermanentContacts } from '@/features/po/hooks';
import {
  usePoAddGuest,
  usePoAddGuestsBulk,
  usePoRequestExtraSlots,
  usePoToggleContactPermanent,
  usePoAddContactToEvent,
  usePoSyncPermanent,
  usePoUpsertContact,
  usePoForgetContact,
  usePoUpdateGuest,
  usePoCreateTier,
} from '@/features/po/mutations';
import type { PoContact } from '@/features/po/adapters';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { canManageGuests } from '@/features/auth/roles';
import { venueCapabilities } from '@/features/venues/access';
import { t, fmt } from '@/lib/i18n';
import { useNav } from '../context';
import { Icon, type IconName } from '../icon';
import { Avatar, Btn, Empty, Field, IconBtn, Label, MiniChip, Note, PayChip, RoleChip, Scroll, StatusDot, Stepper, Top } from '../kit';
import { BottomBar, Sheet } from '../shell';

const cardPress = 'transition-[border-color,transform] hover:border-white/[0.24] active:scale-[0.99]';
const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';
const col = 'flex h-full flex-col';

/** Radio-style option row for the "already on the list" choice (bulk add). */
function DupeOption({ on, onClick, title, sub }: { on: boolean; onClick: () => void; title: string; sub: string }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('flex items-center gap-[11px] rounded-[12px] border px-[13px] py-[10px] text-left', press, on ? 'border-transparent bg-bg' : 'border-line bg-transparent')}
    >
      <span className={cn('flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border-2', on ? 'border-acc' : 'border-ghost')}>
        {on && <span className="h-[10px] w-[10px] rounded-full bg-acc" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[13.5px] font-bold text-text">{title}</span>
        <span className="block text-[11.5px] text-faint">{sub}</span>
      </span>
    </button>
  );
}

// ── NO-TIERS ESCAPE HATCH ────────────────────────────────────────────────────
// Shared by all three add flows (QuickAdd / BulkPaste / AddToEventSheet). When an
// event has no tiers yet the flows used to dead-end ("add one in event settings");
// now an admin/organizer can create the first tier inline and the add continues.
// No "default" flag exists on guest_tiers — resolveDefaultTierId picks the only/
// first tier — so the moment usePoCreateTier invalidates the tiers query the
// parent re-resolves defaultTierId, this block unmounts, and the add UI appears.
// `canCreate` mirrors the guest_tiers_insert RLS (admin OR event organizer,
// surfaced via the quota `exempt` flag); everyone else gets a "ask a beheerder"
// note instead of a button that would only fail with a 42501.
function NoTiersBlock({ eventId, canCreate, className }: { eventId: string; canCreate: boolean; className?: string }): JSX.Element {
  const createTier = usePoCreateTier(eventId);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [alias, setAlias] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const nm = name.trim();
    if (!nm || createTier.isPending) return;
    setErr(null);
    try {
      await createTier.mutateAsync({
        eventId,
        name: nm,
        color: '#B5A6FF',
        aliases: alias.split(',').map((a) => a.trim()).filter(Boolean),
      });
      // Success needs no follow-up: the tiers query invalidates → the parent
      // re-renders with a resolved defaultTierId → this block unmounts and the add
      // flow takes over with the brand-new (default) tier selected.
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.guests.tierCreate.error);
    }
  };

  return (
    <div className={cn('rounded-[16px] border border-line bg-elev p-[14px]', className)}>
      <div className="flex items-start gap-[11px]">
        <span className="mt-px shrink-0 text-acc">
          <Icon name="ticket" size={17} />
        </span>
        <div className="flex-1 text-[13.5px] leading-[1.45] text-faint">
          {t.guests.tierCreate.intro}{' '}
          {canCreate ? t.guests.tierCreate.introCreate : t.guests.tierCreate.introAsk}
        </div>
      </div>

      {canCreate && !open && (
        <Btn sm kind="primary" icon="plus" className="mt-3" onClick={() => setOpen(true)}>
          {t.guests.tierCreate.createBtn}
        </Btn>
      )}

      {canCreate && open && (
        <div className="mt-3 flex flex-col gap-[12px]">
          <div>
            <Label className="mb-2">{t.guests.tierCreate.nameLabel}</Label>
            <Field autoFocus placeholder={t.guests.tierCreate.namePlaceholder} value={name} onChange={setName} maxLength={80} />
          </div>
          <div>
            <Label className="mb-2">{t.guests.tierCreate.aliasLabel}</Label>
            <Field icon="spark" placeholder={t.guests.tierCreate.aliasPlaceholder} value={alias} onChange={setAlias} />
          </div>
          {err && (
            <p className="text-[12.5px] text-red-300" role="alert">
              {err}
            </p>
          )}
          <div className="flex gap-2">
            <Btn
              kind="primary"
              icon="check"
              disabled={!name.trim() || createTier.isPending}
              className={!name.trim() || createTier.isPending ? 'opacity-[0.45]' : ''}
              onClick={() => void submit()}
            >
              {createTier.isPending ? t.guests.tierCreate.busy : t.guests.tierCreate.createBtn}
            </Btn>
            <Btn
              kind="ghost"
              onClick={() => {
                setOpen(false);
                setErr(null);
              }}
            >
              {t.guests.tierCreate.cancel}
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ── GUEST LIST (pushed) ──────────────────────────────────────────────────────
// Feedback (Joeri, 24 jun 2026): the On the way / Inside / VIP filter chips were
// removed — they weren't logical on the management list (status lives at the
// door). Search is the only filter here now.

/** Pure search filter for the gastenlijst — extracted so it's memoizable + testable. */
function filterGuestList(guests: GuestT[], q: string): GuestT[] {
  const term = q.trim().toLowerCase();
  return term ? guests.filter((g) => g.name.toLowerCase().includes(term)) : guests;
}

export function Lijst({ ev }: { ev: PoEvent }): JSX.Element {
  const nav = useNav();
  const { data: guests = [], isLoading, isError } = usePoGuests(ev.id);
  const [q, setQ] = useState('');
  // Input stays instant; the expensive filter runs on the settled term (#1b).
  const dq = useDebouncedValue(q, 140);
  const gs = useMemo(() => filterGuestList(guests, dq), [guests, dq]);
  const openGuest = (id: string): void => nav.push('guest', { id, eventId: ev.id });
  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.guests.list.title} sub={`${ev.name} · ${fmt(t.guests.list.sub, { shown: gs.length, total: guests.length })}`} right={<IconBtn name="plus" onClick={() => nav.push('quickadd', { id: ev.id })} />} />
      {/* Toolbar — stacked on mobile, a single row on desktop. */}
      <div className="flex-none px-4 lg:flex lg:items-center lg:gap-3 lg:pb-3">
        <div className="pb-[10px] lg:max-w-[300px] lg:flex-1 lg:pb-0">
          <Field icon="search" placeholder={t.guests.list.searchPlaceholder} value={q} onChange={setQ} />
        </div>
        <div className="flex gap-2 pb-3 lg:ml-auto lg:pb-0">
          <Btn sm kind="primary" icon="plus" onClick={() => nav.push('quickadd', { id: ev.id })}>
            {t.guests.list.addGuest}
          </Btn>
          <Btn sm kind="quiet" icon="paste" onClick={() => nav.push('bulk', { id: ev.id })}>
            {t.guests.list.pasteList}
          </Btn>
          <Btn sm kind="quiet" icon="contact" onClick={() => nav.push('contacten', { id: ev.id })}>
            {t.guests.list.contacts}
          </Btn>
        </div>
      </div>
      {isLoading ? (
        <Scroll pad={16} bottom={24}>
          <Empty text={t.guests.list.loading} />
        </Scroll>
      ) : isError ? (
        <Scroll pad={16} bottom={24}>
          <Empty text={t.guests.list.loadError} />
        </Scroll>
      ) : gs.length === 0 ? (
        <Scroll pad={16} bottom={24}>
          <Empty text={q ? t.guests.list.emptyFiltered : t.guests.list.empty} />
        </Scroll>
      ) : (
        <>
          {/* Mobile: virtualized stacked cards (the @1500 case). */}
          <GuestCardList rows={gs} onOpen={openGuest} />
          {/* Desktop: virtualized dense table — more rows per screen + a "toegevoegd door" column. */}
          <GuestTable rows={gs} onOpen={openGuest} />
        </>
      )}
    </div>
  );
}

// Mobile card ≈ avatar 34 + py-8 + one line (denser, feedback Joeri); desktop row ≈ avatar 36 + py-11.
const GUEST_CARD_EST = 52;
const GUEST_ROW_EST = 58;

/** Virtualized mobile card list (own scroll parent → the virtualizer windows it). */
function GuestCardList({ rows, onOpen }: { rows: GuestT[]; onOpen: (id: string) => void }): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => GUEST_CARD_EST,
    overscan: 8,
    getItemKey: (i) => rows[i]?.id ?? i,
  });
  return (
    <div ref={scrollRef} className="po-scroll min-h-0 flex-1 overflow-y-auto lg:hidden" style={{ padding: '0 16px 24px' }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const g = rows[vi.index];
          if (!g) return null;
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
            >
              {/* Dense single-line card (feedback Joeri): more names per screen. */}
              <div className="pb-[7px]">
                <button type="button" onClick={() => onOpen(g.id)} className={cn('flex w-full items-center gap-[10px] rounded-[12px] border border-line bg-elev px-[11px] py-[8px] text-left', cardPress)}>
                  <Avatar name={g.name} size={34} accent={g.role === 'VIP'} />
                  <span className="min-w-0 flex-1 truncate font-display text-[14.5px] font-bold text-text">
                    {g.name}
                    {g.plus > 0 && <span className="font-semibold text-faint"> +{g.plus}</span>}
                  </span>
                  {g.note && (
                    <span className="shrink-0 text-acc-soft">
                      <Icon name="note" size={13} />
                    </span>
                  )}
                  {g.pay === 'pay' && <PayChip pay="pay" />}
                  <RoleChip role={g.role} />
                  {g.status === 'refused' ? (
                    <span className="shrink-0 rounded-[7px] border border-line2 px-2 py-[3px] font-body text-[11px] font-bold text-faint">{t.guests.list.refused}</span>
                  ) : (
                    <StatusDot status={g.status} label={false} />
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Virtualized desktop table. The header stays sticky; the rows window inside the
 * scroll area as a positioned <tbody> (absolute <tr>s with translateY) so we keep
 * a real <table> for column sizing while only mounting the visible rows. Rows use
 * a CSS grid (matching the header columns) since absolute <tr>s leave normal
 * table layout.
 */
function GuestTable({ rows, onOpen }: { rows: GuestT[]; onOpen: (id: string) => void }): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => GUEST_ROW_EST,
    overscan: 12,
    getItemKey: (i) => rows[i]?.id ?? i,
  });
  const cols = 'grid-cols-[1fr_120px_120px_170px_110px]';
  return (
    <div ref={scrollRef} className="po-scroll hidden min-h-0 flex-1 overflow-y-auto lg:block" style={{ padding: '0 16px 24px' }}>
      <div className="overflow-hidden rounded-[16px] border border-line bg-elev">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-[1]">
            <tr className={cn('grid bg-elev2', cols, '[&>th]:px-3 [&>th]:py-[11px] [&>th]:font-body [&>th]:text-[11px] [&>th]:font-bold [&>th]:uppercase [&>th]:tracking-[0.04em] [&>th]:text-faint')}>
              <th className="!pl-4">{t.guests.list.colGuest}</th>
              <th>{t.guests.list.colRole}</th>
              <th>{t.guests.list.colPayment}</th>
              <th>{t.guests.list.colAdded}</th>
              <th className="!pr-4 text-right">{t.guests.list.colStatus}</th>
            </tr>
          </thead>
          <tbody className="block" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const g = rows[vi.index];
              if (!g) return null;
              return (
                <tr
                  key={vi.key}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  onClick={() => onOpen(g.id)}
                  className={cn('grid w-full cursor-pointer items-center border-t border-line2 transition-colors hover:bg-elev2', cols, '[&>td]:px-3 [&>td]:py-[11px] [&>td]:align-middle')}
                  style={{ position: 'absolute', top: 0, left: 0, transform: `translateY(${vi.start}px)` }}
                >
                  <td className="!pl-4">
                    <div className="flex items-center gap-[11px]">
                      <Avatar name={g.name} size={36} accent={g.role === 'VIP'} />
                      <span className="min-w-0">
                        <span className="font-display text-[14.5px] font-bold text-text">
                          {g.name}
                          {g.plus > 0 && <span className="font-semibold text-faint"> +{g.plus}</span>}
                        </span>
                        {g.note && (
                          <span className="mt-0.5 block max-w-[280px] truncate text-[12px] text-acc-soft">{g.note}</span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td>
                    <RoleChip role={g.role} />
                  </td>
                  <td>{g.pay === 'pay' ? <PayChip pay="pay" /> : <span className="text-[12.5px] text-faint">—</span>}</td>
                  <td>
                    <span className="text-[13px] text-dim">{g.by || '—'}</span>
                    {g.addedAt && <span className="ml-1.5 font-display text-[12px] text-faint">{g.addedAt}</span>}
                  </td>
                  <td className="!pr-4 flex justify-end text-right">
                    {g.status === 'refused' ? (
                      <span className="rounded-[7px] border border-line2 px-2 py-[3px] font-body text-[11px] font-bold text-faint">{t.guests.list.refused}</span>
                    ) : (
                      <StatusDot status={g.status} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── GUEST detail / check-in (pushed) ─────────────────────────────────────────
function LogRow({ icon, label, who, when, accent, last }: { icon: IconName; label: string; who: string; when?: string; accent?: boolean; last?: boolean }): JSX.Element {
  return (
    <div className={cn('flex items-center gap-[12px] py-[12px]', last ? '' : 'border-b border-line2')}>
      <span className={cn('flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px]', accent ? 'bg-acc-dim text-acc' : 'bg-elev2 text-dim')}>
        <Icon name={icon} size={15} sw={2} />
      </span>
      <span className="flex-1 text-[13.5px] text-faint">{label}</span>
      <span className="text-right">
        <span className={cn('text-[13.5px] font-semibold', accent ? 'text-acc' : 'text-text')}>{who}</span>
        {when && <span className="ml-[7px] font-display text-[12px] text-faint">{when}</span>}
      </span>
    </div>
  );
}

export function Guest({ g }: { g: GuestT }): JSX.Element {
  const nav = useNav();
  // Read-only management detail. The live door state is mirrored onto the guest's
  // own row (checked_in → 'in', refused → 'refused'); the interactive check-in /
  // uncheck / refuse / note-ack live at the door now (Deur tab → DoorProvider,
  // offline outbox), not here.
  const isIn = g.status === 'in';
  const isRefused = g.status === 'refused';
  const hasTask = !!g.note;

  return (
    <div className={col}>
      <Top
        onBack={nav.back}
        title={t.guests.detail.title}
        right={
          <>
            <IconBtn name="share" />
            <IconBtn name="dots" />
          </>
        }
      />
      <Scroll bottom={24}>
        <div className="flex flex-col items-center px-0 pb-[18px] pt-1.5 text-center">
          <Avatar name={g.name} size={84} accent={g.role === 'VIP'} />
          <h2 className="mb-0 mt-4 whitespace-nowrap font-display text-[28px] font-extrabold tracking-[-0.02em] text-text">{g.name}</h2>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-[7px]">
            <RoleChip role={g.role} />
            {g.pay === 'pay' ? (
              <PayChip pay="pay" />
            ) : (
              <span className={cn('rounded-[7px] px-2 py-[3px] text-[11px] font-bold', g.pay === 'paid' ? 'border border-transparent bg-acc-dim text-acc' : 'border border-line2 text-faint')}>
                {g.pay === 'paid' ? t.guests.detail.paid : t.guests.detail.free}
              </span>
            )}
            {isRefused && (
              <span className="inline-flex items-center gap-[5px] rounded-[7px] border border-line2 px-2 py-[3px] font-body text-[11px] font-bold text-faint">
                <Icon name="close" size={11} sw={2.4} />
                {t.guests.detail.refused}
              </span>
            )}
          </div>
        </div>

        {hasTask && (
          <div className={cn('mb-[10px] rounded-[14px] p-[14px]', g.flag === 'high' ? 'border border-transparent bg-acc-dim' : 'border border-line bg-elev')}>
            <div className="mb-[7px] flex items-center gap-[7px]">
              <Icon name="flag" size={15} stroke={g.flag === 'high' ? '#B5A6FF' : 'rgba(255,255,255,0.40)'} fill={g.flag === 'high' ? '#B5A6FF' : 'none'} />
              <Label className={g.flag === 'high' ? 'text-acc-soft' : 'text-faint'}>{g.flag === 'high' ? t.guests.detail.taskPriority : t.guests.detail.task}</Label>
            </div>
            <div className="text-[15px] leading-[1.45] text-text">{g.note}</div>
            <div className="mt-[10px] text-[12px] text-faint">{t.guests.detail.taskAtDoor}</div>
          </div>
        )}

        <Label className="mx-0.5 mb-[10px] mt-1.5">{t.guests.detail.log}</Label>
        <div className="mb-4 rounded-[14px] border border-line bg-elev px-[14px] py-1">
          <LogRow icon="user" label={t.guests.detail.logAdded} who={g.by || '—'} when={g.addedAt} />
          {g.plus > 0 && <LogRow icon="users" label={t.guests.detail.logPlusOnes} who={fmt(t.guests.detail.logPlusOnesValue, { n: g.plus })} />}
          {isIn ? (
            <LogRow icon="check2" label={t.guests.detail.logCheckedIn} who={g.inBy ?? t.guests.detail.logActorDoor} when={g.at} accent last />
          ) : isRefused ? (
            <LogRow icon="close" label={t.guests.detail.logRefused} who={t.guests.detail.logRefusedWho} last />
          ) : (
            <LogRow icon="clock" label={t.guests.detail.logNotInYet} who={t.guests.detail.logOnTheWay} last />
          )}
        </div>
      </Scroll>
    </div>
  );
}

// ── QUICK-ADD (#33) ──────────────────────────────────────────────────────────
interface JustAdded {
  id: string;
  name: string;
  plus: number;
  tierShort: string;
  vip: boolean;
  /** True when this row updated an existing guest's plekken (dupe add/replace) rather than inserting. */
  updated?: boolean;
}

function PreviewChip({ icon, dot, label }: { icon?: IconName; dot?: string; label: string }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[9px] border border-line bg-elev2 px-[11px] py-1.5 font-display text-[13px] font-bold text-text">
      {dot && <span className="h-[9px] w-[9px] rounded-full" style={{ background: dot }} />}
      {icon && <Icon name={icon} size={13} className="text-faint" />}
      {label}
    </span>
  );
}

export function QuickAdd({ eventId }: { eventId?: string }): JSX.Element {
  const nav = useNav();
  const { data: liveEvents = [] } = usePoEvents();
  const upcoming = liveEvents.filter((e) => e.when === 'upcoming');
  const [curId, setCurId] = useState<string | undefined>(eventId);
  const curEv = liveEvents.find((e) => e.id === curId) ?? upcoming[0] ?? liveEvents[0];
  const evId = curEv?.id ?? '';

  const { data: tiers = [] } = usePoTiers(evId);
  const { data: quota } = usePoQuota(evId);
  const add = usePoAddGuest(evId);
  const update = usePoUpdateGuest(evId);
  // The event's existing guests drive duplicate detection (S2.2). RLS-scoped, so
  // staff only match against their own guests — exactly the rows they may update.
  const { data: liveGuests = [] } = usePoGuests(evId);
  const reqExtra = usePoRequestExtraSlots(evId);
  const { roles } = usePoIdentity();

  const [val, setVal] = useState('');
  const [choice, setChoice] = useState<AmbiguityChoice | null>(null);
  const [added, setAdded] = useState<JustAdded[]>([]);
  const [evPick, setEvPick] = useState(false);
  const [reqOpen, setReqOpen] = useState(false);
  const [reqMotiv, setReqMotiv] = useState('');
  // null until the user picks how to handle a name that's already on the list.
  const [dupeMode, setDupeMode] = useState<DupeMode | null>(null);

  const qaTiers: QuickAddTier[] = tiers.map((t) => ({ id: t.id, name: t.name, aliases: t.aliases }));
  const defaultTierId = resolveDefaultTierId(qaTiers);

  // Parse against the LIVE tiers with the shared #33 parser (same one the desktop
  // quick-add uses), so behaviour — fuzzy match, NL +N, ambiguity — is identical.
  const parsed = defaultTierId && val.trim() ? parseQuickAdd(val, qaTiers, defaultTierId) : null;
  const isAmbiguous = parsed?.status === 'ambiguous';
  const resolved =
    isAmbiguous && choice && parsed && defaultTierId ? resolveAmbiguity(parsed, choice, defaultTierId) : null;

  const effName = (resolved ? resolved.name : parsed?.name ?? '').trim();
  const effPlus = resolved ? resolved.plusOnes : parsed?.plusOnes ?? 0;
  const effTierId = resolved?.tierId ?? parsed?.tierId ?? defaultTierId ?? '';
  const effTier = tiers.find((t) => t.id === effTierId);
  const cost = 1 + effPlus;

  // Duplicate detection (S2.2): does the typed name already match a guest on this
  // event? Same name-only match + 3-choice as bulk-paste (planBulkAdd), so the
  // pattern is identical across quick + bulk. (The address book keeps its own
  // 2-choice — a known contact has no "different person, same name" case.)
  const byName = useMemo(
    () => indexGuestsByName(liveGuests.map((g) => ({ id: g.id, name: g.name, plusOnes: g.plus }))),
    [liveGuests],
  );
  const dupe = effName ? byName.get(effName.trim().toLowerCase()) ?? null : null;
  // A dupe forces an explicit choice before submit; 'again' (insert) vs add/replace (update).
  const needsDupeChoice = !!dupe && dupeMode === null;
  const willInsert = !dupe || dupeMode === 'again';

  const exempt = quota?.exempt ?? false;
  const remaining = exempt ? null : quota?.remaining ?? null;
  const overQuota = remaining !== null && cost > remaining;
  // Hide the quick-add for roles that can't create guests (user_manager/finance):
  // RLS would reject the insert with a confusing 42501, so gate the UI instead.
  // admin/staff/doorhost qualify via role; an event organizer via the exempt flag.
  const canAdd = exempt || canManageGuests(roles);
  const reqShortfall = remaining !== null ? Math.max(1, cost - remaining) : 1;
  const needsAsk = !!isAmbiguous && !choice;
  // Quota only gates the INSERT path; an add/replace on an existing guest is a
  // delta the DB enforces, so don't block it on the new-guest cost.
  const blockForQuota = overQuota && willInsert;
  const canSubmit =
    !add.isPending && !update.isPending && !!defaultTierId && !!evId && effName !== '' && !needsAsk && !needsDupeChoice && !blockForQuota;

  const onInput = (v: string): void => {
    setVal(v);
    setChoice(null);
    setDupeMode(null);
    setReqOpen(false);
    reqExtra.reset();
  };

  const commit = (): void => {
    if (!canSubmit || !effTier) return;
    // Reuse the bulk planner with a single row, so quick + bulk split inserts vs
    // plus-ones updates identically. mode defaults to 'again' when there's no dupe.
    const row: BulkRowInput = {
      name: effName,
      plusOnes: effPlus,
      tierId: effTierId,
      email: parsed?.email ?? undefined,
      phone: parsed?.phone ?? undefined,
    };
    const plan = planBulkAdd([row], byName, dupeMode ?? 'again');

    // Update path: erbij optellen / nieuw aantal on the matched existing guest.
    if (plan.updates.length > 0) {
      const u = plan.updates[0];
      update.mutate(
        { guestId: u.guestId, plusOnes: u.plusOnes },
        {
          onSuccess: () => {
            setAdded((a) => [
              { id: u.guestId, name: effName, plus: u.plusOnes, tierShort: effTier.short, vip: effTier.role === 'VIP', updated: true },
              ...a,
            ]);
            setVal('');
            setChoice(null);
            setDupeMode(null);
          },
        },
      );
      return;
    }

    // Insert path (no dupe, or "toch opnieuw toevoegen"). Client UUIDv7 so the
    // optimistic row and the inserted row share an id (#25) — the list reconciles
    // without a flash when invalidation refetches.
    const id = uuidv7();
    const snapshot: JustAdded = { id, name: effName, plus: effPlus, tierShort: effTier.short, vip: effTier.role === 'VIP' };
    add.mutate(
      {
        id,
        eventId: evId,
        tierId: effTierId,
        fullName: effName,
        plusOnes: effPlus,
        email: parsed?.email ?? undefined,
        phone: parsed?.phone ?? undefined,
        source: 'app',
      },
      {
        onSuccess: () => {
          setAdded((a) => [snapshot, ...a]);
          setVal('');
          setChoice(null);
          setDupeMode(null);
        },
      },
    );
  };

  const sub = !curEv
    ? t.guests.add.subNoEvent
    : exempt
      ? t.guests.add.subUnlimited
      : remaining !== null && quota
        ? fmt(t.guests.add.subQuota, { n: remaining, m: quota.quota })
        : t.guests.add.subFallback;

  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.guests.add.title} sub={sub} right={<IconBtn name="paste" onClick={() => nav.push('bulk', curEv ? { id: curEv.id } : {})} />} />
      <Scroll bottom={120}>
        <Label className="mb-2">{t.guests.add.eventLabel}</Label>
        {curEv ? (
          <button type="button" onClick={() => setEvPick(true)} className={cn('mb-4 flex w-full items-center gap-[13px] rounded-[14px] border border-line bg-elev px-[14px] py-[13px] text-left', press)}>
            <span className="w-[40px] shrink-0 text-center">
              <span className="block font-display text-[18px] font-extrabold leading-none text-text">{curEv.date}</span>
              <span className="mt-0.5 block text-[9.5px] font-bold tracking-[0.05em] text-faint">{curEv.mon}</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-[15.5px] font-bold text-text">{curEv.name}</span>
              <span className="mt-px block text-[12.5px] text-faint">
                {fmt(t.guests.add.eventDoors, { time: curEv.time, venue: curEv.venue })}
              </span>
            </span>
            <span className="text-acc">
              <Icon name="chevD" size={18} />
            </span>
          </button>
        ) : (
          <div className="mb-4">
            <Empty text={t.guests.add.noUpcoming} />
          </div>
        )}

        {curEv && !canAdd && (
          <div className="rounded-[16px] border border-line bg-elev p-[14px] text-[13.5px] leading-[1.45] text-faint">
            {t.guests.add.noRights}
          </div>
        )}

        {curEv && canAdd && !defaultTierId && <NoTiersBlock eventId={evId} canCreate={exempt} />}

        {curEv && canAdd && defaultTierId && (
          <>
            <Label className="mb-2">{t.guests.add.inputLabel}</Label>
            <div className={cn('rounded-[16px] border bg-elev px-[15px] py-[14px] transition-colors', parsed ? 'border-acc' : 'border-line')}>
              <input
                autoFocus
                value={val}
                onChange={(e) => onInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSubmit) commit();
                }}
                placeholder={t.guests.add.inputPlaceholder}
                className="w-full border-none bg-transparent font-display text-[18px] font-bold tracking-[-0.01em] text-text outline-none placeholder:text-faint"
              />
              {parsed && (
                <div className="mt-[13px] flex flex-wrap gap-[7px]">
                  <PreviewChip icon="user" label={effName || '—'} />
                  {effPlus > 0 && <PreviewChip icon="users" label={`+${effPlus}`} />}
                  {!needsAsk && effTier && <PreviewChip dot={effTier.color} label={effTier.short} />}
                  {needsAsk && parsed.ambiguous && (
                    <MiniChip className="border-dashed border-acc text-text">“{parsed.ambiguous.text}” ?</MiniChip>
                  )}
                </div>
              )}
            </div>

            {needsAsk && parsed?.ambiguous && (
              <div className="mt-3 rounded-[16px] bg-acc-dim p-[14px]">
                <div className="mb-[11px] text-[13.5px] leading-[1.45] text-text">
                  {fmt(t.guests.add.ambiguityQuestion, { x: parsed.ambiguous.text })}
                </div>
                <div className="flex flex-col gap-2">
                  {parsed.ambiguous.suggestions.map((s) => {
                    const tier = tiers.find((x) => x.id === s.tierId);
                    return (
                      <button key={s.tierId} type="button" onClick={() => setChoice({ kind: 'tier', tierId: s.tierId })} className={cn('flex items-center gap-[10px] rounded-[12px] border border-line bg-bg px-[13px] py-[12px] text-text', press)}>
                        <span className="h-[10px] w-[10px] rounded-full" style={{ background: tier?.color ?? '#B5A6FF' }} />
                        <span className="flex-1 text-left font-display text-[14.5px] font-bold">{s.tierName}</span>
                        <Icon name="chev" size={16} className="text-ghost" />
                      </button>
                    );
                  })}
                  <button type="button" onClick={() => setChoice({ kind: 'default' })} className={cn('flex items-center gap-[10px] rounded-[12px] border border-line bg-bg px-[13px] py-[12px] text-text', press)}>
                    <Icon name="ticket" size={15} className="text-faint" />
                    <span className="flex-1 text-left font-display text-[14.5px] font-bold">{tiers.find((x) => x.id === defaultTierId)?.short ?? t.guests.add.choiceDefault}</span>
                    <Icon name="chev" size={16} className="text-ghost" />
                  </button>
                  <button type="button" onClick={() => setChoice({ kind: 'name' })} className={cn('flex items-center gap-[10px] rounded-[12px] border border-line bg-bg px-[13px] py-[12px] text-text', press)}>
                    <Icon name="user" size={15} className="text-faint" />
                    <span className="flex-1 text-left font-display text-[14.5px] font-bold">{t.guests.add.choiceName}</span>
                    <Icon name="chev" size={16} className="text-ghost" />
                  </button>
                </div>
              </div>
            )}

            {!needsAsk && dupe && (
              <div className="mt-3 rounded-[16px] border border-acc bg-acc-dim p-[14px]">
                <div className="mb-1 flex items-center gap-2">
                  <Icon name="warn" size={16} stroke="#B5A6FF" />
                  <Label className="text-acc-soft">{t.guests.add.dupeTitle}</Label>
                </div>
                <div className="mb-3 text-[12.5px] leading-[1.45] text-text">
                  <b>{dupe.name}</b>
                  {dupe.plusOnes > 0 ? (
                    <>
                      {t.guests.add.dupeOnListWith}
                      <b>+{dupe.plusOnes}</b>
                      {fmt(t.guests.add.dupeOnListSlots, { slots: dupe.plusOnes === 1 ? t.guests.add.slotOne : t.guests.add.slotMany })}
                    </>
                  ) : (
                    t.guests.add.dupeOnListNoExtra
                  )}
                  {t.guests.add.dupeWhatToDo}
                </div>
                <div className="flex flex-col gap-1.5">
                  <DupeOption on={dupeMode === 'add'} onClick={() => setDupeMode('add')} title={t.guests.add.dupeAddTitle} sub={fmt(t.guests.add.dupeAddSub, { total: dupe.plusOnes + effPlus, current: dupe.plusOnes })} />
                  <DupeOption on={dupeMode === 'replace'} onClick={() => setDupeMode('replace')} title={t.guests.add.dupeReplaceTitle} sub={fmt(t.guests.add.dupeReplaceSub, { n: effPlus, current: dupe.plusOnes })} />
                  <DupeOption on={dupeMode === 'again'} onClick={() => setDupeMode('again')} title={t.guests.add.dupeAgainTitle} sub={t.guests.add.dupeAgainSub} />
                </div>
              </div>
            )}

            {parsed && !needsAsk && !dupe && !exempt && remaining !== null && (
              <div className={cn('mt-3 flex items-center gap-[9px] rounded-[13px] px-[14px] py-[11px]', overQuota ? 'border border-acc bg-white/[0.04]' : 'border border-line bg-elev')}>
                <Icon name="ticket" size={17} stroke={overQuota ? '#B5A6FF' : 'rgba(255,255,255,0.40)'} />
                <span className="flex-1 text-[13.5px] text-text">
                  {fmt(t.guests.add.quotaCost, { cost, slots: cost === 1 ? t.guests.add.slotOne : t.guests.add.slotMany })}
                  {overQuota
                    ? fmt(t.guests.add.quotaOver, { remaining, over: cost - remaining })
                    : fmt(t.guests.add.quotaLeftAfter, { left: remaining - cost })}
                </span>
                {overQuota && <MiniChip className="border-acc text-acc">{t.guests.add.quotaFull}</MiniChip>}
              </div>
            )}

            {!dupe && overQuota && parsed && !needsAsk ? (
              reqExtra.isSuccess ? (
                <div className="mt-[10px] flex items-center gap-[9px] rounded-[13px] border border-acc bg-acc-dim px-[14px] py-[11px] text-[13px] text-text">
                  <Icon name="check" size={16} stroke="#B5A6FF" />
                  <span className="flex-1">{t.guests.add.requestSent}</span>
                </div>
              ) : reqOpen ? (
                <div className="mt-[10px] flex flex-col gap-[10px] rounded-[16px] border border-line bg-elev p-[14px]">
                  <Label>
                    {fmt(t.guests.add.requestExtraLabel, { n: reqShortfall, slots: reqShortfall === 1 ? t.guests.add.slotOne : t.guests.add.slotMany })}
                  </Label>
                  <textarea
                    autoFocus
                    value={reqMotiv}
                    onChange={(e) => setReqMotiv(e.target.value)}
                    maxLength={500}
                    rows={2}
                    placeholder={t.guests.add.requestMotivPlaceholder}
                    className="w-full resize-none rounded-[12px] border border-line bg-bg px-[13px] py-[11px] text-[14px] text-text outline-none placeholder:text-faint focus:border-acc"
                  />
                  {reqExtra.isError && (
                    <p className="text-[12.5px] text-acc" role="alert">
                      {reqExtra.error?.message ?? t.guests.add.requestSendFailed}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Btn
                      kind="primary"
                      icon="check"
                      className={cn((reqExtra.isPending || reqMotiv.trim() === '') && 'opacity-[0.45]')}
                      disabled={reqExtra.isPending || reqMotiv.trim() === ''}
                      onClick={() =>
                        reqExtra.mutate({
                          eventId: evId,
                          requestedExtra: reqShortfall,
                          motivation: reqMotiv.trim(),
                        })
                      }
                    >
                      {reqExtra.isPending ? t.guests.add.sending : t.guests.add.send}
                    </Btn>
                    <Btn
                      kind="ghost"
                      onClick={() => {
                        setReqOpen(false);
                        setReqMotiv('');
                      }}
                    >
                      {t.guests.add.cancel}
                    </Btn>
                  </div>
                </div>
              ) : (
                <Btn kind="ghost" full icon="plus" className="mt-[10px]" onClick={() => setReqOpen(true)}>
                  {t.guests.add.requestExtra}
                </Btn>
              )
            ) : null}

            {add.isError && (
              <div className="mt-3 flex items-center gap-[9px] rounded-[13px] border border-acc bg-acc-dim px-[14px] py-[11px] text-[13px] text-text">
                <Icon name="warn" size={16} stroke="#B5A6FF" />
                <span className="flex-1">{add.error?.message}</span>
              </div>
            )}

            {added.length > 0 && (
              <>
                <Label className="mx-0.5 mb-[10px] mt-[22px]">{fmt(t.guests.add.justAdded, { n: added.length })}</Label>
                <div className="flex flex-col gap-2">
                  {added.map((g) => (
                    <div key={g.id} className="flex items-center gap-[11px] rounded-[14px] border border-line bg-elev p-[11px]">
                      <Avatar name={g.name} size={36} accent={g.vip} />
                      <div className="min-w-0 flex-1">
                        <div className="font-display text-[14.5px] font-bold text-text">
                          {g.name}
                          {g.plus > 0 && <span className="text-faint"> +{g.plus}</span>}
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-faint">{g.tierShort}</div>
                      </div>
                      <span className="inline-flex items-center gap-[5px] font-body text-[11.5px] font-bold text-acc">
                        <Icon name="check2" size={13} stroke="#B5A6FF" sw={2.4} />
                        {g.updated ? t.guests.add.chipUpdated : t.guests.add.chipOnList}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </Scroll>
      <BottomBar>
        <Btn kind="primary" full icon="plus" onClick={commit} className={canSubmit ? '' : 'opacity-[0.45]'}>
          {add.isPending || update.isPending
            ? t.guests.add.submitBusy
            : !parsed
              ? t.guests.add.submitTypeName
              : dupe && (dupeMode === 'add' || dupeMode === 'replace')
                ? fmt(t.guests.add.submitUpdate, { name: effName })
                : fmt(t.guests.add.submitAdd, { name: effName || t.guests.add.submitFallbackName, plus: effPlus ? ' +' + effPlus : '' })}
        </Btn>
      </BottomBar>

      {evPick && (
        <Sheet onClose={() => setEvPick(false)} center={false}>
          <div className="mb-1 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">{t.guests.add.pickEventTitle}</div>
          <div className="mb-4 text-[13px] text-faint">{t.guests.add.pickEventSub}</div>
          <div className="flex flex-col gap-2">
            {upcoming.map((e) => {
              const on = e.id === curEv?.id;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => {
                    setCurId(e.id);
                    setEvPick(false);
                  }}
                  className={cn('flex items-center gap-[12px] rounded-[12px] border px-[13px] py-[12px] text-left', on ? 'border-transparent bg-acc-dim' : 'border-line bg-elev', press)}
                >
                  <span className="w-[38px] shrink-0 text-center">
                    <span className="block font-display text-[16px] font-extrabold leading-none text-text">{e.date}</span>
                    <span className="block text-[9px] font-bold tracking-[0.05em] text-faint">{e.mon}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-[14.5px] font-bold text-text">{e.name}</span>
                    <span className="block text-[11.5px] text-faint">{e.venue}</span>
                  </span>
                  {on && <Icon name="check2" size={17} stroke="#B5A6FF" sw={2.4} />}
                </button>
              );
            })}
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ── BULK PASTE (#33) ─────────────────────────────────────────────────────────
interface ResolvedRow {
  name: string;
  plusOnes: number;
  tierId: string;
  needsChoice: boolean;
}

/** Fold a parsed line + the user's chip choice into a final addable row. */
function resolveRow(r: ParseResult, choice: AmbiguityChoice | undefined, defaultTierId: string): ResolvedRow {
  if (r.status === 'ambiguous') {
    if (!choice) return { name: r.name, plusOnes: r.plusOnes, tierId: defaultTierId, needsChoice: true };
    const res = resolveAmbiguity(r, choice, defaultTierId);
    return { name: res.name, plusOnes: res.plusOnes, tierId: res.tierId, needsChoice: false };
  }
  return { name: r.name, plusOnes: r.plusOnes, tierId: r.tierId ?? defaultTierId, needsChoice: false };
}

export function BulkPaste({ eventId }: { eventId?: string }): JSX.Element {
  const nav = useNav();
  const { data: liveEvents = [] } = usePoEvents();
  const upcoming = liveEvents.filter((e) => e.when === 'upcoming');
  const curEv = liveEvents.find((e) => e.id === eventId) ?? upcoming[0] ?? liveEvents[0];
  const evId = curEv?.id ?? '';

  const { data: tiers = [] } = usePoTiers(evId);
  const { data: quota } = usePoQuota(evId);
  const { data: evGuests = [] } = usePoGuests(evId);
  const addBulk = usePoAddGuestsBulk(evId);
  const update = usePoUpdateGuest(evId);

  const qaTiers: QuickAddTier[] = tiers.map((t) => ({ id: t.id, name: t.name, aliases: t.aliases }));
  const defaultTierId = resolveDefaultTierId(qaTiers);

  const [text, setText] = useState('');
  const [choices, setChoices] = useState<Record<number, AmbiguityChoice>>({});
  // What to do with people already on this list: add on top, give a new total, or
  // add them again as a separate row (best-effort name match — they confirm).
  const [dupeMode, setDupeMode] = useState<DupeMode>('add');
  const [busy, setBusy] = useState(false);
  const [orchErr, setOrchErr] = useState<string | null>(null);

  const rows = defaultTierId ? parseBulk(text, qaTiers, defaultTierId) : [];
  const resolvedRows = rows.map((r, i) => resolveRow(r, choices[i], defaultTierId ?? ''));
  const total = totalSlots(resolvedRows.map((r) => ({ plusOnes: r.plusOnes })));
  const doubtful = resolvedRows.filter((r) => r.needsChoice || r.name === '').length;
  const ready = rows.length - doubtful;

  // Match resolved rows against people already on the list (by normalized name).
  const byName = useMemo(
    () => indexGuestsByName(evGuests.map((g) => ({ id: g.id, name: g.name, plusOnes: g.plus }))),
    [evGuests],
  );
  const plannable: BulkRowInput[] = resolvedRows
    .map((r, i) => ({ name: r.name, plusOnes: r.plusOnes, tierId: r.tierId, email: rows[i]?.email ?? undefined, phone: rows[i]?.phone ?? undefined }))
    .filter((r) => r.name !== '');
  const dupNames = suspectedDuplicates(plannable, byName);

  const exempt = quota?.exempt ?? false;
  const remaining = exempt ? null : quota?.remaining ?? null;
  const overQuota = remaining !== null && total > remaining;
  const canConfirm = !busy && rows.length > 0 && doubtful === 0 && !overQuota && !!defaultTierId && !!evId;

  const confirm = async (): Promise<void> => {
    if (!canConfirm) return;
    setOrchErr(null);
    setBusy(true);
    // Split into fresh inserts + plus-ones updates per the chosen duplicate mode.
    const plan = planBulkAdd(plannable, byName, dupeMode);
    try {
      if (plan.inserts.length > 0) {
        // One UUIDv7 per row (#25); the DB enforces the insert batch atomically.
        await addBulk.mutateAsync({
          eventId: evId,
          source: 'app',
          guests: plan.inserts.map((r) => ({ id: uuidv7(), fullName: r.name, plusOnes: r.plusOnes, tierId: r.tierId, email: r.email, phone: r.phone })),
        });
      }
      for (const u of plan.updates) {
        await update.mutateAsync({ guestId: u.guestId, plusOnes: u.plusOnes });
      }
      setText('');
      setChoices({});
      nav.back();
    } catch (e) {
      setOrchErr(e instanceof Error ? e.message : t.guests.bulk.addFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.guests.bulk.title} sub={curEv ? fmt(t.guests.bulk.subTo, { event: curEv.name }) : t.guests.bulk.subFallback} />
      <Scroll bottom={120}>
        {!curEv ? (
          <Empty text={t.guests.bulk.noUpcoming} />
        ) : !defaultTierId ? (
          <NoTiersBlock eventId={evId} canCreate={exempt} />
        ) : (
          <>
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setChoices({});
              }}
              rows={5}
              placeholder={t.guests.bulk.placeholder}
              className="mb-4 w-full resize-y rounded-[14px] border border-line bg-elev p-[14px] font-body text-[14.5px] leading-[1.5] text-text outline-none placeholder:text-faint"
            />
            {rows.length > 0 && (
              <>
                <div className="mb-[10px] flex items-center justify-between">
                  <Label>{fmt(t.guests.bulk.preview, { n: rows.length })}</Label>
                  {doubtful > 0 && <MiniChip className="border-acc text-acc">{fmt(t.guests.bulk.toCheck, { n: doubtful })}</MiniChip>}
                </div>
                <div className="flex flex-col gap-2">
                  {rows.map((r, i) => {
                    const res = resolvedRows[i];
                    const ask = res.needsChoice;
                    const tier = tiers.find((t) => t.id === res.tierId);
                    return (
                      <div key={i} className={cn('rounded-[14px] border bg-elev p-[12px]', ask ? 'border-acc' : 'border-line')}>
                        <div className="flex items-center gap-[11px]">
                          <Avatar name={res.name || r.raw} size={34} accent={tier?.role === 'VIP'} />
                          <div className="min-w-0 flex-1">
                            <div className="font-display text-[14.5px] font-bold text-text">
                              {res.name || r.raw}
                              {res.plusOnes > 0 && <span className="text-faint"> +{res.plusOnes}</span>}
                            </div>
                            <div className={cn('mt-0.5 text-[11.5px]', ask ? 'text-acc' : 'text-faint')}>
                              {ask ? fmt(t.guests.bulk.rowUnknown, { x: r.ambiguous?.text ?? '' }) : tier?.short ?? '—'}
                            </div>
                          </div>
                          {!ask &&
                            (byName.has(res.name.trim().toLowerCase()) ? (
                              <MiniChip className="border-acc text-acc">{t.guests.bulk.rowAlreadyOnList}</MiniChip>
                            ) : (
                              <span className="text-acc">
                                <Icon name="check2" size={17} stroke="#B5A6FF" sw={2.2} />
                              </span>
                            ))}
                        </div>
                        {ask && r.ambiguous && (
                          <div className="mt-[11px] flex flex-wrap gap-[7px]">
                            {r.ambiguous.suggestions.map((s) => (
                              <button
                                key={s.tierId}
                                type="button"
                                onClick={() => setChoices((c) => ({ ...c, [i]: { kind: 'tier', tierId: s.tierId } }))}
                                className={cn('flex-1 rounded-[10px] border border-line bg-elev2 py-[9px] font-display text-[12.5px] font-bold text-text', press)}
                              >
                                {s.tierName}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => setChoices((c) => ({ ...c, [i]: { kind: 'default' } }))}
                              className={cn('flex-1 rounded-[10px] border border-line bg-elev2 py-[9px] font-display text-[12.5px] font-bold text-text', press)}
                            >
                              {tiers.find((x) => x.id === defaultTierId)?.short ?? t.guests.bulk.rowChoiceDefault}
                            </button>
                            <button
                              type="button"
                              onClick={() => setChoices((c) => ({ ...c, [i]: { kind: 'name' } }))}
                              className={cn('flex-1 rounded-[10px] border border-line bg-elev2 py-[9px] font-display text-[12.5px] font-bold text-text', press)}
                            >
                              {t.guests.bulk.rowChoiceName}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {dupNames.length > 0 && (
                  <div className="mt-4 rounded-[16px] border border-acc bg-acc-dim p-[14px]">
                    <div className="mb-1 flex items-center gap-2">
                      <Icon name="warn" size={16} stroke="#B5A6FF" />
                      <Label className="text-acc-soft">
                        {fmt(t.guests.bulk.dupeHeader, { n: dupNames.length })}
                      </Label>
                    </div>
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {dupNames.slice(0, 12).map((n) => (
                        <MiniChip key={n} className="border-transparent bg-bg text-text">
                          {n}
                        </MiniChip>
                      ))}
                      {dupNames.length > 12 && (
                        <MiniChip className="border-transparent bg-bg text-faint">+{dupNames.length - 12}</MiniChip>
                      )}
                    </div>
                    <div className="mb-2 text-[12.5px] font-semibold text-text">{t.guests.bulk.dupeWhatToDo}</div>
                    <div className="flex flex-col gap-1.5">
                      <DupeOption on={dupeMode === 'add'} onClick={() => setDupeMode('add')} title={t.guests.bulk.dupeAddTitle} sub={t.guests.bulk.dupeAddSub} />
                      <DupeOption on={dupeMode === 'replace'} onClick={() => setDupeMode('replace')} title={t.guests.bulk.dupeReplaceTitle} sub={t.guests.bulk.dupeReplaceSub} />
                      <DupeOption on={dupeMode === 'again'} onClick={() => setDupeMode('again')} title={t.guests.bulk.dupeAgainTitle} sub={t.guests.bulk.dupeAgainSub} />
                    </div>
                  </div>
                )}
                {!exempt && remaining !== null && (
                  <div className={cn('mt-3 text-[12.5px]', overQuota ? 'text-acc-soft' : 'text-faint')}>
                    {fmt(t.guests.bulk.quotaLine, { total, slots: total === 1 ? t.guests.bulk.slotOne : t.guests.bulk.slotMany, remaining })}
                    {overQuota && t.guests.bulk.quotaBlocked}
                  </div>
                )}
                {(addBulk.isError || orchErr) && (
                  <div className="mt-3 flex items-center gap-[9px] rounded-[13px] border border-acc bg-acc-dim px-[14px] py-[11px] text-[13px] text-text">
                    <Icon name="warn" size={16} stroke="#B5A6FF" />
                    <span className="flex-1">{orchErr ?? addBulk.error?.message}</span>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </Scroll>
      <BottomBar>
        <Btn kind="primary" full icon="check" onClick={() => void confirm()} className={canConfirm ? '' : 'opacity-[0.45]'}>
          {busy
            ? t.guests.bulk.busy
            : doubtful > 0
              ? fmt(t.guests.bulk.submitOpen, { ready, open: doubtful })
              : dupNames.length > 0
                ? fmt(t.guests.bulk.submitProcess, { ready, lines: ready === 1 ? t.guests.bulk.lineOne : t.guests.bulk.lineMany })
                : fmt(t.guests.bulk.submitAdd, { ready, guests: ready === 1 ? t.guests.bulk.guestOne : t.guests.bulk.guestMany })}
        </Btn>
      </BottomBar>
    </div>
  );
}

// ── ADRESBOEK (pushed) ───────────────────────────────────────────────────────
// Live venue contacts (RLS: admin/finance/organizer). Tap a row to edit it; star
// = is_permanent (#11, with a confirm); "+" opens an event+tier picker and adds
// via add_contact_to_event (a deliberate add clears any "respect the removal"
// exclusion). Staff/doorhost have no contacts access → an explicit permission note.
const CONTACT_ROLE_OPTIONS: { value: ContactRole; label: string }[] = [
  { value: 'vip', label: t.guests.contacts.roleVip },
  { value: 'all_access', label: t.guests.contacts.roleAllAccess },
  { value: 'artist', label: t.guests.contacts.roleArtist },
  { value: 'press', label: t.guests.contacts.rolePress },
  { value: 'crew', label: t.guests.contacts.roleCrew },
  { value: 'guest', label: t.guests.contacts.roleGuest },
];

export function Contacten({ eventId }: { eventId?: string }): JSX.Element {
  const nav = useNav();
  const { roles } = usePoIdentity();
  // We can't see event-organizer scope in the role array, so we only *positively*
  // know admin/finance can view. A non-manager with an empty list is almost
  // certainly RLS-blocked (staff/doorhost) — say so instead of "no contacts yet".
  const canView = roles.includes('admin') || roles.includes('finance');
  const { data: contacts = [], isLoading, isError } = usePoContacts();
  const toggleVast = usePoToggleContactPermanent();
  const { data: liveEvents = [] } = usePoEvents();
  const upcoming = liveEvents.filter((e) => e.when === 'upcoming');

  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<PoContact | null>(null);
  const [addingFor, setAddingFor] = useState<PoContact | null>(null);
  const [confirmStar, setConfirmStar] = useState<PoContact | null>(null);
  const [forgetting, setForgetting] = useState<PoContact | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const term = q.trim().toLowerCase();
  const cs = term
    ? contacts.filter((c) => c.name.toLowerCase().includes(term) || (c.phoneLast4 ?? '').includes(term))
    : contacts;

  const onStarClick = (c: PoContact): void => {
    if (c.vast) toggleVast.mutate({ contactId: c.id, isPermanent: false });
    else setConfirmStar(c);
  };

  const noRights = !isLoading && !isError && !canView && contacts.length === 0;

  return (
    <div className={col}>
      <Top
        onBack={nav.back}
        title={t.guests.contacts.title}
        sub={fmt(t.guests.contacts.sub, { n: contacts.length, contacts: contacts.length === 1 ? t.guests.contacts.contactOne : t.guests.contacts.contactMany })}
        right={<IconBtn name="upload" onClick={() => nav.push('import')} />}
      />
      <div className="flex-none px-4 pb-3">
        <Field icon="search" placeholder={t.guests.contacts.searchPlaceholder} value={q} onChange={setQ} inputMode="text" />
      </div>
      <Scroll pad={16} bottom={24}>
        {isLoading ? (
          <Empty text={t.guests.contacts.loading} />
        ) : noRights ? (
          <Note icon="shield">
            {t.guests.contacts.noRights}
          </Note>
        ) : isError ? (
          <Empty text={t.guests.contacts.loadError} />
        ) : cs.length === 0 ? (
          <Empty text={term ? t.guests.contacts.emptyFiltered : t.guests.contacts.empty} />
        ) : (
          <div className="flex flex-col gap-[9px]">
            {cs.map((c) => {
              const isAdded = added.has(c.id);
              const starring = toggleVast.isPending && toggleVast.variables?.contactId === c.id;
              return (
                <div key={c.id} className="flex items-center gap-[10px] rounded-[16px] border border-line bg-elev p-[12px]">
                  <Avatar name={c.name} size={42} accent={c.vast} />
                  <button type="button" onClick={() => setEditing(c)} aria-label={fmt(t.guests.contacts.editAria, { name: c.name })} className={cn('min-w-0 flex-1 text-left', press)}>
                    <div className="font-display text-[15.5px] font-bold text-text">{c.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <RoleChip role={c.role} />
                      <span className="text-[11.5px] text-faint">
                        {fmt(t.guests.contacts.onListCount, { n: c.events })}{c.phoneLast4 ? ` · ••${c.phoneLast4}` : ''}
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onStarClick(c)}
                    disabled={starring}
                    aria-pressed={c.vast}
                    title={c.vast ? t.guests.contacts.unmakeRegular : t.guests.contacts.makeRegular}
                    className={cn('flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] border', press, c.vast ? 'border-transparent bg-acc-dim text-acc' : 'border-line text-ghost')}
                  >
                    <Icon name="star" size={17} fill={c.vast ? '#B5A6FF' : 'none'} stroke={c.vast ? '#B5A6FF' : 'rgba(255,255,255,0.26)'} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddingFor(c)}
                    aria-label={fmt(t.guests.contacts.addToEventAria, { name: c.name })}
                    className={cn('flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] border-none', press, isAdded ? 'bg-acc-dim text-acc' : 'bg-text text-bg')}
                  >
                    <Icon name={isAdded ? 'check2' : 'plus'} size={18} sw={2.4} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Scroll>

      {editing && (
        <ContactEditSheet
          contact={editing}
          onClose={() => setEditing(null)}
          onForget={(c) => {
            setEditing(null);
            setForgetting(c);
          }}
        />
      )}
      {confirmStar && <PermanentConfirmSheet contact={confirmStar} onClose={() => setConfirmStar(null)} />}
      {forgetting && <ForgetConfirmSheet contact={forgetting} onClose={() => setForgetting(null)} />}
      {addingFor && (
        <AddToEventSheet
          contact={addingFor}
          eventId={eventId}
          upcoming={upcoming}
          onClose={() => setAddingFor(null)}
          onAdded={(id) => {
            setAdded((s) => new Set(s).add(id));
            setAddingFor(null);
          }}
        />
      )}
    </div>
  );
}

/** A pill toggle for the role picker in the edit sheet. */
function RolePill({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('rounded-[10px] border px-[13px] py-[8px] font-display text-[13px] font-bold', press, on ? 'border-transparent bg-acc text-on-acc' : 'border-line bg-elev text-dim')}
    >
      {label}
    </button>
  );
}

/** Edit a contact's name / e-mail / phone / preferred tier by hand (#8). The
 *  upsert is a full overwrite, so birthdate + note are carried through unchanged. */
function ContactEditSheet({
  contact,
  onClose,
  onForget,
}: {
  contact: PoContact;
  onClose: () => void;
  onForget: (c: PoContact) => void;
}): JSX.Element {
  const { venueId, roles } = usePoIdentity();
  const canForget = venueCapabilities(roles).forgetContact;
  const upsert = usePoUpsertContact();
  const [name, setName] = useState(contact.name);
  const [email, setEmail] = useState(contact.email ?? '');
  const [phone, setPhone] = useState(contact.phone ?? '');
  const [role, setRole] = useState<ContactRole | ''>(contact.preferredRole ?? '');
  const [err, setErr] = useState<string | null>(null);

  const save = (): void => {
    setErr(null);
    if (!venueId) return setErr(t.guests.contacts.noVenue);
    if (name.trim() === '') return setErr(t.guests.contacts.nameRequired);
    let phoneVal: string | undefined;
    const phoneTrim = phone.trim();
    if (phoneTrim !== '') {
      phoneVal = normalizeImportPhone(phoneTrim);
      if (!phoneVal) return setErr(t.guests.contacts.phoneInvalid);
    }
    upsert.mutate(
      {
        id: contact.id,
        venueId,
        fullName: name.trim(),
        email: email.trim() || undefined,
        phone: phoneVal,
        birthdate: contact.birthdate ?? undefined,
        note: contact.note ?? undefined,
        preferredRole: role || undefined,
      },
      { onSuccess: onClose, onError: (e) => setErr(e instanceof Error ? e.message : t.guests.contacts.saveFailed) },
    );
  };

  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-4 flex items-center gap-[12px]">
        <Avatar name={name || contact.name} size={44} accent={contact.vast} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[17px] font-bold text-text">{t.guests.contacts.editTitle}</div>
          <div className="text-[12px] text-faint">{fmt(t.guests.contacts.onListCount, { n: contact.events })}</div>
        </div>
      </div>
      <Label className="mb-2">{t.guests.contacts.nameLabel}</Label>
      <Field icon="user" value={name} onChange={setName} placeholder={t.guests.contacts.namePlaceholder} className="mb-[14px]" />
      <Label className="mb-2">{t.guests.contacts.emailLabel}</Label>
      <Field icon="mail" value={email} onChange={setEmail} inputMode="email" placeholder={t.guests.contacts.emailPlaceholder} className="mb-[14px]" />
      <Label className="mb-2">{t.guests.contacts.phoneLabel}</Label>
      <Field icon="phone" value={phone} onChange={setPhone} inputMode="tel" placeholder={t.guests.contacts.phonePlaceholder} className="mb-[14px]" />
      <Label className="mb-2">{t.guests.contacts.tierLabel}</Label>
      <div className="flex flex-wrap gap-2">
        <RolePill label={t.guests.contacts.tierNone} on={role === ''} onClick={() => setRole('')} />
        {CONTACT_ROLE_OPTIONS.map((o) => (
          <RolePill key={o.value} label={o.label} on={role === o.value} onClick={() => setRole(o.value)} />
        ))}
      </div>
      {err && (
        <p className="mt-3 text-[12.5px] text-red-300" role="alert">
          {err}
        </p>
      )}
      <Btn kind="primary" full icon="check" className="mt-4" disabled={upsert.isPending || name.trim() === ''} onClick={save}>
        {upsert.isPending ? t.guests.contacts.saving : t.guests.contacts.save}
      </Btn>
      {canForget && (
        <button
          type="button"
          onClick={() => onForget(contact)}
          className={cn(
            'mt-[10px] flex w-full items-center justify-center gap-2 rounded-[13px] border border-red-500/25 bg-red-500/[0.05] py-[11px] font-display text-[13px] font-bold text-red-300',
            press,
          )}
        >
          <Icon name="shield" size={15} stroke="currentColor" />
          {t.guests.contacts.forget}
        </button>
      )}
    </Sheet>
  );
}

/** Confirm + execute an on-request erasure ("vergeet mij", AVG art. 17 / #29).
 *  Admin-only (the entry button is capability-gated). No MFA step-up — admin is an
 *  MFA-mandatory role, so the action stays frictionless. Irreversible, so the
 *  destructive confirm spells it out. forget_contact re-checks admin server-side. */
function ForgetConfirmSheet({ contact, onClose }: { contact: PoContact; onClose: () => void }): JSX.Element {
  const forget = usePoForgetContact();
  const [err, setErr] = useState<string | null>(null);

  const run = (): void => {
    setErr(null);
    forget.mutate(
      { contactId: contact.id },
      {
        onSuccess: onClose,
        onError: (e) => setErr(e instanceof Error ? e.message : t.guests.contacts.forgetFailed),
      },
    );
  };

  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-3 flex items-center gap-[12px]">
        <span className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[13px] bg-red-500/15 text-red-300">
          <Icon name="warn" size={22} stroke="currentColor" />
        </span>
        <div className="font-display text-[18px] font-bold text-text">
          {fmt(t.guests.contacts.forgetTitle, { name: contact.name })}
        </div>
      </div>
      <p className="text-[13px] leading-[1.5] text-dim">
        {fmt(t.guests.contacts.forgetBody, { name: contact.name })}
      </p>
      {contact.vast && <Note icon="star">{t.guests.contacts.forgetPermanentWarn}</Note>}
      <p className="mt-3 font-display text-[13px] font-bold text-red-300">{t.guests.contacts.forgetIrreversible}</p>
      {err && (
        <p className="mt-3 text-[12.5px] text-red-300" role="alert">
          {err}
        </p>
      )}
      <button
        type="button"
        onClick={run}
        disabled={forget.isPending}
        className={cn(
          'mt-4 flex w-full items-center justify-center gap-2 rounded-[14px] bg-red-500/90 py-[13px] font-display text-[14.5px] font-bold text-white disabled:opacity-60',
          press,
        )}
      >
        <Icon name="shield" size={17} stroke="currentColor" />
        {forget.isPending ? t.guests.contacts.forgetBusy : t.guests.contacts.forgetConfirm}
      </button>
      <Btn kind="ghost" full className="mt-2" onClick={onClose}>
        {t.guests.contacts.cancel}
      </Btn>
    </Sheet>
  );
}

/** Confirm before marking a contact permanent — they land on every NEW list (#11). */
function PermanentConfirmSheet({ contact, onClose }: { contact: PoContact; onClose: () => void }): JSX.Element {
  const toggle = usePoToggleContactPermanent();
  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-3 flex items-center gap-[12px]">
        <span className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[13px] bg-acc-dim text-acc">
          <Icon name="star" size={22} stroke="#B5A6FF" fill="#B5A6FF" />
        </span>
        <div className="font-display text-[18px] font-bold text-text">{fmt(t.guests.contacts.makeRegularTitle, { name: contact.name })}</div>
      </div>
      <Note icon="star">
        <b>{contact.name}</b> {fmt(t.guests.contacts.makeRegularNote, { new: t.guests.contacts.makeRegularNoteNew })}
      </Note>
      <Btn full kind="primary" icon="star" className="mt-1" disabled={toggle.isPending} onClick={() => toggle.mutate({ contactId: contact.id, isPermanent: true }, { onSuccess: onClose })}>
        {toggle.isPending ? t.guests.contacts.makeRegularBusy : t.guests.contacts.makeRegularConfirm}
      </Btn>
      <Btn full kind="ghost" className="mt-2" onClick={onClose}>
        {t.guests.contacts.cancel}
      </Btn>
    </Sheet>
  );
}

/** Pick an event + ticket (tier) and add the contact to that gastenlijst (Q9). The
 *  in-context event is pre-selected; with a single event you just pick a ticket. */
function AddToEventSheet({
  contact,
  eventId,
  upcoming,
  onClose,
  onAdded,
}: {
  contact: PoContact;
  eventId?: string;
  upcoming: PoEvent[];
  onClose: () => void;
  onAdded: (id: string) => void;
}): JSX.Element {
  const add = usePoAddContactToEvent();
  const [evId, setEvId] = useState<string>(eventId && upcoming.some((e) => e.id === eventId) ? eventId : upcoming[0]?.id ?? '');
  const { data: tiers = [], isLoading: tiersLoading } = usePoTiers(evId);
  // Only an admin/organizer may create a tier (guest_tiers_insert RLS, surfaced via
  // the quota exempt flag) — finance can open the address book but not make tiers.
  const { data: quota } = usePoQuota(evId);
  const canCreateTier = quota?.exempt ?? false;
  // Is this contact already a live (non-removed) guest on the selected event? We
  // reuse the event's guest list (RLS-scoped) rather than a separate query, so the
  // existing add/update invalidations keep it fresh.
  const { data: evGuests = [], isLoading: guestsLoading } = usePoGuests(evId);
  const onList = evGuests.find((g) => g.contactId === contact.id) ?? null;
  const update = usePoUpdateGuest(evId);

  const [tierId, setTierId] = useState<string>('');
  const [plus, setPlus] = useState(0); // new guest: extra plekken (total = 1 + plus)
  const [mode, setMode] = useState<'add' | 'set'>('add'); // already-on-list choice
  const [amount, setAmount] = useState(1); // already-on-list: the number for the chosen mode
  const [err, setErr] = useState<string | null>(null);

  // Default the ticket to the event's default (or first) whenever the tiers load.
  useEffect(() => {
    if (tiers.length === 0) {
      setTierId('');
      return;
    }
    if (!tiers.some((t) => t.id === tierId)) {
      const def = resolveDefaultTierId(tiers.map((t) => ({ id: t.id, name: t.name, aliases: t.aliases })));
      setTierId(def ?? tiers[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiers]);

  const busy = add.isPending || update.isPending;
  const finishOk = (): void => onAdded(contact.id);

  // New guest on this event: ticket + plus-ones via add_contact_to_event.
  const submitNew = (): void => {
    setErr(null);
    if (!evId) return setErr(t.guests.contacts.pickEvent);
    add.mutate(
      { contactId: contact.id, eventId: evId, tierId: tierId || undefined, plusOnes: plus || undefined },
      { onSuccess: finishOk, onError: (e) => setErr(e instanceof Error ? e.message : t.guests.contacts.addFailed) },
    );
  };

  // Already on this event: never silently no-op — set a new plus-ones total or add
  // to the existing count (the user's choice), via a plain guest update.
  const finalPlus = onList ? (mode === 'add' ? onList.plus + amount : amount) : 0;
  const submitAdjust = (): void => {
    if (!onList) return;
    setErr(null);
    update.mutate(
      { guestId: onList.id, plusOnes: finalPlus },
      { onSuccess: finishOk, onError: (e) => setErr(e instanceof Error ? e.message : t.guests.contacts.saveFailed) },
    );
  };

  const switchMode = (m: 'add' | 'set'): void => {
    setMode(m);
    setAmount(m === 'set' ? onList?.plus ?? 0 : 1);
  };

  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-1 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">{fmt(t.guests.contacts.addTitle, { name: contact.name })}</div>
      <div className="mb-4 text-[13px] text-faint">{onList ? t.guests.contacts.addPickEvent : t.guests.contacts.addPickEventTicket}</div>

      {upcoming.length === 0 ? (
        <Empty text={t.guests.contacts.addNoUpcoming} />
      ) : (
        <>
          <Label className="mb-2">{t.guests.contacts.eventLabel}</Label>
          <div className="mb-4 flex flex-col gap-2">
            {upcoming.map((e) => {
              const on = e.id === evId;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setEvId(e.id)}
                  className={cn('flex items-center gap-[12px] rounded-[12px] border px-[13px] py-[11px] text-left', press, on ? 'border-transparent bg-acc-dim' : 'border-line bg-elev')}
                >
                  <span className="w-[36px] shrink-0 text-center">
                    <span className="block font-display text-[16px] font-extrabold leading-none text-text">{e.date}</span>
                    <span className="block text-[9px] font-bold tracking-[0.05em] text-faint">{e.mon}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-[14px] font-bold text-text">{e.name}</span>
                    <span className="block text-[11px] text-faint">{e.venue}</span>
                  </span>
                  {on && <Icon name="check2" size={16} stroke="#B5A6FF" sw={2.4} />}
                </button>
              );
            })}
          </div>

          {guestsLoading ? (
            <div className="mb-3 text-[12.5px] text-faint">{t.guests.contacts.checkingList}</div>
          ) : onList ? (
            // Already on this event — choose: add to, or replace, the plus-ones.
            <>
              <Note icon="user">
                <b>{contact.name}</b>
                {onList.plus > 0 ? (
                  <>
                    {t.guests.contacts.dupePrefix}
                    <b>+{onList.plus}</b>
                    {fmt(t.guests.contacts.dupeSlots, { slots: onList.plus === 1 ? t.guests.contacts.slotOne : t.guests.contacts.slotMany })}
                  </>
                ) : (
                  t.guests.contacts.onListNoExtra
                )}
                {t.guests.contacts.dupeSuffix}
              </Note>
              <Label className="mb-2">{t.guests.contacts.whatToDo}</Label>
              <div className="mb-3 flex gap-2">
                <RolePill label={t.guests.contacts.modeAdd} on={mode === 'add'} onClick={() => switchMode('add')} />
                <RolePill label={t.guests.contacts.modeSet} on={mode === 'set'} onClick={() => switchMode('set')} />
              </div>
              <div className="mb-1 flex items-center justify-between gap-[14px] rounded-[16px] bg-acc-dim p-[10px]">
                <button type="button" onClick={() => setAmount((a) => Math.max(0, a - 1))} aria-label={t.guests.contacts.stepperLess} className={cn('flex h-[46px] w-[46px] items-center justify-center rounded-[14px] border border-line bg-elev2 text-text', press)}>
                  <Icon name="minus" size={20} sw={2.4} />
                </button>
                <div className="text-center">
                  <div className="font-display text-[28px] font-extrabold leading-none text-text">{amount}</div>
                  <div className="mt-0.5 text-[11px] text-dim">{mode === 'add' ? t.guests.contacts.stepperAddSuffix : t.guests.contacts.stepperTotalSuffix}</div>
                </div>
                <button type="button" onClick={() => setAmount((a) => a + 1)} aria-label={t.guests.contacts.stepperMore} className={cn('flex h-[46px] w-[46px] items-center justify-center rounded-[14px] border border-line bg-elev2 text-text', press)}>
                  <Icon name="plus" size={20} sw={2.4} stroke="#B5A6FF" />
                </button>
              </div>
              <div className="mb-3 px-1 text-[12px] text-faint">
                {t.guests.contacts.becomesPrefix}<b className="text-text">+{finalPlus}</b>{fmt(t.guests.contacts.becomesSuffix, { slots: finalPlus === 1 ? t.guests.contacts.slotOne : t.guests.contacts.slotMany })}
                {mode === 'add' && amount > 0 ? fmt(t.guests.contacts.becomesWas, { n: onList.plus }) : ''}.
              </div>
              {err && (
                <p className="mt-1 text-[12.5px] text-red-300" role="alert">
                  {err}
                </p>
              )}
              <Btn kind="primary" full icon="check" className="mt-2" disabled={busy} onClick={submitAdjust}>
                {update.isPending ? t.guests.contacts.saving : fmt(t.guests.contacts.adjustSave, { n: finalPlus })}
              </Btn>
            </>
          ) : (
            // New on this event — pick a ticket + how many people.
            <>
              <Label className="mb-2">{t.guests.contacts.ticketLabel}</Label>
              {tiersLoading ? (
                <div className="mb-3 text-[12.5px] text-faint">{t.guests.contacts.loadingTickets}</div>
              ) : tiers.length === 0 ? (
                <NoTiersBlock eventId={evId} canCreate={canCreateTier} className="mb-3" />
              ) : (
                <div className="mb-3 flex flex-wrap gap-2">
                  {tiers.map((tier) => {
                    const on = tier.id === tierId;
                    return (
                      <button
                        key={tier.id}
                        type="button"
                        onClick={() => setTierId(tier.id)}
                        className={cn('inline-flex items-center gap-[7px] rounded-[11px] border px-[12px] py-[9px] font-display text-[13px] font-bold', press, on ? 'border-transparent bg-acc text-on-acc' : 'border-line bg-elev text-text')}
                      >
                        <span className="h-[9px] w-[9px] rounded-full" style={{ background: tier.color }} />
                        {tier.short}
                      </button>
                    );
                  })}
                </div>
              )}

              <Label className="mb-2">{t.guests.contacts.peopleLabel}</Label>
              <div className="mb-1">
                <Stepper value={1 + plus} onChange={(v) => setPlus(Math.max(0, v - 1))} />
              </div>
              <div className="mb-3 px-1 text-[12px] text-faint">
                {plus === 0 ? t.guests.contacts.peopleOnlyGuest : fmt(t.guests.contacts.peopleWithExtra, { name: contact.name, n: plus, slots: plus === 1 ? t.guests.contacts.slotOne : t.guests.contacts.slotMany, total: 1 + plus })}
              </div>

              {err && (
                <p className="mt-1 text-[12.5px] text-red-300" role="alert">
                  {err}
                </p>
              )}
              <Btn kind="primary" full icon="plus" className="mt-2" disabled={busy || !evId || tiers.length === 0} onClick={submitNew}>
                {add.isPending ? t.guests.contacts.addBusy : plus > 0 ? fmt(t.guests.contacts.addPeople, { n: 1 + plus }) : t.guests.contacts.addToGuestList}
              </Btn>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

// ── PERMANENTE GASTEN (pushed) ───────────────────────────────────────────────
// The venue's permanent contacts (is_permanent). Unstar removes one; "Nu
// toevoegen aan een event" runs sync_permanent_guests_into_event, which is
// idempotent and SKIPS contacts manually removed from that event ("respect the
// removal", #11). Add more via the address book (the "+" header).
export function Vaste(): JSX.Element {
  const nav = useNav();
  const { roles } = usePoIdentity();
  const canView = roles.includes('admin') || roles.includes('finance');
  const { data: list = [], isLoading, isError } = usePoPermanentContacts();
  const toggleVast = usePoToggleContactPermanent();
  const sync = usePoSyncPermanent();
  const { data: liveEvents = [] } = usePoEvents();
  const upcoming = liveEvents.filter((e) => e.when === 'upcoming');
  const permanent = list ?? [];
  const noRights = !isLoading && !isError && !canView && permanent.length === 0;

  const [pick, setPick] = useState(false);
  const [result, setResult] = useState<{ event: string; added: number; total: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const runSync = (evId: string, evName: string): void => {
    setErrorMsg(null);
    setResult(null);
    // Capture the permanent total now so the result can say "X van Y" — the sync
    // skips guests already on the event (or manually removed), never touching
    // their plekken (S2.2: skip + clearer report, decided with Max).
    const total = permanent.length;
    sync.mutate(
      { eventId: evId },
      {
        onSuccess: (res) => {
          setPick(false);
          setResult({ event: evName, added: res.ok ? res.added : 0, total });
        },
        onError: (e) => setErrorMsg(e instanceof Error ? e.message : t.guests.permanent.syncFailed),
      },
    );
  };

  return (
    <div className={col}>
      <Top
        onBack={nav.back}
        title={t.guests.permanent.title}
        sub={fmt(t.guests.permanent.sub, { n: permanent.length, guests: permanent.length === 1 ? t.guests.permanent.guestOne : t.guests.permanent.guestMany })}
        right={<IconBtn name="plus" onClick={() => nav.push('contacten')} />}
      />
      <Scroll bottom={24}>
        <div className="mb-4 flex gap-[12px] rounded-[16px] bg-acc-dim p-[15px]">
          <Icon name="star" size={20} stroke="#B5A6FF" fill="#B5A6FF" />
          <div className="text-[13.5px] leading-[1.45] text-text">
            {t.guests.permanent.blurb}
          </div>
        </div>

        {result && (
          <div className="mb-3 flex items-center gap-[9px] rounded-[13px] border border-acc bg-acc-dim px-[14px] py-[11px] text-[13px] text-text">
            <Icon name="check" size={16} stroke="#B5A6FF" />
            <span className="flex-1">
              {result.added === 0
                ? fmt(t.guests.permanent.resultNoneAdded, { event: result.event })
                : result.added === result.total
                  ? fmt(t.guests.permanent.resultAllAdded, { total: result.total, guests: result.total === 1 ? t.guests.permanent.guestOneLabel : t.guests.permanent.guestManyLabel, event: result.event })
                  : fmt(t.guests.permanent.resultPartial, { added: result.added, total: result.total, event: result.event })}
            </span>
          </div>
        )}
        {errorMsg && (
          <div className="mb-3 flex items-center gap-[9px] rounded-[13px] border border-acc bg-acc-dim px-[14px] py-[11px] text-[13px] text-text">
            <Icon name="warn" size={16} stroke="#B5A6FF" />
            <span className="flex-1">{errorMsg}</span>
          </div>
        )}

        {!isLoading && !isError && permanent.length > 0 && (
          <Btn kind="dark" full icon="cal" className="mb-4" disabled={sync.isPending} onClick={() => setPick(true)}>
            {sync.isPending ? t.guests.permanent.addNowBusy : t.guests.permanent.addNow}
          </Btn>
        )}

        {isLoading ? (
          <Empty text={t.guests.permanent.loading} />
        ) : noRights ? (
          <Note icon="shield">
            {t.guests.permanent.noRights}
          </Note>
        ) : isError ? (
          <Empty text={t.guests.permanent.loadError} />
        ) : permanent.length === 0 ? (
          <Empty text={t.guests.permanent.empty} />
        ) : (
          <div className="flex flex-col gap-[9px]">
            {permanent.map((c) => {
              const removing = toggleVast.isPending && toggleVast.variables?.contactId === c.id;
              return (
                <div key={c.id} className="flex items-center gap-[12px] rounded-[16px] border border-line bg-elev p-[12px]">
                  <Avatar name={c.name} size={42} accent />
                  <div className="flex-1">
                    <div className="font-display text-[15.5px] font-bold text-text">{c.name}</div>
                    <div className="mt-[3px] text-[12px] text-faint">{fmt(t.guests.permanent.autoRole, { role: c.role })}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleVast.mutate({ contactId: c.id, isPermanent: false })}
                    disabled={removing}
                    title={t.guests.permanent.removeRegular}
                    className={cn('flex h-[38px] w-[38px] items-center justify-center rounded-[11px] border border-line text-faint', press)}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Scroll>

      {pick && (
        <Sheet onClose={() => setPick(false)} center={false}>
          <div className="mb-1 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">{t.guests.permanent.syncTitle}</div>
          <div className="mb-4 text-[13px] text-faint">{t.guests.permanent.syncSub}</div>
          {upcoming.length === 0 ? (
            <Empty text={t.guests.permanent.noUpcoming} />
          ) : (
            <div className="flex flex-col gap-2">
              {upcoming.map((e) => (
                <button key={e.id} type="button" disabled={sync.isPending} onClick={() => runSync(e.id, e.name)} className={cn('flex items-center gap-[12px] rounded-[12px] border border-line bg-elev px-[13px] py-[12px] text-left', press)}>
                  <span className="w-[38px] shrink-0 text-center">
                    <span className="block font-display text-[16px] font-extrabold leading-none text-text">{e.date}</span>
                    <span className="block text-[9px] font-bold tracking-[0.05em] text-faint">{e.mon}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-[14.5px] font-bold text-text">{e.name}</span>
                    <span className="block text-[11.5px] text-faint">{e.venue}</span>
                  </span>
                  <Icon name="chev" size={16} className="text-ghost" />
                </button>
              ))}
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}
