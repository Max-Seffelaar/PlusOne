'use client';

import { useState } from 'react';
import { updateEvent } from '@/features/events/actions';
import { formatDate, formatTime } from '@/lib/utils';
import { toast } from 'sonner';

interface TabProps {
  venueId: string;
  event: any;
}

export function EventGeneralTab({ venueId, event }: TabProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: event.name,
    landing_slug: event.landing_slug || '',
    startTime: event.start_time ? new Date(event.start_time).toISOString() : '',
    endTime: event.end_time ? new Date(event.end_time).toISOString() : '',
    status: event.status,
  });

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const result = await updateEvent({
        id: event.id,
        venueId,
        name: formData.name,
        landing_slug: formData.landing_slug || undefined,
        startTime: formData.startTime,
        endTime: formData.endTime,
        status: formData.status as any,
      });

      if (result.error) {
        const errors = Object.values(result.error).flat();
        toast.error(errors[0] as string);
      } else {
        toast.success('Evenement bijgewerkt');
        setIsEditing(false);
        window.location.reload();
      }
    } catch (error) {
      toast.error('Fout bij opslaan');
    } finally {
      setIsSaving(false);
    }
  };

  const statusOptions = [
    { value: 'draft', label: 'Concept', next: ['open'] },
    { value: 'open', label: 'Open', next: ['live'] },
    { value: 'live', label: 'Live', next: ['closed'] },
    { value: 'closed', label: 'Gesloten', next: [] },
  ];

  const currentStatus = statusOptions.find(s => s.value === formData.status);
  const validNextStatuses = currentStatus?.next || [];

  return (
    <div className="space-y-6">
      {!isEditing ? (
        // View Mode
        <div className="space-y-4">
          <div className="card">
            <div className="flex justify-between items-start mb-4">
              <h2 className="font-medium text-text">Basisgegevens</h2>
              <button
                onClick={() => setIsEditing(true)}
                className="btn-secondary text-sm"
              >
                Bewerken
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <p className="text-dim">Naam</p>
                <p className="text-text font-medium">{event.name}</p>
              </div>
              <div>
                <p className="text-dim">Status</p>
                <p className="text-text font-medium">
                  {statusOptions.find(s => s.value === event.status)?.label}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-dim">Startdatum/tijd</p>
                  <p className="text-text font-medium">
                    {formatDate(event.start_time)} {formatTime(event.start_time)}
                  </p>
                </div>
                <div>
                  <p className="text-dim">Einddatum/tijd</p>
                  <p className="text-text font-medium">
                    {formatDate(event.end_time)} {formatTime(event.end_time)}
                  </p>
                </div>
              </div>
              {event.landing_slug && (
                <div>
                  <p className="text-dim">Landing slug</p>
                  <p className="text-text font-medium font-mono text-xs">{event.landing_slug}</p>
                </div>
              )}
            </div>
          </div>

          {event.status === 'live' && (
            <div className="card bg-accent/5 border border-accent/20">
              <p className="text-sm text-accent">
                ℹ️ Dit evenement is live. Gastentoevoegingen zijn beperkt door de vergrendeling.
              </p>
            </div>
          )}
        </div>
      ) : (
        // Edit Mode
        <div className="card space-y-4">
          <div>
            <label className="label">Naam</label>
            <input
              type="text"
              className="field"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Startdatum/tijd</label>
              <input
                type="datetime-local"
                className="field"
                value={new Date(formData.startTime).toISOString().slice(0, 16)}
                onChange={(e) => setFormData({
                  ...formData,
                  startTime: new Date(e.target.value).toISOString(),
                })}
              />
            </div>
            <div>
              <label className="label">Einddatum/tijd</label>
              <input
                type="datetime-local"
                className="field"
                value={new Date(formData.endTime).toISOString().slice(0, 16)}
                onChange={(e) => setFormData({
                  ...formData,
                  endTime: new Date(e.target.value).toISOString(),
                })}
              />
            </div>
          </div>

          <div>
            <label className="label">Landing slug (optioneel)</label>
            <input
              type="text"
              className="field"
              placeholder="zomer-party-2026"
              value={formData.landing_slug}
              onChange={(e) => setFormData({ ...formData, landing_slug: e.target.value })}
            />
            <p className="text-xs text-dim mt-1">
              Alleen letters, cijfers en koppeltekens. Dit wordt de URL voor je landingpagina.
            </p>
          </div>

          {validNextStatuses.length > 0 && (
            <div>
              <label className="label">Status</label>
              <select
                className="field"
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              >
                <option value={event.status}>
                  {statusOptions.find(s => s.value === event.status)?.label}
                </option>
                {validNextStatuses.map((status) => (
                  <option key={status} value={status}>
                    {statusOptions.find(s => s.value === status)?.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex gap-2 pt-4">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="btn-primary"
            >
              {isSaving ? 'Opslaan...' : 'Opslaan'}
            </button>
            <button
              onClick={() => {
                setIsEditing(false);
                setFormData({
                  name: event.name,
                  landing_slug: event.landing_slug || '',
                  startTime: event.start_time,
                  endTime: event.end_time,
                  status: event.status,
                });
              }}
              className="btn-secondary"
            >
              Annuleren
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
