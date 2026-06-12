'use client';

import { useState } from 'react';
import { setLandingActive } from '@/features/events/actions';
import { toast } from 'sonner';

interface TabProps {
  venueId: string;
  event: any;
}

export function EventLandingTab({ venueId, event }: TabProps) {
  const [isSaving, setIsSaving] = useState(false);

  const handleToggle = async () => {
    setIsSaving(true);
    try {
      const result = await setLandingActive({
        id: event.id,
        venueId,
        active: !event.landing_active,
      });

      if (result.error) {
        const errors = Object.values(result.error).flat();
        toast.error(errors[0] as string);
      } else {
        toast.success(
          event.landing_active ? 'Landingpagina uitgeschakeld' : 'Landingpagina ingeschakeld'
        );
        window.location.reload();
      }
    } catch (error) {
      toast.error('Fout bij wijziging');
    } finally {
      setIsSaving(false);
    }
  };

  const landingUrl = event.landing_slug
    ? `${process.env.NEXT_PUBLIC_APP_URL}/events/${event.landing_slug}`
    : null;

  return (
    <div className="space-y-6">
      <div className="card">
        <h2 className="font-medium text-text mb-4">Landingpagina</h2>

        {!event.landing_slug ? (
          <div className="bg-faint/10 border border-faint/20 rounded-lg p-4">
            <p className="text-sm text-dim">
              Je moet eerst een landing slug instellen op het tabblad "Instellingen" voordat je de landingpagina kunt activeren.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-elev rounded-lg p-4 space-y-3">
              <div>
                <p className="text-xs text-dim mb-1">LANDINGPAGINA URL</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    className="field flex-1 bg-bg text-xs"
                    value={landingUrl || ''}
                  />
                  <button
                    onClick={() => {
                      if (landingUrl) navigator.clipboard.writeText(landingUrl);
                      toast.success('URL gekopieerd');
                    }}
                    className="btn-secondary text-sm whitespace-nowrap"
                  >
                    Kopiëren
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs text-dim mb-2">STATUS</p>
                <div className="flex items-center justify-between bg-bg rounded p-3 border border-line">
                  <div>
                    <p className="font-medium text-text">
                      {event.landing_active ? '✓ Actief' : '○ Inactief'}
                    </p>
                    <p className="text-xs text-dim">
                      {event.landing_active
                        ? 'Gasten kunnen aanvragen indienen via je landingpagina'
                        : 'Landingpagina is uitgeschakeld'}
                    </p>
                  </div>
                  <button
                    onClick={handleToggle}
                    disabled={isSaving}
                    className={`btn-secondary text-sm ${event.landing_active ? 'text-faint' : 'text-accent'}`}
                  >
                    {isSaving ? '...' : event.landing_active ? 'Uitschakelen' : 'Inschakelen'}
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-accent/5 border border-accent/20 rounded-lg p-4">
              <p className="text-xs text-accent font-medium mb-2">💡 TIP</p>
              <ul className="text-xs text-dim space-y-1">
                <li>• Deel deze link direct met je gasten of zet hem op je website</li>
                <li>• De link werkt offline-first — gasten vullen hun gegevens in en sync automatisch</li>
                <li>• Je kunt de link op elk moment uitschakelen zonder het evenement te sluiten</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
