'use client';

import { useState } from 'react';
import { inviteUser } from '../actions';
import { cn } from '@/lib/utils';

interface InviteUserFormProps {
  venueId: string;
}

const ROLES = [
  { id: 'admin', label: 'Admin', description: 'Volledige controle over deze locatie' },
  { id: 'user_manager', label: 'Gebruikersbeheerder', description: 'Kan leden uitnodigen en rollen beheren' },
  { id: 'finance', label: 'Finance', description: 'Read-only inzage gastenlijsten en rapporten' },
  { id: 'staff', label: 'Personeel', description: 'Kan gasten toevoegen binnen quotum' },
  { id: 'doorhost', label: 'Deuropener', description: 'Kan inchecken en gasten weigeren' },
];

export function InviteUserForm({ venueId }: InviteUserFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setSuccess(false);

    const result = await inviteUser({
      venueId: venueId,
      email: email,
      roles: selectedRoles as any,
    });

    setIsSubmitting(false);

    if ('error' in result) {
      const errorMsg = Object.values(result.error).flat()[0];
      setError(typeof errorMsg === 'string' ? errorMsg : 'Er is een fout opgetreden');
    } else {
      setSuccess(true);
      setEmail('');
      setSelectedRoles([]);
      setTimeout(() => {
        setSuccess(false);
        setIsOpen(false);
      }, 2000);
    }
  };

  const toggleRole = (roleId: string) => {
    setSelectedRoles((prev) =>
      prev.includes(roleId) ? prev.filter((r) => r !== roleId) : [...prev, roleId],
    );
  };

  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-sm font-medium">Teamlid toevoegen</h3>
        <button
          onClick={() => {
            setIsOpen(!isOpen);
            setError(null);
            setSuccess(false);
          }}
          className="text-xs text-accent hover:underline"
        >
          {isOpen ? 'Annuleren' : 'Uitnodigen'}
        </button>
      </div>

      {isOpen && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-2 rounded bg-red-100 text-red-900 text-xs">
              {error}
            </div>
          )}

          {success && (
            <div className="p-2 rounded bg-green-100 text-green-900 text-xs">
              Teamlid uitgenodigd. Deze fase 4 stuurt via Supabase Auth OTP.
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-dim mb-1">E-mailadres</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="naam@example.com"
              required
              className={cn(
                'w-full px-3 py-2 rounded-lg border border-border',
                'bg-bg text-text text-sm',
                'focus:outline-none focus:ring-2 focus:ring-accent/50',
              )}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-dim mb-2">Rollen</label>
            <div className="space-y-2">
              {ROLES.map((role) => (
                <label key={role.id} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedRoles.includes(role.id)}
                    onChange={() => toggleRole(role.id)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-text">{role.label}</p>
                    <p className="text-xs text-dim">{role.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={isSubmitting || !email || selectedRoles.length === 0}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium',
                'bg-accent text-bg hover:bg-accent-dark',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {isSubmitting ? 'Bezig met uitnodigen...' : 'Uitnodigen'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
