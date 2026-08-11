'use client';

/** Admin sessions & remote logout (po) — mobile parity with the desktop
 *  /admin/sessions. Admin-only, role-only (the admin_* RPCs dropped their AAL2
 *  check in the #20 2026-07-02 "MFA fully optional" refinement — no hard gate
 *  anywhere), so this only renders the right state. Pick a team member → see
 *  their active devices → log out remotely. Reads via the browser client
 *  (admin_list_user_sessions), writes via the shared adminRevokeSessionAction.
 *  Reached from the Meer hub. */
import { type JSX, useState } from 'react';
import { cn } from '@/lib/utils';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { usePoTeam, usePoUserSessions } from '@/features/po/hooks';
import { usePoAdminRevokeSession } from '@/features/po/mutations';
import type { PoTeamMember } from '@/features/po/adapters';
import { useNav } from '../context';
import { Icon, type IconName } from '../icon';
import { Avatar, Btn, Empty, Label, MiniChip, Note, Scroll, Top, press } from '../kit';
import { Sheet } from '../shell';

const col = 'flex h-full flex-col';
const sessionIcon = (device: string): IconName => (/mac|windows|linux/i.test(device) ? 'grid' : 'user');

function FormError({ error }: { error: unknown }): JSX.Element | null {
  if (!error) return null;
  const msg = error instanceof Error && error.message ? error.message : 'Something went wrong.';
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
  const [selected, setSelected] = useState<PoTeamMember | null>(null);

  // No admin role → never attempt (the RPC refuses anyway).
  if (!isAdmin) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title="Sessions" />
        <Scroll bottom={28}>
          <Empty text="Only admins can manage team members' sessions." />
        </Scroll>
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
      <Top onBack={onBack} title="Team sessions" sub={venueName ?? undefined} />
      <Scroll bottom={28}>
        <Note icon="shield">
          Pick a member to see their active devices and log them out remotely if needed.
        </Note>
        <Label className="mb-[10px]">Pick a member</Label>
        {team.isLoading ? (
          <Empty text="Loading…" />
        ) : members.length === 0 ? (
          <Empty text="No team members in this venue." />
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
                  <div className="truncate text-[14.5px] font-semibold text-text">{m.name || 'No name'}</div>
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
      <Top onBack={onBack} title={member.name || member.email} sub={`Active devices · ${venueName ?? ''}`} />
      <Scroll bottom={28}>
        <Note icon="shield">
          Logging out remotely ends the session on that device. They&apos;ll need to log in again there.
        </Note>
        {sessionsQ.isLoading ? (
          <Empty text="Loading…" />
        ) : sessionsQ.isError ? (
          <Empty text="Couldn't load the sessions." />
        ) : sessions.length === 0 ? (
          <Empty text="No active sessions." />
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
                  {revoke.isPending && revoke.variables === se.id ? '…' : 'Log out'}
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
            Log {member.name.split(' ')[0] || 'this member'} out everywhere
          </Btn>
        )}
        <FormError error={revoke.isError ? revoke.error : null} />
      </Scroll>
      {confirmAll && (
        <Sheet onClose={() => setConfirmAll(false)} center={false}>
          <Note icon="warn">
            You&apos;ll log {member.name || member.email} out on {sessions.length}{' '}
            {sessions.length === 1 ? 'device' : 'devices'}. They&apos;ll need to log in again there.
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
            {revoke.isPending ? 'Logging out…' : 'Yes, log out everywhere'}
          </Btn>
          <Btn kind="ghost" full className="mt-2" onClick={() => setConfirmAll(false)}>
            Cancel
          </Btn>
        </Sheet>
      )}
    </div>
  );
}
