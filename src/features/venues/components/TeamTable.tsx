'use client';

/** Real "Gebruikers" table — the PLUSONE desktop `Users` view (views.tsx) wired
 *  to live venue data. Presentation matches the mock 1:1 (DCard table, role
 *  chips, quota + security columns, dashed invite cards); management reuses the
 *  existing server-action components in an expandable row. */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Avatar, Label } from '@/components/po/kit';
import { DCard } from '@/components/po/desktop/kit';
import { Icon } from '@/components/po/icon';
import { ROLE_LABELS, type VenueRole } from '@/features/auth/roles';
import { MemberRolesEditor } from './MemberRolesEditor';
import { RemoveMemberButton } from './RemoveMemberButton';
import { RevokeInviteButton } from '@/features/auth/components/RevokeInviteButton';

export interface TeamMemberRow {
  userId: string;
  fullName: string;
  email: string;
  jobTitle: string | null;
  roles: VenueRole[];
  /** Effective default quota (personal override, else venue default). */
  quota: number;
  /** True when the member has a personal override (vs. inheriting the venue default). */
  quotaIsOverride: boolean;
  /** Admins/organisators carry no personal quota cap. */
  exemptFromQuota: boolean;
  /** Caller may edit roles / remove this member (AAL2 + escalation rules, decided server-side). */
  canManage: boolean;
  /** Removing this member would leave the venue without an admin — block it. */
  isLastAdmin: boolean;
}

export interface TeamInviteRow {
  id: string;
  email: string;
  roles: VenueRole[];
  expiresAt: string;
}

// Matches the mock USER_GRID, with the last (chevron) column as the expand toggle.
const USER_GRID = 'grid-cols-[1.5fr_1.3fr_116px_104px_36px]';

function RoleChips({ roles }: { roles: VenueRole[] }): JSX.Element {
  if (roles.length === 0) return <span className="text-faint text-[12px]">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {roles.map((r) => (
        <span
          key={r}
          className="text-dim border-line bg-elev2 whitespace-nowrap rounded-[7px] border px-[9px] py-1 font-body text-[11.5px] font-bold"
        >
          {ROLE_LABELS[r]}
        </span>
      ))}
    </div>
  );
}

export function TeamTable({
  venueId,
  venueName,
  callerIsAdmin,
  canManageInvites,
  members,
  invites,
}: {
  venueId: string;
  venueName: string;
  callerIsAdmin: boolean;
  /** caps.manageTeam && AAL2 — gates the invite revoke buttons. */
  canManageInvites: boolean;
  members: TeamMemberRow[];
  invites: TeamInviteRow[];
}): JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-[22px]">
      <DCard className="overflow-hidden p-0">
        <div className={cn('border-line bg-bg grid border-b px-[22px] py-[13px]', USER_GRID)}>
          {['Gebruiker', 'Rollen', 'Quotum', 'Beveiliging', ''].map((h, i) => (
            <Label key={i}>{h}</Label>
          ))}
        </div>

        {members.map((m, i) => {
          const open = openId === m.userId;
          const requiresMfa = m.roles.includes('admin') || m.roles.includes('finance');
          const last = i === members.length - 1;
          return (
            <div key={m.userId} className={cn(!last && 'border-line2 border-b')}>
              <div
                role={m.canManage ? 'button' : undefined}
                tabIndex={m.canManage ? 0 : undefined}
                onClick={() => m.canManage && setOpenId(open ? null : m.userId)}
                onKeyDown={(e) => {
                  if (m.canManage && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    setOpenId(open ? null : m.userId);
                  }
                }}
                className={cn(
                  'grid items-center px-[22px] py-[15px] transition-colors',
                  USER_GRID,
                  m.canManage && 'cursor-pointer hover:bg-white/[0.025]'
                )}
              >
                {/* Gebruiker */}
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={m.fullName} size={36} />
                  <div className="min-w-0">
                    <div className="font-display text-text truncate text-[14.5px] font-bold">
                      {m.fullName}
                    </div>
                    <div className="text-faint truncate text-[12px]">{m.jobTitle ?? m.email}</div>
                  </div>
                </div>

                {/* Rollen */}
                <RoleChips roles={m.roles} />

                {/* Quotum */}
                {m.exemptFromQuota ? (
                  <span className="text-faint text-[12px]">Uitgezonderd</span>
                ) : (
                  <div className="leading-tight">
                    <span className="font-display text-text text-[15px] font-bold">{m.quota}</span>
                    <span className="text-faint ml-1 text-[11.5px]">
                      {m.quotaIsOverride ? 'eigen' : 'venue'}
                    </span>
                  </div>
                )}

                {/* Beveiliging */}
                {requiresMfa ? (
                  <span className="text-acc inline-flex items-center gap-[5px] font-body text-[12px] font-bold">
                    <Icon name="shield" size={13} stroke="#B5A6FF" />
                    MFA
                  </span>
                ) : (
                  <span className="text-faint text-[12px]">OTP</span>
                )}

                {/* Expand toggle */}
                <div className="text-ghost flex justify-end">
                  {m.canManage && (
                    <Icon
                      name="chevD"
                      size={18}
                      className={cn('transition-transform', open && 'rotate-180')}
                    />
                  )}
                </div>
              </div>

              {open && m.canManage && (
                <div className="border-line2 bg-bg/40 flex flex-col gap-3 border-t px-[22px] py-4">
                  <MemberRolesEditor
                    venueId={venueId}
                    userId={m.userId}
                    memberName={m.fullName}
                    currentRoles={m.roles}
                    callerIsAdmin={callerIsAdmin}
                  />
                  <RemoveMemberButton
                    venueId={venueId}
                    userId={m.userId}
                    memberName={m.fullName}
                    venueName={venueName}
                    disabledReason={
                      m.isLastAdmin
                        ? 'Dit is de laatste beheerder. Maak eerst iemand anders beheerder.'
                        : undefined
                    }
                  />
                  <p className="text-faint text-[11.5px]">
                    Het persoonlijk quotum stel je in bij Venue-instellingen.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </DCard>

      {invites.length > 0 && (
        <div>
          <Label className="mb-3">Openstaande uitnodigingen ({invites.length})</Label>
          <div className="flex flex-col gap-[10px]">
            {invites.map((iv) => (
              <DCard
                key={iv.id}
                className="flex items-center gap-[14px] border-dashed px-[18px] py-[14px]"
              >
                <span className="border-line bg-elev2 text-faint flex h-[38px] w-[38px] items-center justify-center rounded-[11px] border">
                  <Icon name="user" size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-text truncate text-[14px] font-semibold">{iv.email}</div>
                  <div className="text-faint text-[12px]">
                    {iv.roles.map((r) => ROLE_LABELS[r]).join(', ')} · verloopt{' '}
                    {new Date(iv.expiresAt).toLocaleDateString('nl-NL')}
                  </div>
                </div>
                <span className="border-line text-faint whitespace-nowrap rounded-[8px] border px-[11px] py-[5px] text-[11.5px] font-bold">
                  Wacht op acceptatie
                </span>
                {canManageInvites && <RevokeInviteButton inviteId={iv.id} />}
              </DCard>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
