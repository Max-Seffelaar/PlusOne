'use client';

/**
 * Platform tab (P-04, z8uq9m0tnw) — PlusOne's own operator surface.
 *
 * One job: invite a customer into the open beta with nothing but an e-mail
 * address, and see how far each invite got (invited → signed in → company
 * created → first event). No venue is created here and no `public.invites` row
 * is written; the invitee walks the normal onboarding wizard (P-03).
 *
 * Security shape:
 *  - Visibility hangs on `is_platform_admin` (`usePoIsPlatformAdmin`), but that
 *    is UI only. RLS is the boundary: the reads are two SECURITY DEFINER
 *    functions that check `is_platform_admin()` themselves, and the three
 *    writes are the P-03 server actions, which re-check server-side. Someone
 *    who types /app/platform without the flag gets the flat "not available"
 *    state and we never fire a doomed RPC.
 *  - `note` is prospect PII and free-form operator text — rendered as plain
 *    text only, NEVER through `dangerouslySetInnerHTML` (PR #325, F9).
 *
 * Capacitor (#37): reads are client-side React Query, writes are online-only
 * server actions (nothing here is door-adjacent, so the outbox is not
 * involved), no browser-only API without a fallback, no billing UI.
 */
import { type JSX, useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import {
  usePoIsPlatformAdmin,
  usePoPlatformInvites,
  usePoPlatformFunnel,
} from '@/features/po/hooks';
import {
  usePoInviteBetaCustomer,
  usePoResendBetaInvite,
  usePoRevokeBetaInvite,
} from '@/features/po/mutations';
import {
  PLATFORM_INVITE_STAGES,
  type PlatformInvite,
  type PlatformInviteStage,
} from '@/features/po/adapters';
import { formatShortDate } from '@/features/po/format';
import { useNav } from '../context';
import { Icon } from '../icon';
import {
  ActionItem,
  Btn,
  Empty,
  Field,
  Label,
  MiniChip,
  Note,
  Scroll,
  StatTile,
  TextArea,
  Top,
} from '../kit';
import { ConfirmSheet } from '../shell';

const col = 'flex h-full flex-col';

const STAGE_LABEL: Record<PlatformInviteStage, string> = {
  invited: t.platform.stageInvited,
  signed_in: t.platform.stageSignedIn,
  company_created: t.platform.stageCompanyCreated,
  first_event: t.platform.stageFirstEvent,
  revoked: t.platform.stageRevoked,
};

/** A date we already know is present (created_at / last_sent_at are NOT NULL). */
function day(iso: string): string {
  return formatShortDate(iso);
}

function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : t.platform.loadError;
}

export function Platform(): JSX.Element {
  const nav = useNav();
  const isPlatformAdmin = usePoIsPlatformAdmin();

  // Not a platform admin: a flat, honest dead end. No reads are fired at all —
  // RLS would refuse them anyway, and a 42501 in the console is noise, not a
  // boundary. (A platform admin whose flag has not loaded yet sees this for a
  // beat and then the real screen; the hook caches for 5 minutes after that.)
  if (!isPlatformAdmin) {
    return (
      <div className={col}>
        <Top big title={t.platform.title} onBack={nav.canGoBack ? nav.back : undefined} />
        <Scroll bottom={90}>
          <Empty text={t.platform.notAvailable} />
        </Scroll>
      </div>
    );
  }
  return <PlatformConsole />;
}

function PlatformConsole(): JSX.Element {
  const nav = useNav();
  const invitesQ = usePoPlatformInvites();
  const funnelQ = usePoPlatformFunnel();
  const [confirmRevoke, setConfirmRevoke] = useState<PlatformInvite | null>(null);
  const revoke = usePoRevokeBetaInvite();

  const invites = invitesQ.data ?? [];

  return (
    <div className={col}>
      <Top
        big
        title={t.platform.title}
        sub={t.platform.subtitle}
        onBack={nav.canGoBack ? nav.back : undefined}
      />
      <Scroll bottom={100}>
        <PlatformNav />

        <InviteForm />

        <Label className="mb-[10px] mt-[26px]">{t.platform.funnelTitle}</Label>
        <Funnel counts={funnelQ.data} />

        <Label className="mb-[10px] mt-[26px]">{t.platform.listTitle}</Label>
        {invitesQ.isLoading ? (
          <Empty text={t.platform.loading} />
        ) : invitesQ.isError ? (
          <Empty text={t.platform.loadError} />
        ) : invites.length === 0 ? (
          <Empty text={t.platform.empty} />
        ) : (
          <div className="flex flex-col gap-2">
            {invites.map((inv) => (
              <InviteCard key={inv.id} invite={inv} onRevoke={() => setConfirmRevoke(inv)} />
            ))}
          </div>
        )}
        {revoke.isError && (
          <p className="mt-3 px-1 text-[12.5px] leading-[1.45] text-red-300" role="alert">
            {errorText(revoke.error)}
          </p>
        )}
      </Scroll>

      {confirmRevoke && (
        <ConfirmSheet
          icon="close"
          title={fmt(t.platform.revokeConfirmTitle, { email: confirmRevoke.email })}
          confirmLabel={revoke.isPending ? t.platform.revoking : t.platform.revokeConfirm}
          confirmDisabled={revoke.isPending}
          cancelLabel={t.platform.cancel}
          onConfirm={() => {
            revoke.mutate(confirmRevoke.id);
            setConfirmRevoke(null);
          }}
          onClose={() => setConfirmRevoke(null)}
        >
          <Note icon="warn">{t.platform.revokeConfirmBody}</Note>
        </ConfirmSheet>
      )}
    </div>
  );
}

// ── Nav into the venue overview + audit viewer (P-05) ────────────────────────

function PlatformNav(): JSX.Element {
  const nav = useNav();
  return (
    <div className="mb-[18px] flex flex-col gap-2">
      <ActionItem
        icon="building"
        label={t.platform.venuesNavTitle}
        sub={t.platform.venuesNavSub}
        onClick={() => nav.push('platformvenues', {})}
      />
      <ActionItem
        icon="shield"
        label={t.platform.auditNavTitle}
        sub={t.platform.auditNavSub}
        onClick={() => nav.push('platformaudit', {})}
      />
    </div>
  );
}

// ── Invite form ──────────────────────────────────────────────────────────────

function InviteForm(): JSX.Element {
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const invite = usePoInviteBetaCustomer();

  const submit = (): void => {
    if (invite.isPending) return;
    if (!email.trim()) {
      setLocalError(t.platform.emailRequired);
      return;
    }
    setLocalError(null);
    invite.mutate(
      { email: email.trim(), note },
      {
        onSuccess: () => {
          setEmail('');
          setNote('');
        },
      },
    );
  };

  return (
    <div className="rounded-[18px] border border-line bg-elev p-4">
      <div className="font-display text-[16px] font-bold text-text">{t.platform.inviteTitle}</div>
      <p className="mt-1 text-[12.5px] leading-[1.45] text-faint">{t.platform.inviteIntro}</p>

      <Label className="mb-[6px] mt-[14px]">{t.platform.emailLabel}</Label>
      <Field
        icon="mail"
        type="email"
        inputMode="email"
        ariaLabel={t.platform.emailLabel}
        placeholder={t.platform.emailPlaceholder}
        value={email}
        onChange={setEmail}
      />

      <Label className="mb-[6px] mt-[14px]">{t.platform.noteLabel}</Label>
      <TextArea
        value={note}
        onChange={setNote}
        rows={2}
        maxLength={500}
        ariaLabel={t.platform.noteLabel}
        placeholder={t.platform.notePlaceholder}
      />
      <p className="mt-[6px] text-[11.5px] leading-[1.4] text-faint">{t.platform.noteHint}</p>

      <Btn
        kind="primary"
        full
        icon="mail"
        className="mt-[14px]"
        disabled={invite.isPending}
        onClick={submit}
      >
        {invite.isPending ? t.platform.sending : t.platform.send}
      </Btn>

      {(localError || invite.isError) && (
        <p className="mt-3 text-[12.5px] leading-[1.45] text-red-300" role="alert">
          {localError ?? errorText(invite.error)}
        </p>
      )}
      {invite.isSuccess && !invite.isPending && (
        <p className="mt-3 text-[12.5px] leading-[1.45] text-acc" role="status">
          {invite.data?.message ?? ''}
        </p>
      )}
    </div>
  );
}

// ── Funnel ───────────────────────────────────────────────────────────────────

function Funnel({ counts }: { counts?: Record<PlatformInviteStage, number> }): JSX.Element {
  // Aggregated in SQL over EVERY invite (never a count of the loaded page) —
  // the hook hands us the complete, zero-filled record.
  const c = counts;
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
        {PLATFORM_INVITE_STAGES.map((stage, i) => (
          <StatTile
            key={stage}
            label={STAGE_LABEL[stage]}
            value={c ? c[stage] : '—'}
            accent={i === PLATFORM_INVITE_STAGES.length - 1}
          />
        ))}
        <StatTile label={STAGE_LABEL.revoked} value={c ? c.revoked : '—'} muted />
      </div>
      <p className="mt-[8px] px-1 text-[11.5px] leading-[1.4] text-faint">{t.platform.funnelHint}</p>
    </>
  );
}

// ── One invite ───────────────────────────────────────────────────────────────

function StageTrack({ invite }: { invite: PlatformInvite }): JSX.Element {
  if (invite.revoked) {
    return (
      <MiniChip className="border-line2 text-faint">{STAGE_LABEL.revoked}</MiniChip>
    );
  }
  return (
    <div className="flex items-center gap-[5px]" aria-label={STAGE_LABEL[invite.stage]}>
      {PLATFORM_INVITE_STAGES.map((stage, i) => (
        <span
          key={stage}
          className={cn(
            'h-[5px] w-[22px] rounded-full',
            invite.stageIndex !== null && i <= invite.stageIndex ? 'bg-acc' : 'bg-line2',
          )}
        />
      ))}
      <span className="ml-[6px] text-[11.5px] font-semibold text-dim">
        {STAGE_LABEL[invite.stage]}
      </span>
    </div>
  );
}

function InviteCard({
  invite,
  onRevoke,
}: {
  invite: PlatformInvite;
  onRevoke: () => void;
}): JSX.Element {
  const resend = usePoResendBetaInvite();
  const venuesCopy =
    invite.venueCount === 1
      ? fmt(t.platform.venues, { count: invite.venueCount })
      : fmt(t.platform.venuesPlural, { count: invite.venueCount });
  const eventsCopy =
    invite.eventCount === 1
      ? fmt(t.platform.events, { count: invite.eventCount })
      : fmt(t.platform.eventsPlural, { count: invite.eventCount });

  return (
    <div className={cn('rounded-[16px] border border-line bg-elev p-[14px]', invite.revoked && 'opacity-70')}>
      <div className="flex min-w-0 items-start gap-[10px]">
        <span className="mt-px flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] border border-line bg-elev2 text-faint">
          <Icon name="mail" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          {/* Plain text. Prospect PII + free-form operator input: never HTML. */}
          <div className="truncate text-[14.5px] font-semibold text-text">{invite.email}</div>
          <div className="mt-0.5 text-[12px] text-faint">
            {fmt(t.platform.invitedOn, { date: day(invite.invitedAt) })}
            {invite.invitedByName ? ` · ${fmt(t.platform.invitedBy, { name: invite.invitedByName })}` : ''}
          </div>
        </div>
      </div>

      <div className="mt-[11px]">
        <StageTrack invite={invite} />
      </div>

      {(invite.venueCount > 0 || invite.eventCount > 0) && (
        <div className="mt-[9px] flex flex-wrap gap-[6px]">
          {invite.venueCount > 0 && <MiniChip>{venuesCopy}</MiniChip>}
          {invite.eventCount > 0 && <MiniChip>{eventsCopy}</MiniChip>}
        </div>
      )}

      {invite.note && (
        <p className="mt-[9px] whitespace-pre-wrap break-words rounded-[11px] bg-elev2 px-[11px] py-[8px] text-[12.5px] leading-[1.45] text-dim">
          {invite.note}
        </p>
      )}

      <div className="mt-[11px] text-[11.5px] text-faint">
        {invite.revoked && invite.revokedAt
          ? fmt(t.platform.revokedOn, { date: day(invite.revokedAt) })
          : fmt(t.platform.lastSent, { date: day(invite.lastSentAt) })}
      </div>

      {!invite.revoked && (
        <>
          <div className="mt-[11px] flex flex-wrap gap-2">
            <Btn
              kind="ghost"
              sm
              icon="refresh"
              className="min-h-[44px]"
              disabled={resend.isPending}
              onClick={() => resend.mutate(invite.id)}
            >
              {resend.isPending ? t.platform.resending : t.platform.resend}
            </Btn>
            <Btn kind="ghost" sm icon="close" className="min-h-[44px]" onClick={onRevoke}>
              {t.platform.revoke}
            </Btn>
          </div>
          <p className="mt-[7px] text-[11.5px] leading-[1.4] text-faint">{t.platform.revokeHelp}</p>
        </>
      )}

      {resend.isError && (
        <p className="mt-2 text-[12.5px] leading-[1.45] text-red-300" role="alert">
          {errorText(resend.error)}
        </p>
      )}
      {resend.isSuccess && !resend.isPending && (
        <p className="mt-2 text-[12.5px] leading-[1.45] text-acc" role="status">
          {resend.data?.message ?? ''}
        </p>
      )}
    </div>
  );
}
