'use client';

import { useState } from 'react';
import { createGuestTier, updateGuestTier, deleteGuestTier } from '@/features/events/actions';
import { toast } from 'sonner';

interface TabProps {
  venueId: string;
  eventId: string;
  tiers: any[];
}

export function EventTiersTab({ venueId, eventId, tiers }: TabProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: '#B5A6FF',
    maxCount: '',
  });

  const handleReset = () => {
    setFormData({ name: '', description: '', color: '#B5A6FF', maxCount: '' });
    setEditingId(null);
    setShowForm(false);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('Laagnaam is verplicht');
      return;
    }

    setIsSaving(true);
    try {
      if (editingId) {
        const result = await updateGuestTier({
          id: editingId,
          eventId,
          name: formData.name,
          description: formData.description || undefined,
          color: formData.color || undefined,
          maxCount: formData.maxCount ? parseInt(formData.maxCount) : undefined,
        });

        if (result.error) {
          const errors = Object.values(result.error).flat();
          toast.error(errors[0] as string);
        } else {
          toast.success('Laag bijgewerkt');
          handleReset();
          window.location.reload();
        }
      } else {
        const result = await createGuestTier({
          eventId,
          name: formData.name,
          description: formData.description || undefined,
          color: formData.color || undefined,
          maxCount: formData.maxCount ? parseInt(formData.maxCount) : undefined,
        });

        if (result.error) {
          const errors = Object.values(result.error).flat();
          toast.error(errors[0] as string);
        } else {
          toast.success('Laag aangemaakt');
          handleReset();
          window.location.reload();
        }
      }
    } catch (error) {
      toast.error('Fout bij opslaan');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (tierId: string) => {
    if (!confirm('Weet je zeker dat je deze laag wilt verwijderen?')) return;

    try {
      const result = await deleteGuestTier({ id: tierId, eventId });

      if (result.error) {
        const errors = Object.values(result.error).flat();
        toast.error(errors[0] as string);
      } else {
        toast.success('Laag verwijderd');
        window.location.reload();
      }
    } catch (error) {
      toast.error('Fout bij verwijderen');
    }
  };

  const handleEdit = (tier: any) => {
    setFormData({
      name: tier.name,
      description: tier.description || '',
      color: tier.color || '#B5A6FF',
      maxCount: tier.max_count ? tier.max_count.toString() : '',
    });
    setEditingId(tier.id);
    setShowForm(true);
  };

  return (
    <div className="space-y-6">
      {tiers.length > 0 && (
        <div className="space-y-3">
          {tiers.map((tier) => (
            <div key={tier.id} className="card flex items-center justify-between">
              <div className="flex items-center gap-3 flex-1">
                <div
                  className="w-6 h-6 rounded border border-line"
                  style={{ backgroundColor: tier.color || '#B5A6FF' }}
                />
                <div className="flex-1">
                  <p className="font-medium text-text">{tier.name}</p>
                  {tier.description && (
                    <p className="text-sm text-dim">{tier.description}</p>
                  )}
                  {tier.max_count && (
                    <p className="text-xs text-dim mt-1">Max: {tier.max_count} gasten</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleEdit(tier)}
                  className="btn-secondary text-sm"
                >
                  Bewerken
                </button>
                <button
                  onClick={() => handleDelete(tier.id)}
                  className="btn-secondary text-sm text-faint hover:text-red-500"
                >
                  Verwijderen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="btn-primary w-full"
        >
          + Nieuwe laag
        </button>
      )}

      {showForm && (
        <div className="card space-y-4">
          <h3 className="font-medium text-text">
            {editingId ? 'Laag bewerken' : 'Nieuwe laag'}
          </h3>

          <div>
            <label className="label">Naam *</label>
            <input
              type="text"
              className="field"
              placeholder="VIP"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div>
            <label className="label">Beschrijving</label>
            <textarea
              className="field"
              placeholder="Fles champagne op tafel"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Kleur</label>
              <input
                type="color"
                className="w-full h-10 rounded border border-line cursor-pointer"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Max aantal gasten</label>
              <input
                type="number"
                className="field"
                placeholder="Onbeperkt"
                value={formData.maxCount}
                onChange={(e) => setFormData({ ...formData, maxCount: e.target.value })}
                min="1"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="btn-primary flex-1"
            >
              {isSaving ? 'Opslaan...' : 'Opslaan'}
            </button>
            <button
              onClick={handleReset}
              className="btn-secondary flex-1"
            >
              Annuleren
            </button>
          </div>
        </div>
      )}

      {tiers.length === 0 && !showForm && (
        <div className="card text-center py-8">
          <p className="text-dim mb-4">Geen lagen aangemaakt</p>
          <p className="text-sm text-dim">Voeg minstens één laag toe om gasten in te kunnen delen</p>
        </div>
      )}
    </div>
  );
}
