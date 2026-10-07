'use client';

/** Onboarding step 1 — create the venue (#40a). On success the caller becomes
 *  Admin and we advance to the plan step with the new venue id. The store-review
 *  demo account (86ey6bfug) gets the refusal instead of the form: the server
 *  action and the DB guard refuse it anyway, so a form would only fail on submit. */
import { type JSX, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { ConsentCheck, Field, Label, Btn, RefusedAction, press } from '@/components/po/kit';
import { createVenueAction } from '@/features/venues/actions';
import { VENUE_TYPES, type VenueType } from '@/features/venues/schemas';
import { WizardShell, WizardPanel } from '../WizardShell';

const vc = t.onboarding.venueCreate;
const TYPE_LABEL: Record<VenueType, string> = {
  club: vc.typeClub,
  festival: vc.typeFestival,
  bar: vc.typeBar,
  concertzaal: vc.typeConcert,
  venue: vc.typeVenue,
  organizer: vc.typeOrganizer,
};

// Longest offered option (settings/venue.tsx offers 6/12/24), stamped without
// asking — retention is not a decision to force on a fresh owner during
// onboarding (feedback Rik 2026-09-24). Adjustable any time in Venue settings.
const DEFAULT_RETENTION_MONTHS = 24;

export function VenueStep({
  onCreated,
  demoAccount = false,
}: {
  onCreated: (venueId: string) => void;
  demoAccount?: boolean;
}): JSX.Element {
  const router = useRouter();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [venueType, setVenueType] = useState<VenueType>('club');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ok = name.trim().length > 1 && agreed;

  function submit(): void {
    if (!ok || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await createVenueAction({
        name,
        address,
        venueType,
        retentionMonths: DEFAULT_RETENTION_MONTHS,
        termsAccepted: agreed,
      });
      if (res.ok) {
        onCreated(res.venueId);
      } else {
        setError(res.message);
      }
    });
  }

  const panel = (
    <WizardPanel
      title="Put your company on the map"
      sub="The base for every guest list and check-in you'll run."
      bullets={[
        'Add more companies later',
        'You can always change these details in settings',
      ]}
    />
  );

  if (demoAccount) {
    return (
      <WizardShell
        current={1}
        panel={panel}
        heading="Tell us about your company"
        sub="Guests see this on your landing pages and at check-in."
        footer={
          <Btn kind="primary" full icon="arrowR" onClick={() => router.push('/app')}>
            {t.onboarding.demo.backToApp}
          </Btn>
        }
      >
        <RefusedAction label={t.onboarding.venueCreate.submit} reason={t.auth.demoNoVenues} />
      </WizardShell>
    );
  }

  return (
    <WizardShell
      current={1}
      panel={panel}
      heading="Tell us about your company"
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
            {pending ? 'Working…' : 'Create company'}
          </Btn>
        </>
      }
    >
      <Label className="mb-2">Company name</Label>
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

      <Label className="mb-[10px]">Type</Label>
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

      <div className="mb-[18px] rounded-[16px] border border-line bg-elev p-4 text-[13px] leading-[1.5] text-dim">
        Guest data is kept for {DEFAULT_RETENTION_MONTHS} months, then anonymized automatically to
        “Guest #X” (#29). You can shorten this later in Company settings.
      </div>

      <ConsentCheck checked={agreed} onChange={setAgreed} copy={t.onboarding.venueCreate} className="mt-[18px]" />
    </WizardShell>
  );
}
