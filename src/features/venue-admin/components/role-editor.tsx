'use client';

import { useState } from 'react';
import { updateUserRoles } from '../actions';
import { cn } from '@/lib/utils';

interface RoleEditorProps {
  membershipId: string;
  venueId: string;
  currentRoles: string[];
  onDone: () => void;
  isAdmin: boolean;
}

const ROLES = [
  { id: 'admin', label: 'Admin', description: 'Volledige controle' },
  { id: 'user_manager', label: 'Gebruikersbeheerder', description: 'Leden beheren' },
  { id: 'finance', label: 'Finance', description: 'Read-only inzage' },
  { id: 'staff', label: 'Personeel', description: 'Gasten toevoegen' },
  { id: 'doorhost', label: 'Deuropener', description: 'Inchecken & weigeren' },
];

export function RoleEditor({
  membershipId,
  venueId,
  currentRoles,
  onDone,
  isAdmin,
}: RoleEditorProps) {
  const [selectedRoles, setSelectedRoles] = useState<string[]>(currentRoles);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isAdmin) {
    return (
      <div className="mt-2 text-xs text-dim">
        Alleen admins kunnen rollen wijzigen.
      </div>
    );
  }

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);

    const result = await updateUserRoles({
      venueId: venueId,
      membershipId: membershipId,
      roles: selectedRoles as any,
    });

    setIsSubmitting(false);

    if ('error' in result) {
      const errorMsg = Object.values(result.error).flat()[0];
      setError(typeof errorMsg === 'string' ? errorMsg : 'Er is een fout opgetreden');
    } else {
      onDone();
    }
  };

  const toggleRole = (roleId: string) => {
    setSelectedRoles((prev) =>
      prev.includes(roleId) ? prev.filter((r) => r !== roleId) : [...prev, roleId],
    );
  };

  return (
    <div className="mt-3 p-3 rounded-lg bg-bg border border-border space-y-3">
      {error && (
        <div className="p-2 rounded bg-red-100 text-red-900 text-xs">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {ROLES.map((role) => (
          <label key={role.id} className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedRoles.includes(role.id)}
              onChange={() => toggleRole(role.id)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <p className="text-xs font-medium text-text">{role.label}</p>
              <p className="text-xs text-dim">{role.description}</p>
            </div>
          </label>
        ))}
      </div>

      {selectedRoles.length === 0 && (
        <p className="text-xs text-red-600">Selecteer minstens één rol</p>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={isSubmitting || selectedRoles.length === 0}
          className={cn(
            'px-3 py-1 rounded text-xs font-medium',
            'bg-accent text-bg hover:bg-accent-dark',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {isSubmitting ? 'Bezig...' : 'Opslaan'}
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
