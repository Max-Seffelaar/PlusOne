'use client';

import { useState } from 'react';
import { updateVenueSettings } from '../actions';
import { cn } from '@/lib/utils';
import { Database } from '@/lib/database.types';

type Venue = Database['public']['Tables']['venues']['Row'];

interface VenueSettingsProps {
  venue: Venue;
  isAdmin: boolean;
}

export function VenueSettings({ venue, isAdmin }: VenueSettingsProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(venue.name);
  const [retentionMonths, setRetentionMonths] = useState(
    venue.retention_days ? Math.round(venue.retention_days / 30) : '',
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(false);

    const retention = retentionMonths ? parseInt(String(retentionMonths), 10) : null;
    const result = await updateVenueSettings({
      venueId: venue.id,
      name,
      retentionMonths: retention,
    });

    setIsSaving(false);

    if ('error' in result) {
      setError(Object.values(result.error).flat()[0] || 'Er is een fout opgetreden');
    } else {
      setSuccess(true);
      setIsEditing(false);
      setTimeout(() => setSuccess(false), 3000);
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-4 rounded-lg bg-bg-secondary border border-border">
        <h3 className="text-sm font-medium text-dim">Instellingen</h3>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-dim">Naam</dt>
            <dd className="font-medium text-text">{venue.name}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-dim">AVG-bewaartermijn</dt>
            <dd className="font-medium text-text">
              {venue.retention_days ? Math.round(venue.retention_days / 30) : '–'} maanden
            </dd>
          </div>
        </dl>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-lg bg-bg-secondary border border-border">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-sm font-medium">Instellingen</h3>
        <button
          onClick={() => {
            if (isEditing) {
              setName(venue.name);
              setRetentionMonths(venue.retention_days ? Math.round(venue.retention_days / 30) : '');
            }
            setIsEditing(!isEditing);
          }}
          className="text-xs text-accent hover:underline"
        >
          {isEditing ? 'Annuleren' : 'Bewerken'}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-2 rounded bg-red-100 text-red-900 text-xs">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-2 rounded bg-green-100 text-green-900 text-xs">
          Instellingen opgeslagen
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-dim mb-1">Naam</label>
          {isEditing ? (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={cn(
                'w-full px-3 py-2 rounded-lg border border-border',
                'bg-bg text-text text-sm',
                'focus:outline-none focus:ring-2 focus:ring-accent/50',
              )}
            />
          ) : (
            <p className="text-sm text-text">{venue.name}</p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-dim mb-1">
            AVG-bewaartermijn (maanden)
          </label>
          {isEditing ? (
            <input
              type="number"
              min="1"
              max="60"
              value={retentionMonths}
              onChange={(e) => setRetentionMonths(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
              className={cn(
                'w-full px-3 py-2 rounded-lg border border-border',
                'bg-bg text-text text-sm',
                'focus:outline-none focus:ring-2 focus:ring-accent/50',
              )}
            />
          ) : (
            <p className="text-sm text-text">
              {venue.retention_days ? Math.round(venue.retention_days / 30) : '–'}
            </p>
          )}
        </div>

        {isEditing && (
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium',
                'bg-accent text-bg hover:bg-accent-dark',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {isSaving ? 'Bezig met opslaan...' : 'Opslaan'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
