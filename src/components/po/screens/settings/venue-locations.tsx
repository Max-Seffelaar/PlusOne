'use client';

/**
 * Company settings → Locations (z8uq9m444c). A company saves the places where
 * it runs events; the event form offers them as chips and stores a COPY on the
 * event, so editing or archiving one here never changes an existing event.
 * Members read, admins add/edit/archive (RLS company_locations_*; the server
 * actions run through the user-scoped client). No delete, only archive.
 *
 * Its own file (not inside venue.tsx) so Company settings changes elsewhere do
 * not collide with this section; venue.tsx renders it with one line.
 */
import { type JSX, useState } from 'react';
import { fmt, t } from '@/lib/i18n';
import { usePoCompanyLocations, usePoVenueSettings } from '@/features/po/hooks';
import {
  usePoArchiveCompanyLocation,
  usePoCreateCompanyLocation,
  usePoUpdateCompanyLocation,
} from '@/features/po/mutations';
import type { PoCompanyLocation } from '@/features/po/adapters';
import {
  LOCATION_CITY_MAX,
  LOCATION_LINE_MAX,
  LOCATION_POSTAL_MAX,
  SAVED_LOCATION_NAME_MAX,
} from '@/features/venues/location-schemas';
import { Icon } from '../../icon';
import { Btn, Field, Label, PlacesField } from '../../kit';
import { ConfirmSheet, Sheet } from '../../shell';
import { FormError } from './_shared';

interface Draft {
  name: string;
  addressLine: string;
  postalCode: string;
  city: string;
  country: string;
}

const EMPTY: Draft = { name: '', addressLine: '', postalCode: '', city: '', country: '' };

function LocationEditor({
  initial,
  locationId,
  defaultCountry,
  onClose,
}: {
  initial: Draft;
  /** null = a new location. */
  locationId: string | null;
  defaultCountry: string;
  onClose: () => void;
}): JSX.Element {
  const [d, setD] = useState<Draft>(initial);
  const create = usePoCreateCompanyLocation();
  const update = usePoUpdateCompanyLocation();
  const busy = create.isPending || update.isPending;
  const error = create.error ?? update.error;
  const set = (k: keyof Draft) => (v: string) => setD((p) => ({ ...p, [k]: v }));
  const canSave = d.name.trim() !== '' && !busy;

  const save = async (): Promise<void> => {
    const input = {
      name: d.name,
      addressLine: d.addressLine,
      postalCode: d.postalCode,
      city: d.city,
      country: d.country || defaultCountry,
    };
    try {
      if (locationId) await update.mutateAsync({ locationId, ...input });
      else await create.mutateAsync(input);
      onClose();
    } catch {
      // The error renders below; the sheet stays open with the draft.
    }
  };

  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-4 font-display text-[18px] font-bold text-text">
        {locationId ? t.settings.locations.editTitle : t.settings.locations.newTitle}
      </div>
      <Label className="mb-2">{t.settings.locations.nameLabel}</Label>
      <Field
        icon="building"
        ariaLabel={t.settings.locations.nameLabel}
        value={d.name}
        onChange={set('name')}
        placeholder={t.settings.locations.namePlaceholder}
        maxLength={SAVED_LOCATION_NAME_MAX}
        className="mb-[14px]"
      />
      <Label className="mb-2">{t.settings.venue.streetFieldLabel}</Label>
      {/* Places (z8uq9m2vg5): one pick fills street, postcode, city, country,
          and the name when it is still empty. Without a key it is a plain field. */}
      <PlacesField
        value={d.addressLine}
        onChange={set('addressLine')}
        onPick={(p) =>
          p.address &&
          setD((prev) => ({
            name: prev.name.trim() ? prev.name : p.name.slice(0, SAVED_LOCATION_NAME_MAX),
            addressLine: (p.address?.addressLine ?? '').slice(0, LOCATION_LINE_MAX),
            postalCode: (p.address?.postalCode ?? '').slice(0, LOCATION_POSTAL_MAX),
            city: (p.address?.city ?? '').slice(0, LOCATION_CITY_MAX),
            country: p.address?.country ?? prev.country,
          }))
        }
        maxLength={LOCATION_LINE_MAX}
        ariaLabel={t.settings.venue.streetFieldLabel}
        placeholder={t.settings.venue.streetPlaceholder}
        className="mb-[14px]"
      />
      <div className="mb-1 flex gap-2">
        <div className="min-w-0 flex-1">
          <Label className="mb-2">{t.settings.venue.postalFieldLabel}</Label>
          <Field
            ariaLabel={t.settings.venue.postalFieldLabel}
            value={d.postalCode}
            onChange={set('postalCode')}
            placeholder={t.settings.venue.postalPlaceholder}
            maxLength={LOCATION_POSTAL_MAX}
          />
        </div>
        <div className="min-w-0 flex-[1.4]">
          <Label className="mb-2">{t.settings.venue.cityFieldLabel}</Label>
          <Field
            ariaLabel={t.settings.venue.cityFieldLabel}
            value={d.city}
            onChange={set('city')}
            placeholder={t.settings.venue.cityPlaceholder}
            maxLength={LOCATION_CITY_MAX}
          />
        </div>
      </div>
      <FormError error={error} />
      <Btn
        full
        icon="check"
        className="mt-4"
        disabled={!canSave}
        onClick={() => void save()}
      >
        {busy ? t.settings.locations.saving : t.settings.locations.save}
      </Btn>
      <Btn full kind="quiet" className="mt-2" onClick={onClose}>
        {t.settings.common.cancel}
      </Btn>
    </Sheet>
  );
}

export function VenueLocations({ canEdit }: { canEdit: boolean }): JSX.Element {
  const locationsQ = usePoCompanyLocations();
  // Shared cache with Company settings: the country a manual entry defaults to.
  const settingsQ = usePoVenueSettings();
  const archive = usePoArchiveCompanyLocation();
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [archiving, setArchiving] = useState<PoCompanyLocation | null>(null);
  const locations = locationsQ.data ?? [];
  const defaultCountry = settingsQ.data?.country || 'NL';

  return (
    <section aria-label={t.settings.locations.label} data-testid="company-locations">
      <Label className="mb-[10px] mt-[22px]">{t.settings.locations.label}</Label>
      <div className="mb-[12px] text-[13px] leading-[1.5] text-dim">{t.settings.locations.note}</div>

      {locationsQ.isError ? (
        <p className="mb-[12px] text-[13px] text-red-300" role="alert">
          {t.settings.common.formError}
        </p>
      ) : locations.length === 0 ? (
        <div className="mb-[12px] rounded-[18px] border border-dashed border-line px-4 py-[16px] text-[13.5px] leading-[1.45] text-faint">
          {locationsQ.isLoading ? t.settings.venue.loading : t.settings.locations.empty}
        </div>
      ) : (
        <ul className="mb-[12px] flex flex-col gap-[10px]">
          {locations.map((loc) => (
            <li key={loc.id} className="rounded-[18px] border border-line bg-elev px-4 py-[13px]" data-testid="company-location">
              <div className="flex items-start gap-[11px]">
                <span className="mt-[2px] text-faint">
                  <Icon name="pin" size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="break-words font-display text-[15.5px] font-bold text-text">{loc.name}</div>
                  {loc.address && <div className="mt-0.5 break-words text-[13px] leading-[1.4] text-dim">{loc.address}</div>}
                </div>
              </div>
              {canEdit && (
                <div className="mt-[11px] flex flex-wrap justify-end gap-2">
                  <Btn
                    sm
                    kind="ghost"
                    ariaLabel={fmt(t.settings.locations.editAria, { name: loc.name })}
                    onClick={() =>
                      setEditing({
                        id: loc.id,
                        draft: { name: loc.name, addressLine: loc.addressLine, postalCode: loc.postalCode, city: loc.city, country: loc.country },
                      })
                    }
                  >
                    {t.settings.locations.edit}
                  </Btn>
                  <Btn
                    sm
                    kind="quiet"
                    ariaLabel={fmt(t.settings.locations.archiveAria, { name: loc.name })}
                    onClick={() => {
                      archive.reset();
                      setArchiving(loc);
                    }}
                  >
                    {t.settings.locations.archive}
                  </Btn>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <Btn kind="dark" full icon="plus" onClick={() => setEditing({ id: null, draft: EMPTY })}>
          {t.settings.locations.add}
        </Btn>
      )}

      {editing && (
        <LocationEditor
          initial={editing.draft}
          locationId={editing.id}
          defaultCountry={defaultCountry}
          onClose={() => setEditing(null)}
        />
      )}
      {archiving && (
        <ConfirmSheet
          icon="warn"
          tone="danger"
          title={t.settings.locations.archive}
          confirmLabel={t.settings.locations.archiveYes}
          confirmDisabled={archive.isPending}
          onConfirm={() => archive.mutate(archiving.id, { onSuccess: () => setArchiving(null) })}
          cancelLabel={t.settings.common.cancel}
          onClose={() => setArchiving(null)}
        >
          <p className="text-[14px] leading-[1.5] text-dim">{fmt(t.settings.locations.archiveConfirm, { name: archiving.name })}</p>
          <FormError error={archive.error} />
        </ConfirmSheet>
      )}
    </section>
  );
}
