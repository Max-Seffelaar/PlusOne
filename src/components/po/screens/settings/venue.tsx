'use client';

import { type JSX, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { ROLE_LABELS } from '@/features/auth/roles';
import { venueCapabilities } from '@/features/venues/access';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { usePoVenueSettings } from '@/features/po/hooks';
import { usePoUpdateVenueSettings } from '@/features/po/mutations';
import { COUNTRIES } from '@/lib/countries';
import { useNav, usePo } from '../../context';
import { Icon } from '../../icon';
import { Avatar, Btn, Empty, ExternalLink, Field, IconBtn, Label, MiniChip, Note, RefusedAction, Scroll, ToggleRow, Top, press } from '../../kit';
import { SearchSelect, type SearchSelectOption } from '../../search-select';
import { BottomBar } from '../../shell';
import { useIsDemoAccount } from '../../app-shell-data';
import { col, FormError } from './_shared';

// 34px quota stepper; the ring reaches 5px past its 1px border (44x44). Minus and
// plus sit 38px apart (the count between them), so the rings never meet.
const iconSm = "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border border-line text-faint relative before:absolute before:-inset-[6px] before:content-['']";

/** venues.country holds the ISO 3166-1 alpha-2 code ('NL'); the list shows the
 *  English name with the code beside it. */
const COUNTRY_OPTIONS: readonly SearchSelectOption[] = COUNTRIES.map((c) => ({ value: c.code, label: c.name, hint: c.code }));

// ── VENUE SWITCHER (pushed) ──────────────────────────────────────────────────
export function VenueSwitch(): JSX.Element {
  const nav = useNav();
  const { myVenues, activeVenueId, switchToVenue } = usePo();
  // Store-review demo account (86ey6bfug): "New venue" stays visible but inert,
  // with the refusal upfront. UX only — createVenueAction + the DB guard still refuse.
  const demo = useIsDemoAccount();
  const activeName = myVenues.find((v) => v.venueId === activeVenueId)?.venueName ?? t.settings.venueSwitch.thisVenueFallback;
  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.settings.venueSwitch.title} sub={t.settings.venueSwitch.sub} right={<IconBtn name="plus" disabled={demo} onClick={() => nav.push('venuecreate')} />} />
      <Scroll bottom={24}>
        <Note icon="building">
          {t.settings.venueSwitch.notePre}
          <b>{fmt(t.settings.venueSwitch.noteBold, { name: activeName })}</b>
          {t.settings.venueSwitch.notePost}
        </Note>
        <Label className="mb-[10px]">{fmt(t.settings.venueSwitch.yourVenues, { n: myVenues.length })}</Label>
        {myVenues.length === 0 ? (
          <Empty text={t.settings.venueSwitch.empty} />
        ) : (
          <div className="flex flex-col gap-[10px]">
            {myVenues.map((v) => {
              const cur = v.venueId === activeVenueId;
              // "Manage" opens venue settings, which only admin/finance may see
              // (z8uq9m0hw2): anyone else would land on a "no rights" page.
              const canManage = cur && venueCapabilities(v.roles).viewSettings;
              return (
                <div key={v.venueId} className={cn('rounded-[18px] border p-[15px]', cur ? 'border-transparent bg-acc-dim' : 'border-line bg-elev')}>
                  <div className="flex items-center gap-[13px]">
                    <Avatar name={v.venueName} size={46} accent={cur} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-display text-[16.5px] font-bold text-text">{v.venueName}</div>
                        {cur && <MiniChip className="border-transparent bg-white/[0.10] text-acc">{t.settings.venueSwitch.current}</MiniChip>}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {v.roles.length > 0 ? (
                          v.roles.map((ro) => <MiniChip key={ro}>{ROLE_LABELS[ro] ?? ro}</MiniChip>)
                        ) : (
                          <MiniChip>{t.settings.venueSwitch.crewAccess}</MiniChip>
                        )}
                      </div>
                    </div>
                  </div>
                  {(canManage || !cur) && (
                    <div className="mt-[13px] flex items-center justify-end gap-[7px]">
                      {cur ? (
                        <Btn sm kind="ghost" icon="cog" onClick={() => nav.push('venuesettings', { id: v.venueId })}>
                          {t.settings.venueSwitch.manage}
                        </Btn>
                      ) : (
                        <Btn sm kind="primary" icon="swap" onClick={() => switchToVenue(v.venueId)}>
                          {t.settings.venueSwitch.switch}
                        </Btn>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {demo ? (
          <RefusedAction className="mt-[14px]" label={t.settings.venueSwitch.addVenue} reason={t.auth.demoNoVenues} />
        ) : (
          <Btn kind="dark" full icon="plus" className="mt-[14px]" onClick={() => nav.push('venuecreate')}>
            {t.settings.venueSwitch.addVenue}
          </Btn>
        )}
      </Scroll>
    </div>
  );
}

/** Only an http(s) URL ever becomes a live link. The Zod rule and the DB CHECK
 *  already guarantee it; this keeps any other stored string inert. */
const isLinkable = (url: string): boolean => /^https?:\/\//i.test(url);

/** The venue's own website (z8uq9m0hw2). Admin: an input, plus a link to the
 *  SAVED address once there is one. Read-only (finance): the saved address is
 *  itself the tappable link. Opens in a new tab / the system browser. */
function WebsiteField({ value, saved, onChange }: { value: string; saved: string; onChange?: (v: string) => void }): JSX.Element {
  const link = saved !== '' && isLinkable(saved) ? saved : null;
  if (!onChange) {
    return link ? (
      <ExternalLink
        href={link}
        className={cn('mb-[18px] flex items-center gap-[11px] rounded-field border border-line bg-elev px-[15px] py-[13px]', press)}
      >
        <span className="text-faint">
          <Icon name="link" size={19} />
        </span>
        <span className="min-w-0 flex-1 truncate font-body text-[16px] text-acc">{link}</span>
        <Icon name="arrowR" size={17} className="text-faint" />
      </ExternalLink>
    ) : (
      <Field icon="link" value="" placeholder={t.settings.venue.websiteEmpty} className="mb-[18px]" />
    );
  }
  return (
    <div className="mb-[18px]">
      <Field icon="link" type="url" value={value} onChange={onChange} placeholder={t.settings.venue.websitePlaceholder} />
      {link && (
        <ExternalLink
          href={link}
          className="mt-1 inline-flex min-h-[44px] items-center gap-[6px] font-display text-[13.5px] font-bold text-acc"
        >
          {t.settings.venue.websiteOpen}
          <Icon name="arrowR" size={15} />
        </ExternalLink>
      )}
    </div>
  );
}

// ── VENUE SETTINGS (pushed) — S8 Venue-instellingen, live ────────────────────
// Name + AVG retention + venue-default quota + the company/legal/finance/address
// profile (mirrors the desktop VenueSettingsForm). Admin edits; finance reads
// (RLS venues_update_admin). The action re-checks admin server-side.
export function VenueSettings(): JSX.Element {
  const nav = useNav();
  const { roles, venueName } = usePoIdentity();
  const caps = venueCapabilities(roles);
  const demo = useIsDemoAccount(); // UX only (86ey6bfug), see VenueSwitch
  const settingsQ = usePoVenueSettings();
  const save = usePoUpdateVenueSettings();

  const s = settingsQ.data ?? null;
  const [form, setForm] = useState({
    name: '',
    retentionMonths: 12,
    defaultPersonalQuota: 0,
    allowUncheck: true,
    companyName: '',
    kvkNumber: '',
    vatNumber: '',
    financeEmail: '',
    addressLine: '',
    postalCode: '',
    city: '',
    country: 'NL',
    website: '',
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (s && !loaded) {
      setForm({
        name: s.name,
        retentionMonths: s.retentionMonths,
        defaultPersonalQuota: s.defaultPersonalQuota,
        allowUncheck: s.allowUncheck,
        companyName: s.companyName,
        kvkNumber: s.kvkNumber,
        vatNumber: s.vatNumber,
        financeEmail: s.financeEmail,
        addressLine: s.addressLine,
        postalCode: s.postalCode,
        city: s.city,
        country: s.country,
        website: s.website,
      });
      setLoaded(true);
    }
  }, [s, loaded]);

  const canEdit = caps.editSettings;
  type StrField = 'name' | 'companyName' | 'kvkNumber' | 'vatNumber' | 'financeEmail' | 'addressLine' | 'postalCode' | 'city' | 'country' | 'website';
  const editStr = (k: StrField, sanitize?: (v: string) => string) =>
    canEdit ? (v: string) => setForm((f) => ({ ...f, [k]: sanitize ? sanitize(v) : v })) : undefined;

  if (!caps.viewSettings) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title={t.settings.venue.title} sub={venueName} />
        <Scroll bottom={24}>
          <Empty text={t.settings.venue.viewNoRights} />
        </Scroll>
      </div>
    );
  }
  if ((settingsQ.isLoading || !loaded) && !settingsQ.isError) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title={t.settings.venue.title} sub={venueName} />
        <Scroll bottom={24}>
          <Empty text={t.settings.venue.loading} />
        </Scroll>
      </div>
    );
  }
  if (!s) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title={t.settings.venue.title} sub={venueName} />
        <Scroll bottom={24}>
          <Empty text={t.settings.venue.loadError} />
        </Scroll>
      </div>
    );
  }

  const dirty =
    form.name !== s.name ||
    form.retentionMonths !== s.retentionMonths ||
    form.defaultPersonalQuota !== s.defaultPersonalQuota ||
    form.allowUncheck !== s.allowUncheck ||
    form.companyName !== s.companyName ||
    form.kvkNumber !== s.kvkNumber ||
    form.vatNumber !== s.vatNumber ||
    form.financeEmail !== s.financeEmail ||
    form.addressLine !== s.addressLine ||
    form.postalCode !== s.postalCode ||
    form.city !== s.city ||
    form.country !== s.country ||
    form.website !== s.website;
  const canSave = canEdit && dirty && form.name.trim() !== '' && !save.isPending;

  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.settings.venue.title} sub={s.name} />
      <Scroll bottom={canEdit ? 120 : 28}>
        {!canEdit && <Note icon="shield">{t.settings.venue.readonlyNote}</Note>}

        <Label className="mb-2">{t.settings.venue.nameLabel}</Label>
        <Field icon="building" value={form.name} onChange={editStr('name')} className="mb-[14px]" />
        <Label className="mb-2">{t.settings.venue.websiteLabel}</Label>
        <WebsiteField value={form.website} saved={s.website} onChange={editStr('website')} />

        <Label className="mb-[10px]">{t.settings.venue.defaultsLabel}</Label>
        <div className="mb-[18px] rounded-[18px] border border-line bg-elev px-4 py-1">
          <div className="flex items-center gap-[12px] py-[14px]">
            <div className="flex-1">
              <div className="text-[14.5px] font-semibold text-text">{t.settings.venue.defaultQuotaTitle}</div>
              <div className="mt-0.5 text-[12px] text-faint">{t.settings.venue.defaultQuotaSub}</div>
            </div>
            {canEdit ? (
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setForm((f) => ({ ...f, defaultPersonalQuota: Math.max(0, f.defaultPersonalQuota - 1) }))} className={cn(iconSm, press)} aria-label={t.settings.quota.less}>
                  <Icon name="minus" size={16} />
                </button>
                <span className="min-w-[22px] text-center font-display text-[18px] font-extrabold text-text">{form.defaultPersonalQuota}</span>
                <button type="button" onClick={() => setForm((f) => ({ ...f, defaultPersonalQuota: f.defaultPersonalQuota + 1 }))} className={cn(iconSm, press, 'text-acc')} aria-label={t.settings.quota.more}>
                  <Icon name="plus" size={16} />
                </button>
              </div>
            ) : (
              <span className="font-display text-[18px] font-extrabold text-text">{form.defaultPersonalQuota}</span>
            )}
          </div>
        </div>

        <Label className="mb-[10px]">{t.settings.venue.atDoorLabel}</Label>
        <div className="mb-[18px] rounded-[18px] border border-line bg-elev px-4 py-1">
          <ToggleRow
            title={t.settings.venue.allowCheckoutTitle}
            sub={t.settings.venue.allowCheckoutSub}
            on={form.allowUncheck}
            set={(v) => canEdit && setForm((f) => ({ ...f, allowUncheck: v }))}
            last
          />
        </div>

        <Label className="mb-[10px]">{t.settings.venue.retentionLabel}</Label>
        <div className="mb-[18px] rounded-[18px] border border-line bg-elev p-4">
          <div className="mb-[14px] text-[13.5px] leading-[1.5] text-dim">{t.settings.venue.retentionNote}</div>
          <div className="flex gap-[7px]">
            {[6, 12, 24].map((m) => (
              <button
                key={m}
                type="button"
                disabled={!canEdit}
                onClick={() => setForm((f) => ({ ...f, retentionMonths: m }))}
                className={cn(
                  'flex-1 rounded-[11px] border py-[11px] font-display text-[14px] font-bold',
                  canEdit && press,
                  form.retentionMonths === m ? 'border-transparent bg-acc text-on-acc' : 'border-line bg-elev2 text-dim',
                )}
              >
                {fmt(t.settings.venue.retentionMonths, { n: m })}
              </button>
            ))}
          </div>
        </div>

        <Label className="mb-[10px]">{t.settings.venue.companyLabel}</Label>
        {/* Persistent per-field labels (T10): once a value is filled the placeholder
            vanishes, so the label — not the placeholder — is what tells you the field. */}
        <Label className="mb-2">{t.settings.venue.companyNameFieldLabel}</Label>
        <Field icon="building" value={form.companyName} onChange={editStr('companyName')} placeholder={t.settings.venue.companyNamePlaceholder} className="mb-[14px]" />
        {/* min-w-0 lets each field shrink below its content so the 2-col row never
            overflows the viewport at ≤390px (the btw-nummer overflow, S4.2). */}
        <div className="mb-[14px] flex gap-2">
          <div className="min-w-0 flex-1">
            <Label className="mb-2">{t.settings.venue.kvkFieldLabel}</Label>
            <Field icon="grid" value={form.kvkNumber} onChange={editStr('kvkNumber', (v) => v.replace(/[^0-9]/g, '').slice(0, 8))} inputMode="numeric" placeholder={t.settings.venue.kvkPlaceholder} />
          </div>
          <div className="min-w-0 flex-1">
            <Label className="mb-2">{t.settings.venue.vatFieldLabel}</Label>
            <Field value={form.vatNumber} onChange={editStr('vatNumber')} placeholder={t.settings.venue.vatPlaceholder} />
          </div>
        </div>
        <Label className="mb-2">{t.settings.venue.billingEmailFieldLabel}</Label>
        <Field icon="mail" value={form.financeEmail} onChange={editStr('financeEmail')} inputMode="email" placeholder={t.settings.venue.billingEmailPlaceholder} className="mb-[18px]" />

        <Label className="mb-[10px]">{t.settings.venue.addressLabel}</Label>
        <Label className="mb-2">{t.settings.venue.streetFieldLabel}</Label>
        <Field icon="pin" value={form.addressLine} onChange={editStr('addressLine')} placeholder={t.settings.venue.streetPlaceholder} className="mb-[14px]" />
        <div className="mb-[14px] flex gap-2">
          <div className="min-w-0 flex-1">
            <Label className="mb-2">{t.settings.venue.postalFieldLabel}</Label>
            <Field value={form.postalCode} onChange={editStr('postalCode')} placeholder={t.settings.venue.postalPlaceholder} />
          </div>
          <div className="min-w-0 flex-[1.4]">
            <Label className="mb-2">{t.settings.venue.cityFieldLabel}</Label>
            <Field value={form.city} onChange={editStr('city')} placeholder={t.settings.venue.cityPlaceholder} />
          </div>
        </div>
        <Label className="mb-2">{t.settings.venue.countryFieldLabel}</Label>
        {/* A stored value that isn't a code (legacy free text) shows as-is and is
            only replaced when the admin picks a country. */}
        <SearchSelect
          value={form.country}
          options={COUNTRY_OPTIONS}
          onChange={editStr('country')}
          label={t.settings.venue.countryFieldLabel}
          placeholder={t.settings.venue.countryPlaceholder}
          searchPlaceholder={t.shared.country.searchPlaceholder}
          searchLabel={t.shared.country.searchAria}
          emptyText={t.shared.country.empty}
          className="mb-1.5"
        />

        <FormError error={save.isError ? save.error : null} />
        {save.isSuccess && !dirty && <p className="mt-3 text-[12.5px] text-acc-soft">{t.settings.venue.saved}</p>}

        {/* With one venue the venue card lands here instead of the switcher
            (z8uq9m0hw2), so "Add a new venue" has to live here too. */}
        <Label className="mb-[10px] mt-[22px]">{t.settings.venueSwitch.title}</Label>
        {demo ? (
          <RefusedAction label={t.settings.venueSwitch.addVenue} reason={t.auth.demoNoVenues} />
        ) : (
          <Btn kind="dark" full icon="plus" onClick={() => nav.push('venuecreate')}>
            {t.settings.venueSwitch.addVenue}
          </Btn>
        )}
      </Scroll>
      {canEdit && (
        <BottomBar>
          <Btn
            kind="primary"
            full
            icon="check"
            disabled={!canSave}
            className={canSave ? '' : 'opacity-[0.45]'}
            onClick={() => save.mutate(form)}
          >
            {save.isPending ? t.settings.venue.saving : t.settings.venue.save}
          </Btn>
        </BottomBar>
      )}
    </div>
  );
}
