'use client';

/** Admin sessies & remote logout (po) — mobile parity with the desktop
 *  /admin/sessions. Admin-only + AAL2; the admin_* RPCs re-enforce both, so this
 *  only renders the right state. Pick a teamlid → bekijk hun actieve apparaten →
 *  log op afstand uit. Reads via the browser client (admin_list_user_sessions),
 *  writes via the shared adminRevokeSessionAction. Reached from the Meer hub. */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { usePoAal2, usePoTeam, usePoUserSessions } from '@/features/po/hooks';
import { usePoAdminRevokeSession } from '@/features/po/mutations';
import type { PoTeamMember } from '@/features/po/adapters';
import { useMfaGate } from '../mfa-gate';
import { useNav } from '../context';
import { Icon, type IconName } from '../icon';
import { Avatar, Btn, Empty, Label, MiniChip, Note, Scroll, Top } from '../kit';
import { Sheet } from '../shell';

const col = 'flex h-full flex-col';
const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';
const sessionIcon = (device: string): IconName => (/mac|windows|linux/i.test(device) ? 'grid' : 'user');

function FormError({ error }: { error: unknown }): JSX.Element | null {
  if (!error) return null;
  const msg = error instanceof Error && error.message ? error.message : 'Er ging iets mis.';
  return (
    <p className="mt-3 text-[12.5px] leading-[1.45] text-red-300" role="alert">
      {msg}
    </p>
  );
}

export function AdminSessions(): JSX.Element {
  const nav = useNav();
  const { roles, venueName } = usePoIdentity();
  const isAdmin = roles.includes('admin');
  const aal = usePoAal2();
  const mfa = useMfaGate();
  const [selected, setSelected] = useState<PoTeamMember | null>(null);

  // No admin role → never attempt (the RPC refuses anyway).
  if (!isAdmin) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title="Sessies" />
        <Scroll bottom={28}>
          <Empty text="Alleen beheerders kunnen de sessies van teamleden beheren." />
        </Scroll>
      </div>
    );
  }

  // AAL2 gate — listing/revoking another member's sessions requires MFA.
  if (!aal.isAal2) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title="Sessies & remote logout" sub={venueName ?? undefined} />
        <Scroll bottom={28}>
          <Note icon="shield">
            Sessiebeheer en het op afstand uitloggen van teamleden vereisen een MFA-geverifieerde sessie.
          </Note>
          {aal.loading ? (
            <Empty text="Laden…" />
          ) : (
            <div className="rounded-[18px] border border-acc-dim bg-acc-dim p-5">
              <div className="mb-1 flex items-center gap-[10px]">
                <Icon name="shield" size={20} stroke="#B5A6FF" />
                <span className="font-display text-[16px] font-bold text-text">MFA vereist</span>
              </div>
              <div className="mb-4 text-[13px] leading-[1.5] text-dim">
                Verifieer met je authenticator om de apparaten van een teamlid te beheren.
              </div>
              <Btn kind="primary" full icon="shield" onClick={() => mfa.start(() => aal.recheck())}>
                Verifieer met MFA
              </Btn>
            </div>
          )}
        </Scroll>
        {mfa.sheet}
      </div>
    );
  }

  // A member is selected → their sessions; otherwise the member picker.
  if (selected) {
    return <MemberSessions member={selected} venueName={venueName} onBack={() => setSelected(null)} />;
  }
  return <MemberPicker venueName={venueName} onBack={nav.back} onSelect={setSelected} />;
}

function MemberPicker({
  venueName,
  onBack,
  onSelect,
}: {
  venueName: string | null;
  onBack: () => void;
  onSelect: (m: PoTeamMember) => void;
}): JSX.Element {
  const team = usePoTeam();
  const members = team.data ?? [];
  return (
    <div className={col}>
      <Top onBack={onBack} title="Sessies & remote logout" sub={venueName ?? undefined} />
      <Scroll bottom={28}>
        <Note icon="shield">
          Kies een teamlid om hun actieve apparaten te bekijken en zo nodig op afstand uit te loggen.
        </Note>
        <Label className="mb-[10px]">Teamlid kiezen</Label>
        {team.isLoading ? (
          <Empty text="Laden…" />
        ) : members.length === 0 ? (
          <Empty text="Geen teamleden in deze venue." />
        ) : (
          <div className="flex flex-col gap-2">
            {members.map((m) => (
              <button
                key={m.userId}
                type="button"
                onClick={() => onSelect(m)}
                className={cn(
                  'flex items-center gap-[12px] rounded-[14px] border border-line bg-elev px-4 py-3 text-left',
                  press,
                )}
              >
                <Avatar name={m.name || m.email} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.5px] font-semibold text-text">{m.name || 'Naamloos'}</div>
                  <div className="mt-0.5 truncate text-[12px] text-faint">
                    {m.email} · {m.rolesLabel}
                  </div>
                </div>
                <Icon name="chev" size={18} className="text-ghost" />
              </button>
            ))}
          </div>
        )}
      </Scroll>
    </div>
  );
}

function MemberSessions({
  member,
  venueName,
  onBack,
}: {
  member: PoTeamMember;
  venueName: string | null;
  onBack: () => void;
}): JSX.Element {
  const sessionsQ = usePoUserSessions(member.userId);
  const revoke = usePoAdminRevokeSession(member.userId);
  const sessions = sessionsQ.data ?? [];
  const [confirmAll, setConfirmAll] = useState(false);
  return (
    <div className={col}>
      <Top onBack={onBack} title={member.name || member.email} sub={`Actieve apparaten · ${venueName ?? ''}`} />
      <Scroll bottom={28}>
        <Note icon="shield">
          Op afstand uitloggen beëindigt de sessie op dat apparaat — daar moet daarna opnieuw worden ingelogd.
        </Note>
        {sessionsQ.isLoading ? (
          <Empty text="Laden…" />
        ) : sessionsQ.isError ? (
          <Empty text="Kon de sessies niet laden." />
        ) : sessions.length === 0 ? (
          <Empty text="Geen actieve sessies." />
        ) : (
          <div className="rounded-[18px] border border-line bg-elev px-4 py-0.5">
            {sessions.map((se, i) => (
              <div
                key={se.id}
                className={cn(
                  'flex items-center gap-[12px] py-[13px]',
                  i < sessions.length - 1 && 'border-b border-line2',
                )}
              >
                <span className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[11px] border border-line bg-elev2 text-faint">
                  <Icon name={sessionIcon(se.device)} size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-text">{se.device}</div>
                  <div className="mt-0.5 text-[12px] text-faint">
                    {se.where} · {se.last}
                  </div>
                </div>
                <MiniChip onClick={() => revoke.mutate(se.id)}>
                  {revoke.isPending && revoke.variables === se.id ? '…' : 'Uitloggen'}
                </MiniChip>
              </div>
            ))}
          </div>
        )}
        {sessions.length > 0 && (
          <Btn
            kind="ghost"
            full
            icon="logout"
            className="mt-3"
            disabled={revoke.isPending}
            onClick={() => setConfirmAll(true)}
          >
            Log {member.name.split(' ')[0] || 'dit lid'} overal uit
          </Btn>
        )}
        <FormError error={revoke.isError ? revoke.error : null} />
      </Scroll>
      {confirmAll && (
        <Sheet onClose={() => setConfirmAll(false)} center={false}>
          <Note icon="warn">
            Je logt {member.name || member.email} uit op {sessions.length}{' '}
            {sessions.length === 1 ? 'apparaat' : 'apparaten'}. Daar moet daarna opnieuw worden ingelogd.
          </Note>
          <Btn
            kind="primary"
            full
            icon="logout"
            className="mt-2"
            disabled={revoke.isPending}
            onClick={() => {
              sessions.forEach((s) => revoke.mutate(s.id));
              setConfirmAll(false);
            }}
          >
            {revoke.isPending ? 'Uitloggen…' : 'Ja, log overal uit'}
          </Btn>
          <Btn kind="ghost" full className="mt-2" onClick={() => setConfirmAll(false)}>
            Annuleren
          </Btn>
        </Sheet>
      )}
    </div>
  );
}
