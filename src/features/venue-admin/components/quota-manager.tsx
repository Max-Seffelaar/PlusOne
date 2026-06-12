'use client';

import { useState } from 'react';
import { setDefaultQuota } from '../actions';
import { cn } from '@/lib/utils';
import { Database } from '@/lib/database.types';

type VenueMembership = Database['public']['Tables']['venue_memberships']['Row'] & {
  users?: { id: string; email: string; display_name: string | null } | null;
};

type Quota = Database['public']['Tables']['quotas']['Row'];

interface QuotaManagerProps {
  venueId: string;
  memberships: VenueMembership[];
  quotas: Quota[];
  isAdmin: boolean;
}

export function QuotaManager({
  venueId,
  memberships,
  quotas,
  isAdmin,
}: QuotaManagerProps) {
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [quotaValue, setQuotaValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!isAdmin) {
    return null;
  }

  const handleSaveQuota = async (userId: string) => {
    if (!quotaValue) {
      setError('Voer een quotumwaarde in');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    const result = await setDefaultQuota({
      venueId: venueId,
      userId: userId,
      quotaAmount: parseInt(quotaValue, 10),
    });

    setIsSubmitting(false);

    if ('error' in result) {
      const errorMsg = Object.values(result.error).flat()[0];
      setError(typeof errorMsg === 'string' ? errorMsg : 'Er is een fout opgetreden');
    } else {
      setSuccess(`Quotum voor ${memberships.find((m) => m.user_id === userId)?.users?.display_name || 'gebruiker'} ingesteld`);
      setEditingUserId(null);
      setQuotaValue('');
      setTimeout(() => setSuccess(null), 3000);
    }
  };

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="bg-bg-secondary border-b border-border p-4">
        <h3 className="text-sm font-medium">Quotum per persoon</h3>
        <p className="text-xs text-dim mt-1">
          Standaardaantal gasten dat elk teamlid per evenement mag toevoegen
        </p>
      </div>

      {error && (
        <div className="m-4 p-2 rounded bg-red-100 text-red-900 text-xs">
          {error}
        </div>
      )}

      {success && (
        <div className="m-4 p-2 rounded bg-green-100 text-green-900 text-xs">
          {success}
        </div>
      )}

      <div className="divide-y divide-border">
        {memberships.map((member) => {
          const quota = quotas.find((q) => q.user_id === member.user_id);
          const isEditing = editingUserId === member.user_id;

          return (
            <div key={member.id} className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-text">
                    {member.users?.display_name || member.users?.email || 'Onbekend'}
                  </p>
                  <p className="text-xs text-dim">{member.users?.email}</p>
                </div>

                {isEditing ? (
                  <div className="flex gap-2 items-center">
                    <input
                      type="number"
                      min="0"
                      value={quotaValue}
                      onChange={(e) => setQuotaValue(e.target.value)}
                      className={cn(
                        'w-20 px-2 py-1 rounded border border-border',
                        'bg-bg text-text text-sm text-center',
                        'focus:outline-none focus:ring-2 focus:ring-accent/50',
                      )}
                      autoFocus
                    />
                    <button
                      onClick={() => handleSaveQuota(member.user_id)}
                      disabled={isSubmitting}
                      className={cn(
                        'px-2 py-1 rounded text-xs font-medium',
                        'bg-accent text-bg hover:bg-accent-dark',
                        'disabled:opacity-50 disabled:cursor-not-allowed',
                      )}
                    >
                      Opslaan
                    </button>
                    <button
                      onClick={() => {
                        setEditingUserId(null);
                        setQuotaValue('');
                        setError(null);
                      }}
                      className="px-2 py-1 rounded text-xs font-medium text-dim hover:text-text"
                    >
                      Annuleren
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-medium text-text">
                        {quota?.default_count ?? '–'}
                      </p>
                      <p className="text-xs text-dim">gasten</p>
                    </div>
                    <button
                      onClick={() => {
                        setEditingUserId(member.user_id);
                        setQuotaValue(quota?.default_count?.toString() || '');
                      }}
                      className="text-xs text-accent hover:underline"
                    >
                      Wijzigen
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
