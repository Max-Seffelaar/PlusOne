'use client';

import { useState } from 'react';
import { Database } from '@/lib/database.types';
import { InviteUserForm } from './invite-user-form';
import { RoleEditor } from './role-editor';
import { RemoveMembershipDialog } from './remove-membership-dialog';

type VenueMembership = Database['public']['Tables']['venue_memberships']['Row'] & {
  users?: { id: string; email: string; display_name: string | null } | null;
};

type Quota = Database['public']['Tables']['quotas']['Row'];

interface MemberListProps {
  venueId: string;
  memberships: VenueMembership[];
  quotas: Quota[];
  currentUserId: string;
  isAdmin: boolean;
  isUserManager: boolean;
  isFinance: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  user_manager: 'Gebruikersbeheerder',
  finance: 'Finance',
  staff: 'Personeel',
  doorhost: 'Deuropener',
};

export function MemberList({
  venueId,
  memberships,
  quotas,
  currentUserId,
  isAdmin,
  isUserManager,
  isFinance,
}: MemberListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const canManage = isAdmin || isUserManager;

  return (
    <div className="space-y-6">
      {canManage && <InviteUserForm venueId={venueId} />}

      <div className="rounded-lg border border-border overflow-hidden">
        <div className="bg-bg-secondary border-b border-border p-4">
          <h3 className="text-sm font-medium">Teamleden ({memberships.length})</h3>
        </div>

        {memberships.length === 0 ? (
          <div className="p-8 text-center text-sm text-dim">
            Nog geen teamleden. Voeg er één toe om te beginnen.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {memberships.map((member) => {
              const quota = quotas.find((q) => q.user_id === member.user_id);
              const isCurrentUser = member.user_id === currentUserId;
              const isEditing = editingId === member.id;
              const isRemoving = removingId === member.id;

              return (
                <div key={member.id} className="p-4" data-testid="member-item">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-text break-all">
                        {member.users?.display_name || member.users?.email || 'Onbekend'}
                      </p>
                      <p className="text-xs text-dim mt-0.5 break-all">{member.users?.email}</p>

                      {isEditing ? (
                        <RoleEditor
                          membershipId={member.id}
                          venueId={venueId}
                          currentRoles={member.roles}
                          onDone={() => setEditingId(null)}
                          isAdmin={isAdmin}
                        />
                      ) : (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {member.roles.map((role) => (
                            <span
                              key={role}
                              className="inline-block px-2 py-1 rounded text-xs font-medium bg-accent/10 text-accent"
                            >
                              {ROLE_LABELS[role] || role}
                            </span>
                          ))}
                        </div>
                      )}

                      {quota && (
                        <p className="text-xs text-dim mt-2">
                          Quotum: <span className="font-medium">{quota.default_count}</span>
                        </p>
                      )}
                    </div>

                    {canManage && !isEditing && !isRemoving && (
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={() => setEditingId(member.id)}
                          className="text-xs text-accent hover:underline"
                        >
                          Rollen
                        </button>
                        {!isCurrentUser && (
                          <button
                            onClick={() => setRemovingId(member.id)}
                            className="text-xs text-red-600 hover:underline"
                          >
                            Verwijderen
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {isRemoving && (
                    <RemoveMembershipDialog
                      membershipId={member.id}
                      venueId={venueId}
                      memberName={member.users?.display_name || member.users?.email || 'deze persoon'}
                      onDone={() => setRemovingId(null)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isFinance && !isAdmin && !isUserManager && (
        <div className="p-4 rounded-lg bg-bg-secondary border border-border text-xs text-dim">
          Je bent lid van deze venue als Finance. Dit scherm is read-only voor je rol.
        </div>
      )}
    </div>
  );
}
