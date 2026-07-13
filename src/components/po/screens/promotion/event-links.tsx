'use client';

/**
 * Request links per event (Requests-epic F1, 86ey21vjt; regrouped under the
 * Promotion area by G3, 86ey7e03j) — one link per influencer/channel with its
 * funnel (views → requests → approved → checked-in, M14), a QR code, and a
 * pause toggle. Two entries, one component:
 *  - standalone (`/app/events/[id]/links`, ScreenName 'links'): reached from
 *    EventEdit/EventView — deliberately OUTSIDE the Promotion hub so an
 *    external organizer (event-scoped, no venue membership) keeps managing his
 *    own event's links (G3 gating decision, ux-ia-audit vraag 6);
 *  - embedded in the Promotion hub's "Per event" tab (venue members), with an
 *    event picker instead of the back-header.
 * Reads/writes go through the shared src/features/po layer; RLS is the
 * boundary — admin (venue) + organizer (own event) manage, finance reads,
 * staff/door see [].
 *
 * The DEFAULT link is the event's legacy landing slug: pinned first, its on/off
 * is the event-level master toggle in EventEdit (its own `active` stays true),
 * and its identity can't be edited or archived here.
 */
import { useEffect, useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { fmt, t } from '@/lib/i18n';
import type { Tier } from '@/lib/po/types';
import type { PoInfluencer, PoRequestLink } from '@/features/po/queries';
import { usePoEventForEdit, usePoEvents, usePoInfluencers, usePoRequestLinks, usePoTiers } from '@/features/po/hooks';
import { usePoCreateInfluencer, usePoUpdateLink } from '@/features/po/mutations';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { poKeys } from '@/features/po/keys';
import { localInputToIso, isoToLocalInput } from '@/features/events/datetime';
import { useNav } from '../../context';
import { Icon } from '../../icon';
import { Avatar, Btn, Empty, Field, IconBtn, Label, Loading, MiniChip, Note, Scroll, TierPicker, Toggle, ToggleRow, Top, press, cardPress } from '../../kit';
import { Sheet } from '../../shell';
import { CreateLinkFlow } from './create-link-flow';
import { EventPicker, soonestUpcoming } from './shared';

const col = 'flex h-full flex-col';

function ErrLine({ msg }: { msg: string }): JSX.Element {
  return <div className="mb-3 text-[13px] font-semibold text-[#E89AC0]">{msg}</div>;
}

/** The link's public URL. Guarded: in a rare no-window context the path alone
 *  still identifies the link (Capacitor #37 — webview always has window). */
function linkUrl(slug: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/e/${slug}`;
}

function displayName(link: PoRequestLink): string {
  return link.influencerName ?? link.label ?? t.links.standardName;
}

// ── One link card ─────────────────────────────────────────────────────────────
function LinkCard({
  link,
  tier,
  canManage,
  highlight,
  onOpen,
  onQr,
  onToggle,
  toggling,
}: {
  link: PoRequestLink;
  tier: Tier | null;
  canManage: boolean;
  /** Just created — brief accent border so the new link is findable. */
  highlight: boolean;
  onOpen: () => void;
  onQr: () => void;
  onToggle: (active: boolean) => void;
  toggling: boolean;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const expired = link.expiresAt != null && Date.parse(link.expiresAt) < Date.now();
  const full = link.maxHeadcount != null && link.approvedHeads >= link.maxHeadcount;

  const copy = async (): Promise<void> => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(linkUrl(link.slug));
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      // Clipboard blocked (rare in webviews) — silently ignore; the URL is visible in the sheet.
    }
  };

  const stats =
    fmt(t.links.stats, { views: link.views, requests: link.requests, approved: link.approved, checkedIn: link.checkedInHeads }) +
    (link.maxHeadcount != null
      ? fmt(t.links.statsCap, { heads: link.approvedHeads, max: link.maxHeadcount })
      : '');

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen();
      }}
      className={cn(
        'cursor-pointer rounded-[18px] border bg-elev p-[15px] text-left',
        highlight ? 'border-acc/60' : 'border-line',
        cardPress,
      )}
    >
      <div className="mb-[10px] flex items-start gap-[11px]">
        <Avatar name={displayName(link)} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-display text-[15.5px] font-bold text-text">{displayName(link)}</span>
            {link.isDefault && <MiniChip>{t.links.defaultChip}</MiniChip>}
            {tier && (
              <MiniChip>
                <span className="h-[8px] w-[8px] rounded-full" style={{ background: tier.color }} />
                {tier.short}
              </MiniChip>
            )}
            {link.autoApprove && <MiniChip className="border-acc/40 text-acc">{t.links.autoChip}</MiniChip>}
            {!link.active && <MiniChip>{t.links.pausedChip}</MiniChip>}
            {expired && <MiniChip className="border-[#E89AC0]/40 text-[#E89AC0]">{t.links.expiredChip}</MiniChip>}
            {full && <MiniChip className="border-[#E89AC0]/40 text-[#E89AC0]">{t.links.fullChip}</MiniChip>}
          </div>
          <div className="mt-0.5 text-[12px] text-faint">{stats}</div>
        </div>
      </div>
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={t.links.copyAria}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-[10px] border px-3 py-[9px] font-display text-[12.5px] font-bold transition-[filter] hover:brightness-[1.2]',
            copied ? 'border-acc/40 bg-acc-dim text-acc' : 'border-line text-dim',
          )}
        >
          <Icon name={copied ? 'check' : 'link'} size={15} />
          {copied ? t.events.copyLinkDone : t.events.copyLinkLabel}
        </button>
        <button
          type="button"
          onClick={onQr}
          aria-label={t.links.qrAria}
          className={cn('flex h-[40px] w-[40px] items-center justify-center rounded-[12px] border border-line bg-elev2 text-text', press)}
        >
          <Icon name="qr" size={18} />
        </button>
        <span className="flex-1" />
        {/* The default link's on/off is the event's master toggle (EventEdit). */}
        {canManage && !link.isDefault && (
          <span aria-label={t.links.pauseAria} className={toggling ? 'opacity-60' : undefined}>
            <Toggle on={link.active} onClick={() => !toggling && onToggle(!link.active)} />
          </span>
        )}
      </div>
    </div>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────
export function EventLinks({ eventId, embedded }: { eventId?: string; embedded?: boolean }): JSX.Element {
  const nav = useNav();
  // Embedded (Promotion hub "Per event"): no explicit event in the URL yet →
  // default to the soonest upcoming event, same rule as the Overview tab.
  // (Shared venue-wide query key — standalone mode has it cached already.)
  const eventsQ = usePoEvents();
  const events = eventsQ.data ?? [];
  const fallback = embedded ? soonestUpcoming(events) ?? events[0] ?? null : null;
  const id = eventId ?? fallback?.id ?? '';
  const { data: ev, canManage } = usePoEventForEdit(id);
  const linksQ = usePoRequestLinks(id);
  const tiersQ = usePoTiers(id);
  const influencersQ = usePoInfluencers();
  const updateLink = usePoUpdateLink(id);

  const [sheet, setSheet] = useState<{ mode: 'create' } | { mode: 'edit'; link: PoRequestLink } | null>(null);
  const [qrFor, setQrFor] = useState<PoRequestLink | null>(null);
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // The create flow ends on a done/copy step — hold the highlight until it closes.
  const pendingCreated = useRef<string | null>(null);

  const links = linksQ.data ?? [];
  const tiers = tiersQ.data ?? [];
  const tierById = new Map(tiers.map((row) => [row.id, row]));

  // Fade the just-created highlight after a beat.
  useEffect(() => {
    if (!justCreated) return;
    const timer = setTimeout(() => setJustCreated(null), 2500);
    return () => clearTimeout(timer);
  }, [justCreated]);

  // Optimistic pause/resume: flip the cached row immediately, roll back on error
  // (the mutation's own invalidation reconciles with the server afterwards).
  const qc = useQueryClient();
  const togglePause = (link: PoRequestLink, active: boolean): void => {
    setErr(null);
    const key = poKeys.requestLinks(id);
    const prev = qc.getQueryData<PoRequestLink[]>(key);
    qc.setQueryData<PoRequestLink[]>(key, (old) =>
      (old ?? []).map((l) => (l.id === link.id ? { ...l, active } : l)),
    );
    updateLink.mutate(
      { linkId: link.id, active },
      {
        onError: (e) => {
          qc.setQueryData(key, prev);
          setErr(e instanceof Error ? e.message : t.links.errPause);
        },
      },
    );
  };

  const body = (
    <>
      {err && <ErrLine msg={err} />}
      {!canManage && !linksQ.isLoading && <Note icon="shield">{t.links.readOnly}</Note>}
      {linksQ.isLoading ? (
        <Loading text={t.links.loading} />
      ) : linksQ.isError ? (
        <Empty text={t.links.loadError} />
      ) : links.length === 0 ? (
        <Empty text={canManage ? t.links.empty : t.links.noAccess} />
      ) : (
        <div className="flex flex-col gap-[11px] lg:grid lg:grid-cols-2 lg:items-start">
          {links.map((link) => (
            <LinkCard
              key={link.id}
              link={link}
              tier={link.tierId ? tierById.get(link.tierId) ?? null : null}
              canManage={canManage}
              highlight={link.id === justCreated}
              onOpen={() => canManage && setSheet({ mode: 'edit', link })}
              onQr={() => setQrFor(link)}
              onToggle={(active) => togglePause(link, active)}
              toggling={updateLink.isPending}
            />
          ))}
        </div>
      )}
    </>
  );

  const sheets = (
    <>
      {sheet?.mode === 'create' && id && (
        <CreateLinkFlow
          eventId={id}
          eventName={ev?.name ?? ''}
          // Only in the embedded (venue-member) hub tab — the standalone
          // per-event route stays locked to its one event (see the prop doc
          // on CreateLinkFlow: an external organizer shouldn't see a picker
          // over venue events he can't create links on).
          events={embedded ? events : undefined}
          onCreated={(newId) => {
            pendingCreated.current = newId;
          }}
          onClose={() => {
            setSheet(null);
            if (pendingCreated.current) {
              setJustCreated(pendingCreated.current);
              pendingCreated.current = null;
            }
          }}
        />
      )}
      {sheet?.mode === 'edit' && (
        <LinkSheet
          eventId={id}
          link={sheet.link}
          tiers={tiers}
          tiersLoading={tiersQ.isLoading}
          influencers={influencersQ.data ?? []}
          onClose={() => setSheet(null)}
          onSaved={() => setSheet(null)}
        />
      )}
      {qrFor && <QrSheet link={qrFor} onClose={() => setQrFor(null)} />}
    </>
  );

  if (embedded) {
    // Inside the Promotion hub: the hub renders the Top header (incl. the
    // persistent "+ New link" — its own CreateLinkFlow event-picker covers
    // "add a link on a DIFFERENT event than the one I'm viewing here", so this
    // tab doesn't need its own second "+" next to the event picker row.
    return (
      <div className="flex min-h-0 flex-col">
        <div className="mb-4 flex items-center justify-between gap-3">
          <EventPicker
            events={events}
            selectedId={id || null}
            onPick={(picked) => nav.replace('promotion', { tab: 'events', id: picked })}
          />
        </div>
        {events.length === 0 && !eventsQ.isLoading ? <Empty text={t.promo.noEvents} /> : body}
        {sheets}
      </div>
    );
  }

  return (
    <div className={col}>
      <Top
        onBack={nav.back}
        title={t.links.title}
        sub={ev?.name}
        right={canManage ? <IconBtn name="plus" onClick={() => setSheet({ mode: 'create' })} /> : undefined}
      />
      <Scroll bottom={28}>{body}</Scroll>
      {sheets}
    </div>
  );
}

// ── Edit sheet ────────────────────────────────────────────────────────────────
// Create goes through the shared CreateLinkFlow (G3-0); this sheet only edits.
type WhoKind = 'influencer' | 'new' | 'label' | null;

function whoChip(key: string, label: string, active: boolean, onClick: () => void): JSX.Element {
  return (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full border px-[13px] py-[8px] font-display text-[12.5px] font-bold transition-colors',
        active ? 'border-acc bg-acc-dim text-acc' : 'border-line text-dim hover:brightness-110',
      )}
    >
      {label}
    </button>
  );
}

function LinkSheet({
  eventId,
  link,
  tiers,
  tiersLoading,
  influencers,
  onClose,
  onSaved,
}: {
  eventId: string;
  link: PoRequestLink;
  tiers: Tier[];
  tiersLoading: boolean;
  influencers: PoInfluencer[];
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { venueId } = usePoIdentity();
  const update = usePoUpdateLink(eventId);
  const createInf = usePoCreateInfluencer();
  const isDefault = link.isDefault;

  const [whoKind, setWhoKind] = useState<WhoKind>(
    link.influencerId ? 'influencer' : link.label ? 'label' : null,
  );
  const [whoId, setWhoId] = useState(link.influencerId ?? '');
  const [newName, setNewName] = useState('');
  const [label, setLabel] = useState(link.label ?? '');
  const [tierId, setTierId] = useState(link.tierId ?? '');
  const [autoApprove, setAutoApprove] = useState(link.autoApprove);
  const [maxHeads, setMaxHeads] = useState(link.maxHeadcount != null ? String(link.maxHeadcount) : '');
  const [expDate, expTimeInit] = (isoToLocalInput(link.expiresAt) || 'T').split('T');
  const [expiryDate, setExpiryDate] = useState(expDate);
  const [expiryTime, setExpiryTime] = useState(expTimeInit);
  const [err, setErr] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const busy = update.isPending || createInf.isPending;

  // Turning auto-approve on requires a pinned tier: auto-select the first one,
  // or surface the "add a tier first" hint on a tier-less event.
  const setAuto = (v: boolean): void => {
    setErr(null);
    if (v && !tierId) {
      if (tiers.length > 0) {
        setTierId(tiers[0].id);
        setAutoApprove(true);
      } else {
        setErr(t.links.noTiersYet);
      }
      return;
    }
    setAutoApprove(v);
  };

  const save = async (): Promise<void> => {
    setErr(null);

    // Identity — exactly one of influencer/label (skipped for the default link).
    let influencerId: string | undefined;
    let labelVal: string | undefined;
    if (!isDefault) {
      if (whoKind === 'influencer' && whoId) {
        influencerId = whoId;
      } else if (whoKind === 'new') {
        if (newName.trim().length < 2) {
          setErr(t.links.errNewInfluencerName);
          return;
        }
      } else if (whoKind === 'label') {
        if (!label.trim()) {
          setErr(t.links.errIdentity);
          return;
        }
        labelVal = label.trim();
      } else {
        setErr(t.links.errIdentity);
        return;
      }
    }

    // Expiry — both fields or neither.
    let expiresAt: string | null = null;
    if (expiryDate || expiryTime) {
      expiresAt = localInputToIso(`${expiryDate}T${expiryTime}`);
      if (!expiresAt) {
        setErr(t.links.errExpiry);
        return;
      }
    }

    const maxNum = Number.parseInt(maxHeads, 10);
    const maxVal = Number.isFinite(maxNum) && maxNum > 0 ? maxNum : null;

    try {
      // "+ New" creates the influencer first, then attaches the link to it.
      if (!isDefault && whoKind === 'new') {
        if (!venueId) throw new Error(t.links.errInfluencerSave);
        influencerId = await createInf.mutateAsync({ venueId, name: newName.trim() });
        if (!influencerId) throw new Error(t.links.errInfluencerSave);
      }

      await update.mutateAsync({
        linkId: link.id,
        // The default link has no identity to change; null clears the other half.
        ...(isDefault ? {} : { influencerId: influencerId ?? null, label: labelVal ?? null }),
        tierId: tierId || null,
        maxHeadcount: maxVal,
        autoApprove,
        expiresAt,
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.links.errSave);
    }
  };

  const archive = async (): Promise<void> => {
    setErr(null);
    try {
      await update.mutateAsync({ linkId: link.id, archived: true });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.links.errArchive);
    }
  };

  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-4 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">
        {t.links.sheetEditTitle}
      </div>
      <div className="po-scroll -mx-1 max-h-[62vh] overflow-y-auto px-1">
        {/* (a) For who? — influencer chips + "+ New" + "Label only". */}
        {!isDefault && (
          <>
            <Label className="mb-2">{t.links.forWho}</Label>
            <div className="po-scroll mb-2 flex gap-2 overflow-x-auto pb-1">
              {influencers.map((inf) =>
                whoChip(inf.id, inf.name, whoKind === 'influencer' && whoId === inf.id, () => {
                  setWhoKind('influencer');
                  setWhoId(inf.id);
                  setErr(null);
                }),
              )}
              {whoChip('new', t.links.chipNew, whoKind === 'new', () => {
                setWhoKind('new');
                setErr(null);
              })}
              {whoChip('label', t.links.chipLabelOnly, whoKind === 'label', () => {
                setWhoKind('label');
                setErr(null);
              })}
            </div>
            {whoKind === 'new' && (
              <Field placeholder={t.links.newInfluencerPlaceholder} value={newName} onChange={setNewName} autoFocus className="mb-3" />
            )}
            {whoKind === 'label' && (
              <Field placeholder={t.links.labelPlaceholder} value={label} onChange={setLabel} autoFocus className="mb-3" />
            )}
          </>
        )}

        {/* (b) Tier — the shared kit picker (G3-0). */}
        <Label className="mb-2">{t.links.tierLabel}</Label>
        {tiersLoading ? (
          <div className="mb-3 py-[14px] text-center text-[13px] text-faint">{t.events.loadingTiers}</div>
        ) : (
          <TierPicker
            className="mb-3"
            tiers={tiers}
            value={tierId}
            onChange={setTierId}
            hint={(row) => (row.max != null ? fmt(t.links.tierUsedOfMax, { used: row.used, max: row.max }) : t.links.tierNoMax)}
            none={autoApprove ? undefined : { label: t.links.noFixedTier, sub: t.links.noFixedTierSub }}
          />
        )}

        {/* (c) Auto-approve — needs a pinned tier. */}
        <div className="mb-1 rounded-[16px] border border-line bg-elev px-[14px] py-1">
          <ToggleRow title={t.links.autoApproveTitle} sub={t.links.autoApproveSub} on={autoApprove} set={setAuto} last />
        </div>

        {/* (d) Max heads + expiry. */}
        <Label className="mb-2 mt-3">{t.links.maxHeadsLabel}</Label>
        <Field icon="users" placeholder={t.links.maxHeadsPlaceholder} value={maxHeads} onChange={(v) => setMaxHeads(v.replace(/[^0-9]/g, ''))} inputMode="numeric" className="mb-3" />
        <div className="mb-3 flex gap-[10px]">
          <div className="flex-1">
            <Label className="mb-2">{`${t.links.expiresLabel} · ${t.links.expiresDate}`}</Label>
            <Field icon="cal" type="date" value={expiryDate} onChange={setExpiryDate} />
          </div>
          <div className="flex-1">
            <Label className="mb-2">{t.links.expiresTime}</Label>
            <Field icon="clock" type="time" value={expiryTime} onChange={setExpiryTime} />
          </div>
        </div>

        {/* The slug is immutable — show the URL read-only. */}
        <Label className="mb-2">{t.links.urlLabel}</Label>
        <div className="mb-3 overflow-hidden text-ellipsis whitespace-nowrap rounded-field border border-line bg-elev px-[15px] py-[12px] font-mono text-[12.5px] text-dim">
          {linkUrl(link.slug)}
        </div>
      </div>

      {err && <div className="mt-2"><ErrLine msg={err} /></div>}
      <Btn kind="primary" full icon="check" disabled={busy} onClick={() => void save()} className={cn('mt-2', busy && 'opacity-50')}>
        {busy ? t.links.saving : t.links.saveCta}
      </Btn>

      {/* Archive (soft) — never the default link. */}
      {!isDefault && (
        confirmArchive ? (
          <div className="mt-3 rounded-[13px] border border-[#E89AC0]/40 p-[13px]">
            <div className="mb-2.5 text-[12.5px] leading-[1.45] text-dim">{t.links.archiveConfirmText}</div>
            <div className="flex gap-2">
              <Btn sm kind="dark" full disabled={busy} onClick={() => void archive()}>
                {update.isPending ? t.links.archiving : t.links.archiveConfirmCta}
              </Btn>
              <Btn sm kind="ghost" full onClick={() => setConfirmArchive(false)}>
                {t.links.cancel}
              </Btn>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmArchive(true)}
            className={cn('mt-3 cursor-pointer self-center border-none bg-transparent font-body text-[13.5px] font-semibold text-[#E89AC0]', press)}
          >
            {t.links.archiveCta}
          </button>
        )
      )}
      <button type="button" onClick={onClose} className={cn('mt-3 cursor-pointer self-center border-none bg-transparent font-body text-[13.5px] font-semibold text-faint', press)}>
        {t.links.cancel}
      </button>
    </Sheet>
  );
}

// ── QR sheet ──────────────────────────────────────────────────────────────────
// Pure-JS QR (the `qrcode` package) rendered to a data-URL <img> — webview-safe
// (#37): no canvas API assumptions, no external requests, download via <a download>.
function QrSheet({ link, onClose }: { link: PoRequestLink; onClose: () => void }): JSX.Element {
  const url = linkUrl(link.slug);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import('qrcode')
      .then((m) => m.toDataURL(url, { width: 512, margin: 2, color: { dark: '#0B0B0D', light: '#FFFFFF' } }))
      .then((d) => {
        if (!cancelled) setDataUrl(d);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const copy = async (): Promise<void> => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      // Clipboard blocked — the URL is visible below the code.
    }
  };

  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-1 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">{t.links.qrTitle}</div>
      <div className="mb-4 text-[13px] text-faint">{t.links.qrHint}</div>
      <div className="mb-4 flex justify-center">
        {failed ? (
          <div className="py-[30px] text-center text-[14px] text-faint">{t.links.qrError}</div>
        ) : dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL, next/image adds nothing here
          <img src={dataUrl} alt={fmt(t.links.qrImageAlt, { url })} className="h-[220px] w-[220px] rounded-[18px] bg-white p-[10px]" />
        ) : (
          <div className="flex h-[220px] w-[220px] items-center justify-center rounded-[18px] border border-line bg-elev2 text-[13px] text-faint">
            {t.links.qrGenerating}
          </div>
        )}
      </div>
      <div className="mb-4 flex items-center gap-[9px]">
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[12.5px] text-dim">{url}</span>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={t.links.copyAria}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-[10px] border px-3 py-[7px] font-display text-[12.5px] font-bold transition-[filter] hover:brightness-[1.2]',
            copied ? 'border-acc/40 bg-acc-dim text-acc' : 'border-line text-dim',
          )}
        >
          <Icon name={copied ? 'check' : 'link'} size={15} />
          {copied ? t.links.qrCopied : t.links.qrCopy}
        </button>
      </div>
      {dataUrl && (
        <a
          href={dataUrl}
          download={`${link.slug}.png`}
          className={cn(
            'inline-flex w-full cursor-pointer items-center justify-center gap-[9px] whitespace-nowrap rounded-btn border border-transparent bg-acc px-5 py-[15px] font-display text-[16px] font-bold tracking-[-0.01em] text-on-acc',
            press,
          )}
        >
          <Icon name="dl" size={19} sw={2.1} />
          {t.links.qrDownload}
        </a>
      )}
      <button type="button" onClick={onClose} className={cn('mt-3 cursor-pointer self-center border-none bg-transparent font-body text-[13.5px] font-semibold text-faint', press)}>
        {t.links.cancel}
      </button>
    </Sheet>
  );
}
