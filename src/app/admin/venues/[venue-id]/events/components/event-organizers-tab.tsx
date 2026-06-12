'use client';

import { useState } from 'react';
import { assignEventOrganizer, inviteEventOrganizer, removeEventOrganizer } from '@/features/events/actions';
import { toast } from 'sonner';

interface TabProps {
  venueId: string;
  eventId: string;
  organizers: any[];
  availableUsers: any[];
}

export function EventOrganizersTab({
  eventId,
  organizers,
  availableUsers,
}: TabProps) {
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState<'assign' | 'invite'>('assign');
  const [isSaving, setIsSaving] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');

  const organizerIds = new Set(organizers.map(o => o.user_id));
  const unassignedUsers = availableUsers.filter(m => !organizerIds.has(m.user_id));

  const handleAssign = async () => {
    if (!selectedUserId) {
      toast.error('Selecteer een gebruiker');
      return;
    }

    setIsSaving(true);
    try {
      const result = await assignEventOrganizer({
        eventId,
        userId: selectedUserId,
      });

      if (result.error) {
        const errors = Object.values(result.error).flat();
        toast.error(errors[0] as string);
      } else {
        toast.success('Organisator toegewezen');
        setSelectedUserId('');
        setShowForm(false);
        window.location.reload();
      }
    } catch (error) {
      toast.error('Fout bij toewijzing');
    } finally {
      setIsSaving(false);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail) {
      toast.error('Voer een e-mailadres in');
      return;
    }

    setIsSaving(true);
    try {
      const result = await inviteEventOrganizer({
        eventId,
        email: inviteEmail,
      });

      if (result.error) {
        const errors = Object.values(result.error).flat();
        toast.error(errors[0] as string);
      } else {
        toast.success((result as any).message || 'Uitnodiging verzonden');
        setInviteEmail('');
        setShowForm(false);
      }
    } catch (error) {
      toast.error('Fout bij uitnodiging');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async (userId: string) => {
    if (!confirm('Weet je zeker dat je deze organisator wilt verwijderen?')) return;

    try {
      const result = await removeEventOrganizer({
        eventId,
        userId,
      });

      if (result.error) {
        const errors = Object.values(result.error).flat();
        toast.error(errors[0] as string);
      } else {
        toast.success('Organisator verwijderd');
        window.location.reload();
      }
    } catch (error) {
      toast.error('Fout bij verwijdering');
    }
  };

  return (
    <div className="space-y-6">
      {organizers.length > 0 && (
        <div className="space-y-3">
          {organizers.map((org) => (
            <div key={org.id} className="card flex items-center justify-between">
              <div>
                <p className="font-medium text-text">{org.users?.display_name || 'Onbekend'}</p>
                <p className="text-sm text-dim">{org.users?.email}</p>
              </div>
              <button
                onClick={() => handleRemove(org.user_id)}
                className="btn-secondary text-sm text-faint hover:text-red-500"
              >
                Verwijderen
              </button>
            </div>
          ))}
        </div>
      )}

      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="btn-primary w-full"
        >
          + Organisator toevoegen
        </button>
      )}

      {showForm && (
        <div className="card space-y-4">
          <h3 className="font-medium text-text">Organisator toevoegen</h3>

          {/* Mode Tabs */}
          <div className="flex gap-2 border-b border-line pb-4">
            <button
              onClick={() => setMode('assign')}
              className={`px-3 py-1 text-sm font-medium transition-colors ${
                mode === 'assign'
                  ? 'text-accent border-b-2 border-accent -mb-4 pb-4'
                  : 'text-dim hover:text-text'
              }`}
            >
              Bestaande user
            </button>
            <button
              onClick={() => setMode('invite')}
              className={`px-3 py-1 text-sm font-medium transition-colors ${
                mode === 'invite'
                  ? 'text-accent border-b-2 border-accent -mb-4 pb-4'
                  : 'text-dim hover:text-text'
              }`}
            >
              Uitnodiging versturen
            </button>
          </div>

          {mode === 'assign' ? (
            <>
              <div>
                <label className="label">Selecteer gebruiker</label>
                {unassignedUsers.length === 0 ? (
                  <p className="text-sm text-dim">Alle leden zijn al organisators</p>
                ) : (
                  <select
                    className="field"
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                  >
                    <option value="">-- Selecteer --</option>
                    {unassignedUsers.map((user) => (
                      <option key={user.user_id} value={user.user_id}>
                        {user.users?.display_name || user.users?.email}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="flex gap-2 pt-4">
                <button
                  onClick={handleAssign}
                  disabled={isSaving || !selectedUserId}
                  className="btn-primary flex-1"
                >
                  {isSaving ? 'Toewijzen...' : 'Toewijzen'}
                </button>
                <button
                  onClick={() => {
                    setShowForm(false);
                    setSelectedUserId('');
                  }}
                  className="btn-secondary flex-1"
                >
                  Annuleren
                </button>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="label">E-mailadres</label>
                <input
                  type="email"
                  className="field"
                  placeholder="jan@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div className="flex gap-2 pt-4">
                <button
                  onClick={handleInvite}
                  disabled={isSaving || !inviteEmail}
                  className="btn-primary flex-1"
                >
                  {isSaving ? 'Versturen...' : 'Uitnodiging versturen'}
                </button>
                <button
                  onClick={() => {
                    setShowForm(false);
                    setInviteEmail('');
                  }}
                  className="btn-secondary flex-1"
                >
                  Annuleren
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {organizers.length === 0 && !showForm && (
        <div className="card text-center py-8">
          <p className="text-dim mb-4">Geen organisators aangemaakt</p>
          <p className="text-sm text-dim">Voeg minstens één organisator toe om het evenement te beheren</p>
        </div>
      )}
    </div>
  );
}
