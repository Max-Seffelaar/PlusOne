'use client';

/**
 * Venue influencers (Requests-epic F1, 86ey21vjt) — the roster of promoters who
 * get their own request links per event. Reached from the More hub (admin) via
 * nav.push('influencers'). List + create/edit sheets in one screen; the
 * stats-token dashboard is F2 and deliberately absent here. RLS is the boundary:
 * admin manages, organizer/finance read, staff/door get [].
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { fmt, t } from '@/lib/i18n';
import type { PoInfluencer } from '@/features/po/queries';
import { usePoInfluencers } from '@/features/po/hooks';
import {
  usePoCreateInfluencer,
  usePoRevokeStatsToken,
  usePoRotateStatsToken,
  usePoUpdateInfluencer,
} from '@/features/po/mutations';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { useNav } from '../context';
import { Icon } from '../icon';
import { Avatar, Btn, Empty, Field, IconBtn, Label, Loading, Note, Scroll, Top, press, cardPress } from '../kit';
import { Sheet } from '../shell';

const col = 'flex h-full flex-col';

function ErrLine({ msg }: { msg: string }): JSX.Element {
  return <div className="mb-3 text-[13px] font-semibold text-[#E89AC0]">{msg}</div>;
}

export function Influencers(): JSX.Element {
  const nav = useNav();
  const { roles } = usePoIdentity();
  const isAdmin = roles.includes('admin');
  const listQ = usePoInfluencers();
  const [sheet, setSheet] = useState<{ mode: 'create' } | { mode: 'edit'; influencer: PoInfluencer } | null>(null);

  const list = listQ.data ?? [];

  return (
    <div className={col}>
      <Top
        onBack={nav.back}
        title={t.links.influencersTitle}
        right={isAdmin ? <IconBtn name="plus" onClick={() => setSheet({ mode: 'create' })} /> : undefined}
      />
      <Scroll bottom={28}>
        <Note icon="star">{t.links.influencersExplainer}</Note>
        {!isAdmin && !listQ.isLoading && <Note icon="shield">{t.links.influencersAdminOnly}</Note>}
        {listQ.isLoading ? (
          <Loading text={t.links.influencersLoading} />
        ) : listQ.isError ? (
          <Empty text={t.links.influencersLoadError} />
        ) : list.length === 0 ? (
          <Empty text={t.links.influencersEmpty} />
        ) : (
          <div className="flex flex-col gap-[9px] lg:grid lg:grid-cols-2 lg:gap-[10px] lg:items-start">
            {list.map((inf) => (
              <button
                key={inf.id}
                type="button"
                onClick={() => isAdmin && setSheet({ mode: 'edit', influencer: inf })}
                className={cn(
                  'flex w-full items-center gap-[12px] rounded-[16px] border border-line bg-elev p-[13px] text-left',
                  isAdmin ? cn('cursor-pointer', cardPress) : 'cursor-default',
                )}
              >
                <Avatar name={inf.name} size={42} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[15px] font-bold text-text">{inf.name}</span>
                  <span className="mt-px block truncate text-[12px] text-faint">
                    {inf.handle ? `${inf.handle} · ` : ''}
                    {fmt(inf.linkCount === 1 ? t.links.linksCountOne : t.links.linksCountMany, { n: inf.linkCount })}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </Scroll>
      {sheet && (
        <InfluencerSheet
          influencer={sheet.mode === 'edit' ? sheet.influencer : null}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

/**
 * Stats-link management (F2, /i/[token]) — mints/rotates the influencer's private
 * stats-page URL. The bearer token is returned ONCE (only its sha256 is stored),
 * so the full URL shows exactly once with a copy button; Renew replaces the old
 * URL, Revoke kills the page. Admin-only via RLS (the sheet is admin-gated).
 */
function StatsLinkBlock({ influencer }: { influencer: PoInfluencer }): JSX.Element {
  const rotate = usePoRotateStatsToken();
  const revoke = usePoRevokeStatsToken();
  // The prop is a snapshot — track token presence locally after rotate/revoke.
  const [hasToken, setHasToken] = useState(influencer.hasStatsToken);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const busy = rotate.isPending || revoke.isPending;

  const mint = async (): Promise<void> => {
    setErr(null);
    setRevoked(false);
    try {
      const token = await rotate.mutateAsync(influencer.id);
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setFreshUrl(`${origin}/i/${token}`);
      setHasToken(true);
      setCopied(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.links.errStatsLink);
    }
  };

  const doRevoke = async (): Promise<void> => {
    setErr(null);
    try {
      await revoke.mutateAsync(influencer.id);
      setHasToken(false);
      setFreshUrl(null);
      setConfirmRevoke(false);
      setRevoked(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.links.errStatsLink);
    }
  };

  const copy = async (): Promise<void> => {
    if (!freshUrl) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(freshUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      // Clipboard blocked — the URL stays visible/selectable in the row.
    }
  };

  return (
    <>
      <Label className="mb-2">{t.links.statsLinkLabel}</Label>
      <div className="mb-4 rounded-[16px] border border-line bg-elev p-[14px]">
        <div className="mb-3 text-[12.5px] leading-[1.45] text-dim">{t.links.statsLinkExplainer}</div>
        {freshUrl ? (
          <>
            <div className="mb-2 flex items-center gap-[9px]">
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[12.5px] text-dim">
                {freshUrl}
              </span>
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
                {copied ? t.links.statsLinkCopied : t.links.statsLinkCopy}
              </button>
            </div>
            <div className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold text-acc-soft">
              <Icon name="warn" size={13} stroke="#B5A6FF" />
              {t.links.statsLinkWarning}
            </div>
          </>
        ) : (
          <div className="mb-3 text-[12px] text-faint">
            {revoked ? t.links.statsLinkRevoked : hasToken ? t.links.statsLinkActive : t.links.statsLinkNone}
          </div>
        )}
        <div className="flex gap-2">
          <Btn sm kind="dark" full disabled={busy} onClick={() => void mint()}>
            {rotate.isPending ? t.links.statsLinkWorking : hasToken ? t.links.statsLinkRenew : t.links.statsLinkCreate}
          </Btn>
          {hasToken && !confirmRevoke && (
            <Btn sm kind="ghost" full disabled={busy} onClick={() => setConfirmRevoke(true)}>
              {t.links.statsLinkRevoke}
            </Btn>
          )}
        </div>
        {confirmRevoke && (
          <div className="mt-3 rounded-[13px] border border-[#E89AC0]/40 p-[13px]">
            <div className="mb-2.5 text-[12.5px] leading-[1.45] text-dim">{t.links.statsLinkRevokeConfirmText}</div>
            <div className="flex gap-2">
              <Btn sm kind="dark" full disabled={busy} onClick={() => void doRevoke()}>
                {revoke.isPending ? t.links.statsLinkWorking : t.links.statsLinkRevokeConfirmCta}
              </Btn>
              <Btn sm kind="ghost" full onClick={() => setConfirmRevoke(false)}>
                {t.links.cancel}
              </Btn>
            </div>
          </div>
        )}
        {err && <div className="mt-2 text-[13px] font-semibold text-[#E89AC0]">{err}</div>}
      </div>
    </>
  );
}

function InfluencerSheet({
  influencer,
  onClose,
}: {
  /** null = create mode. */
  influencer: PoInfluencer | null;
  onClose: () => void;
}): JSX.Element {
  const { venueId } = usePoIdentity();
  const create = usePoCreateInfluencer();
  const update = usePoUpdateInfluencer();

  const [name, setName] = useState(influencer?.name ?? '');
  const [handle, setHandle] = useState(influencer?.handle ?? '');
  const [notes, setNotes] = useState(influencer?.notes ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const busy = create.isPending || update.isPending;

  const save = async (): Promise<void> => {
    setErr(null);
    const nm = name.trim();
    if (nm.length < 2) {
      setErr(t.links.errInfluencerName);
      return;
    }
    try {
      if (!influencer) {
        if (!venueId) throw new Error(t.links.errInfluencerSave);
        await create.mutateAsync({
          venueId,
          name: nm,
          handle: handle.trim() || undefined,
          notes: notes.trim() || undefined,
        });
      } else {
        // null clears a blanked optional field; undefined would leave it untouched.
        await update.mutateAsync({
          influencerId: influencer.id,
          name: nm,
          handle: handle.trim() || null,
          notes: notes.trim() || null,
        });
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.links.errInfluencerSave);
    }
  };

  const archive = async (): Promise<void> => {
    if (!influencer) return;
    setErr(null);
    try {
      await update.mutateAsync({ influencerId: influencer.id, archived: true });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.links.errInfluencerSave);
    }
  };

  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-4 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">
        {influencer ? t.links.editInfluencerTitle : t.links.addInfluencerTitle}
      </div>
      <Label className="mb-2">{t.links.nameLabel}</Label>
      <Field placeholder={t.links.namePlaceholder} value={name} onChange={setName} autoFocus={!influencer} className="mb-3" />
      <Label className="mb-2">{t.links.handleLabel}</Label>
      <Field icon="spark" placeholder={t.links.handlePlaceholder} value={handle} onChange={setHandle} className="mb-3" />
      <Label className="mb-2">{t.links.notesLabel}</Label>
      <Field icon="note" placeholder={t.links.notesPlaceholder} value={notes} onChange={setNotes} className="mb-4" />
      {influencer && <StatsLinkBlock influencer={influencer} />}
      {err && <ErrLine msg={err} />}
      <Btn kind="primary" full icon="check" disabled={busy} onClick={() => void save()} className={busy ? 'opacity-50' : ''}>
        {busy ? t.links.saving : influencer ? t.links.saveCta : t.links.addCta}
      </Btn>
      {influencer &&
        (confirmArchive ? (
          <div className="mt-3 rounded-[13px] border border-[#E89AC0]/40 p-[13px]">
            <div className="mb-2.5 text-[12.5px] leading-[1.45] text-dim">
              {fmt(t.links.archiveInfluencerConfirmText, { name: influencer.name })}
            </div>
            <div className="flex gap-2">
              <Btn sm kind="dark" full disabled={busy} onClick={() => void archive()}>
                {update.isPending ? t.links.archiving : t.links.archiveInfluencerConfirmCta}
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
            {t.links.archiveInfluencerCta}
          </button>
        ))}
      <button type="button" onClick={onClose} className={cn('mt-3 cursor-pointer self-center border-none bg-transparent font-body text-[13.5px] font-semibold text-faint', press)}>
        {t.links.cancel}
      </button>
    </Sheet>
  );
}
