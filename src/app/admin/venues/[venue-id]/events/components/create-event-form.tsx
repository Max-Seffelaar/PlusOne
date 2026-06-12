'use client';

import { useState } from 'react';
import { createEvent } from '@/features/events/actions';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface Props {
  venueId: string;
}

export function CreateEventForm({ venueId }: Props) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    landing_slug: '',
    startTime: '',
    endTime: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast.error('Evenementnaam is verplicht');
      return;
    }

    if (!formData.startTime || !formData.endTime) {
      toast.error('Startdatum/tijd en einddatum/tijd zijn verplicht');
      return;
    }

    setIsSaving(true);
    try {
      const result = await createEvent({
        venueId,
        name: formData.name,
        landing_slug: formData.landing_slug || undefined,
        startTime: new Date(formData.startTime).toISOString(),
        endTime: new Date(formData.endTime).toISOString(),
      });

      if (result.error) {
        const errors = Object.values(result.error).flat();
        toast.error(errors[0] as string);
      } else {
        toast.success('Evenement aangemaakt');
        router.push(`/admin/venues/${venueId}/events/${(result.data as any)?.id}`);
      }
    } catch (error) {
      toast.error('Fout bij aanmaken');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="card max-w-2xl mx-auto">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="label">Naam *</label>
          <input
            type="text"
            className="field"
            placeholder="Zomerfestival 2026"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Startdatum/tijd *</label>
            <input
              type="datetime-local"
              className="field"
              value={formData.startTime}
              onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Einddatum/tijd *</label>
            <input
              type="datetime-local"
              className="field"
              value={formData.endTime}
              onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
            />
          </div>
        </div>

        <div>
          <label className="label">Landing slug (optioneel)</label>
          <input
            type="text"
            className="field"
            placeholder="zomerfestival-2026"
            value={formData.landing_slug}
            onChange={(e) => setFormData({ ...formData, landing_slug: e.target.value })}
          />
          <p className="text-xs text-dim mt-1">
            Alleen letters, cijfers en koppeltekens. Dit wordt de URL voor gasten om in te schrijven.
          </p>
        </div>

        <div className="bg-accent/5 border border-accent/20 rounded-lg p-4">
          <p className="text-xs text-accent font-medium mb-2">💡 VOLGENDE STAPPEN</p>
          <ul className="text-xs text-dim space-y-1">
            <li>1. Voeg minstens één laag toe (VIP, Regular, enz.)</li>
            <li>2. Wijs een organisator toe</li>
            <li>3. Activeer de landingpagina (optioneel)</li>
          </ul>
        </div>

        <div className="flex gap-2 pt-4">
          <button
            type="submit"
            disabled={isSaving}
            className="btn-primary flex-1"
          >
            {isSaving ? 'Aanmaken...' : 'Evenement aanmaken'}
          </button>
          <button
            type="button"
            onClick={() => window.history.back()}
            className="btn-secondary flex-1"
          >
            Annuleren
          </button>
        </div>
      </form>
    </div>
  );
}
