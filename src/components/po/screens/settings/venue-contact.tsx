'use client';

// Guest contact card in Company settings (Gastcommunicatie F, z8uq9m2vpy).
// Its own file and its own save button: the venue settings form and task 3b's
// location work stay untouched. Admins edit; everyone who may view the company
// settings sees the values read-only.

import { type JSX, useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import {
  usePoCompanyContact,
  usePoUpdateCompanyContact,
  type PoCompanyContact,
} from '@/features/po/company-contact';
import { CONTACT_CHANNELS, type ContactChannel } from '@/features/venues/contact-schema';
import { Btn, Field, Label, Note, ToggleRow } from '../../kit';
import { FormError } from './_shared';

const CHANNEL_ICON: Record<ContactChannel, 'phone' | 'link'> = {
  phone: 'phone',
  instagram: 'link',
  facebook: 'link',
  snapchat: 'link',
  tiktok: 'link',
};

const EMPTY: PoCompanyContact = {
  contactEmail: '',
  channels: { phone: '', instagram: '', facebook: '', snapchat: '', tiktok: '' },
  guestConfirmationDefault: true,
};

export function GuestContactCard({ canEdit }: { canEdit: boolean }): JSX.Element | null {
  const q = usePoCompanyContact();
  const save = usePoUpdateCompanyContact();
  const [form, setForm] = useState<PoCompanyContact>(EMPTY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (q.data && !loaded) {
      setForm(q.data);
      setLoaded(true);
    }
  }, [q.data, loaded]);

  if (!q.data && !loaded) return null;
  const c = t.settings.contact;
  const saved = q.data ?? EMPTY;
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const missing = saved.contactEmail === '';

  return (
    <section data-testid="guest-contact" className="mb-[18px]">
      <Label className="mb-[10px]">{c.title}</Label>
      {missing ? <Note icon="mail">{c.emailMissing}</Note> : null}
      <p className="mb-[14px] text-[13.5px] leading-[1.5] text-dim">{c.intro}</p>

      <Label className="mb-2">{c.emailLabel}</Label>
      <Field
        icon="mail"
        type="email"
        inputMode="email"
        value={form.contactEmail}
        onChange={canEdit ? (v) => setForm((f) => ({ ...f, contactEmail: v })) : undefined}
        placeholder={c.emailPlaceholder}
        ariaLabel={c.emailLabel}
        className="mb-[14px]"
      />

      <Label className="mb-1">{c.channelsLabel}</Label>
      <p className="mb-2 text-[12px] leading-[1.4] text-faint">{c.channelsHint}</p>
      {CONTACT_CHANNELS.map((key) => (
        <Field
          key={key}
          icon={CHANNEL_ICON[key]}
          value={form.channels[key]}
          onChange={
            canEdit ? (v) => setForm((f) => ({ ...f, channels: { ...f.channels, [key]: v } })) : undefined
          }
          placeholder={c[key]}
          ariaLabel={c[key]}
          maxLength={100}
          className="mb-2"
        />
      ))}

      <div className="mb-[14px] mt-[10px] rounded-[18px] border border-line bg-elev px-4 py-1">
        <ToggleRow
          title={c.confirmationDefault}
          sub={c.confirmationDefaultHint}
          on={form.guestConfirmationDefault}
          set={(v) => canEdit && setForm((f) => ({ ...f, guestConfirmationDefault: v }))}
          last
        />
      </div>

      <FormError error={save.isError ? save.error : null} />
      {save.isSuccess && !dirty ? <p className="mb-2 text-[12.5px] text-acc-soft">{c.saved}</p> : null}
      {canEdit ? (
        <Btn
          kind="dark"
          full
          icon="check"
          disabled={!dirty || save.isPending}
          className={dirty ? '' : 'opacity-[0.45]'}
          onClick={() => save.mutate(form)}
        >
          {save.isPending ? c.saving : c.save}
        </Btn>
      ) : null}
    </section>
  );
}
