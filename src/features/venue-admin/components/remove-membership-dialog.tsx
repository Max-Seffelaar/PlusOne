'use client';

import { useState } from 'react';
import { removeMembership } from '../actions';
import { cn } from '@/lib/utils';

interface RemoveMembershipDialogProps {
  membershipId: string;
  venueId: string;
  memberName: string;
  onDone: () => void;
}

export function RemoveMembershipDialog({
  membershipId,
  venueId,
  memberName,
  onDone,
}: RemoveMembershipDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setIsSubmitting(true);
    setError(null);

    const result = await removeMembership({
      venueId: venueId,
      membershipId: membershipId,
    });

    setIsSubmitting(false);

    if ('error' in result) {
      const errorMsg = Object.values(result.error).flat()[0];
      setError(typeof errorMsg === 'string' ? errorMsg : 'Er is een fout opgetreden');
    } else {
      onDone();
    }
  };

  return (
    <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 space-y-3">
      <div className="space-y-2">
        <p className="text-sm font-medium text-red-900">
          Zeker dat je {memberName} wilt verwijderen?
        </p>
        <p className="text-xs text-red-800">
          Deze persoon verliest de toegang tot <strong>alleen deze locatie</strong>. Hun account en
          toegang tot andere locaties blijven intact.
        </p>
      </div>

      {error && (
        <div className="p-2 rounded bg-red-100 text-red-900 text-xs">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleConfirm}
          disabled={isSubmitting}
          className={cn(
            'px-3 py-1 rounded text-xs font-medium',
            'bg-red-600 text-white hover:bg-red-700',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {isSubmitting ? 'Bezig...' : 'Verwijderen'}
        </button>
        <button
          onClick={onDone}
          disabled={isSubmitting}
          className="px-3 py-1 rounded text-xs font-medium text-dim hover:text-text"
        >
          Annuleren
        </button>
      </div>
    </div>
  );
}
