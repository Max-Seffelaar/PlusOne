'use client';

/** Onboarding step 1 — create the venue (#40a). On success the caller becomes
 *  Admin and we advance to the plan step with the new venue id. */
import { useState, useTransition } from 'react';
import { cn } from '@/lib/utils';
import { Field, Label } from '@/components/po/kit';
import { Btn } from '@/components/po/kit';
import { createVenueAction } from '@/features/venues/actions';
import { VENUE_TYPES, type VenueType } from '@/features/venues/schemas';
import { WizardShell, WizardPanel } from '../WizardShell';

const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';

const TYPE_LABEL: Record<VenueType, string> = {
  club: 'Club',
  festival: 'Festival',
  bar: 'Bar',
  concertzaal: 'Concert hall',
};

const RETENTION_OPTIONS = [6, 12, 24] as const;

export function VenueStep({ onCreated }: { onCreated: (venueId: string) => void }): JSX.Element {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [venueType, setVenueType] = useState<VenueType>('club');
  const [retention, setRetention] = useState(12);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ok = name.trim().length > 1;

  function submit(): void {
    if (!ok || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await createVenueAction({ name, address, venueType, retentionMonths: retention });
      if (res.ok) {
        onCreated(res.venueId);
      } else {
        setError(res.message);
      }
    });
  }

  return (
    <WizardShell
      current={1}
      panel={
        <WizardPanel
          title="Put your venue on the map"
          sub="The base for every guest list and check-in you'll run."
          bullets={[
            'Add more venues later',
            'You can always change these details in settings',
          ]}
        />
      }
      heading="Tell us about your venue"
      sub="Guests see this on your landing pages and at check-in."
      footer={
        <>
          {error && <div className="mb-3 text-[13.5px] text-[#ff9b9b]">{error}</div>}
          <Btn
            kind="primary"
            full
            icon="check"
            onClick={submit}
            disabled={!ok || pending}
            className={ok ? '' : 'opacity-[0.45]'}
          >
            {pending ? 'Working…' : 'Create venue'}
          </Btn>
        </>
      }
    >
      <Label className="mb-2">Venue name</Label>
      <Field
        icon="building"
        placeholder="e.g. LOFI"
        value={name}
        onChange={setName}
        autoFocus
        className="mb-[14px]"
      />

      <Label className="mb-2">Address</Label>
      <Field
        icon="pin"
        placeholder="Wibautstraat 150, Amsterdam"
        value={address}
        onChange={setAddress}
        className="mb-[18px]"
      />

      <Label className="mb-[10px]">Venue type</Label>
      <div className="mb-[18px] grid grid-cols-2 gap-[8px]">
        {VENUE_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setVenueType(t)}
            className={cn(
              'rounded-[12px] border py-[12px] font-display text-[14px] font-bold',
              press,
              venueType === t
                ? 'border-transparent bg-acc text-on-acc'
                : 'border-line bg-elev2 text-dim'
            )}
          >
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      <Label className="mb-[10px]">Data retention</Label>
      <div className="rounded-[16px] border border-line bg-elev p-4">
        <div className="mb-[14px] text-[13px] leading-[1.5] text-dim">
          After this period, guest data is anonymized automatically to “Guest #X” (#29). Default 12
          months.
        </div>
        <div className="flex gap-[8px]">
          {RETENTION_OPTIONS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setRetention(m)}
              className={cn(
                'flex-1 rounded-[11px] border py-[11px] font-display text-[14px] font-bold',
                press,
                retention === m
                  ? 'border-transparent bg-acc text-on-acc'
                  : 'border-line bg-elev2 text-dim'
              )}
            >
              {m} mo
            </button>
          ))}
        </div>
      </div>
    </WizardShell>
  );
}
