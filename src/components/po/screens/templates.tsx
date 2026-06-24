'use client';

/**
 * Event templates (86exyp8gn): the templates list + the template editor.
 * A template captures a tier set + a hard capacity + default event settings, and is
 * picked when creating an event to seed it (create_event_from_template). Management
 * is admin OR venue-organizer (usePoCanManageTemplates / RLS).
 */
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import {
  usePoCanManageTemplates,
  usePoTemplate,
  usePoTemplateTiers,
  usePoTemplates,
} from '@/features/po/hooks';
import {
  usePoCreateTemplate,
  usePoCreateTemplateTier,
  usePoDeleteTemplate,
  usePoDeleteTemplateTier,
  usePoUpdateTemplate,
} from '@/features/po/mutations';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { useNav } from '../context';
import { Icon } from '../icon';
import { Btn, Empty, Field, IconBtn, Label, Note, Scroll, ToggleRow, Top } from '../kit';
import { BottomBar } from '../shell';

const col = 'flex h-full flex-col';
const cardPress = 'transition-[border-color,transform] hover:border-white/[0.24] active:scale-[0.99]';
const TIER_COLORS = ['#B5A6FF', '#9DE0C0', '#E8C98A', '#9FB8E8', '#E89AC0', '#8E8E93'];

// ── Templates list ───────────────────────────────────────────────────────────
export function Templates(): JSX.Element {
  const nav = useNav();
  const { data, isLoading, isError } = usePoTemplates();
  const canManage = usePoCanManageTemplates();
  return (
    <div className={col}>
      <Top
        onBack={nav.back}
        title={t.templates.title}
        sub={t.templates.sub}
        right={canManage ? <IconBtn name="plus" onClick={() => nav.push('templateedit', { isNew: true })} /> : undefined}
      />
      <Scroll bottom={28}>
        {isLoading ? (
          <Empty text={t.templates.loading} />
        ) : isError ? (
          <Empty text={t.templates.loadError} />
        ) : (data ?? []).length === 0 ? (
          <Empty text={canManage ? t.templates.empty : t.templates.emptyNoRights} />
        ) : (
          <div className="flex flex-col gap-[11px]">
            {(data ?? []).map((tpl) => {
              const tierLabel =
                tpl.tierCount === 0
                  ? t.templates.cardNoTiers
                  : tpl.tierCount === 1
                    ? t.templates.cardOneTier
                    : fmt(t.templates.cardTiers, { n: tpl.tierCount });
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => nav.push('templateedit', { id: tpl.id })}
                  className={cn(
                    'flex w-full items-center gap-[13px] rounded-[18px] border border-line bg-elev p-[15px] text-left',
                    cardPress,
                  )}
                >
                  <span className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[12px] border border-line bg-elev2 text-acc">
                    <Icon name="grid" size={19} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[15.5px] font-bold text-text">{tpl.name}</div>
                    <div className="mt-px text-[12.5px] text-faint">
                      {tpl.capacity ? fmt(t.templates.cardCapacity, { n: tpl.capacity }) : t.templates.cardNoCapacity} ·{' '}
                      {tierLabel}
                    </div>
                  </div>
                  <Icon name="chev" size={18} className="text-ghost" />
                </button>
              );
            })}
          </div>
        )}
      </Scroll>
    </div>
  );
}

// ── Template editor ──────────────────────────────────────────────────────────
export function TemplateEdit({ id }: { id?: string; isNew?: boolean }): JSX.Element {
  const nav = useNav();
  const { venueId } = usePoIdentity();
  const canManage = usePoCanManageTemplates();

  // A brand-new template has no id; after the first save we hold the new id so the
  // tier editor appears in-place (mirrors EventEdit's create-then-manage split).
  const [createdId, setCreatedId] = useState<string | null>(null);
  const templateId = id ?? createdId ?? '';
  const isCreating = !templateId;

  const detail = usePoTemplate(templateId);
  const createTemplate = usePoCreateTemplate();
  const updateTemplate = usePoUpdateTemplate(templateId);
  const deleteTemplate = usePoDeleteTemplate();

  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('');
  const [landingOn, setLandingOn] = useState(false);
  const [allowUncheck, setAllowUncheck] = useState<boolean | null>(null);
  const [autoOn, setAutoOn] = useState(false);
  const [autoHours, setAutoHours] = useState('');
  const [err, setErr] = useState<string | null>(null);

  // Hydrate from the loaded template (edit mode, and once after a fresh create).
  useEffect(() => {
    const d = detail.data;
    if (!d) return;
    setName(d.name);
    setCapacity(d.capacity == null ? '' : String(d.capacity));
    setLandingOn(d.landing_active);
    setAllowUncheck(d.allow_uncheck);
    setAutoOn(d.auto_lock_offset_minutes != null);
    setAutoHours(d.auto_lock_offset_minutes != null ? String(Math.abs(d.auto_lock_offset_minutes) / 60) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data?.id]);

  const writable = canManage;
  const saving = createTemplate.isPending || updateTemplate.isPending;

  // Capacity → positive int or null; auto-lock hours → negative minute offset
  // (lock X hours BEFORE doors) or null.
  const buildSettings = (): {
    capacity: number | null;
    allowUncheck: boolean | null;
    landingActive: boolean;
    autoLockOffsetMinutes: number | null;
  } => {
    const capNum = capacity.trim() === '' ? NaN : Number.parseInt(capacity, 10);
    const hoursNum = Number(autoHours);
    const offset =
      autoOn && autoHours.trim() !== '' && Number.isFinite(hoursNum) ? -Math.round(hoursNum * 60) : null;
    return {
      capacity: Number.isFinite(capNum) && capNum > 0 ? capNum : null,
      allowUncheck,
      landingActive: landingOn,
      autoLockOffsetMinutes: offset,
    };
  };

  const save = async (): Promise<void> => {
    setErr(null);
    if (!name.trim()) {
      setErr(t.templates.errName);
      return;
    }
    try {
      if (isCreating) {
        if (!venueId) {
          setErr(t.templates.errNoVenue);
          return;
        }
        const newId = await createTemplate.mutateAsync({ venueId, name: name.trim(), ...buildSettings() });
        setCreatedId(newId); // reveal the tier editor in-place
      } else {
        await updateTemplate.mutateAsync({ templateId, name: name.trim(), ...buildSettings() });
        nav.back();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.templates.errSave);
    }
  };

  const remove = async (): Promise<void> => {
    setErr(null);
    try {
      await deleteTemplate.mutateAsync({ templateId });
      nav.back();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.templates.errDelete);
    }
  };

  // Only show the full-screen loader when OPENING an existing template (not after a
  // fresh create, which keeps the form the user just filled in).
  if (id && !createdId && detail.isLoading) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title={t.templates.editTitle} />
        <Scroll bottom={28}>
          <Empty text={t.templates.loading} />
        </Scroll>
      </div>
    );
  }

  return (
    <div className={col}>
      <Top
        onBack={nav.back}
        title={isCreating ? t.templates.newTitle : t.templates.editTitle}
        sub={isCreating ? undefined : detail.data?.name}
      />
      <Scroll bottom={120}>
        {err && <div className="mb-3 text-[13px] font-semibold text-[#E89AC0]">{err}</div>}
        {!writable && <Note icon="shield">{t.templates.noteViewOnly}</Note>}

        <Label className="mb-2">{t.templates.nameLabel}</Label>
        <Field
          placeholder={t.templates.namePlaceholder}
          value={name}
          onChange={writable ? setName : undefined}
          className="mb-[14px]"
        />

        <Label className="mb-2">{t.templates.capacityLabel}</Label>
        <Field
          icon="users"
          placeholder={t.templates.capacityPlaceholder}
          value={capacity}
          onChange={writable ? setCapacity : undefined}
          inputMode="numeric"
          className="mb-1.5"
        />
        <p className="mb-[18px] text-[12px] leading-[1.5] text-faint">{t.templates.capacityHint}</p>

        <Label className="mb-[10px]">{t.templates.settingsLabel}</Label>
        <div className="mb-[18px] rounded-[16px] border border-line bg-elev px-[14px] py-1">
          <ToggleRow
            title={t.templates.landingTitle}
            sub={t.templates.landingSub}
            on={landingOn}
            set={(v) => writable && setLandingOn(v)}
          />
          <ToggleRow
            title={t.templates.autoLockTitle}
            sub={autoOn && autoHours.trim() ? fmt(t.templates.autoLockOnSub, { n: autoHours }) : t.templates.autoLockOffSub}
            on={autoOn}
            set={(v) => writable && setAutoOn(v)}
            last={!autoOn}
          />
          {autoOn && (
            <div className="pb-[14px]">
              <Label className="mb-2">{t.templates.autoLockHoursLabel}</Label>
              <Field
                icon="clock"
                inputMode="numeric"
                placeholder={t.templates.autoLockHoursPlaceholder}
                value={autoHours}
                onChange={writable ? setAutoHours : undefined}
                className="w-[140px]"
              />
            </div>
          )}
        </div>

        <Label className="mb-[10px]">{t.templates.allowCheckoutTitle}</Label>
        <div className="mb-[18px] flex gap-2">
          {([
            ['default', null],
            ['on', true],
            ['off', false],
          ] as const).map(([key, val]) => (
            <button
              key={key}
              type="button"
              disabled={!writable}
              onClick={() => writable && setAllowUncheck(val)}
              className={cn(
                'flex-1 rounded-[12px] border px-3 py-[11px] font-display text-[12.5px] font-bold transition-colors',
                allowUncheck === val ? 'border-acc bg-acc-dim text-acc' : 'border-line text-dim',
              )}
            >
              {key === 'default' ? t.templates.checkoutDefault : key === 'on' ? t.templates.checkoutOn : t.templates.checkoutOff}
            </button>
          ))}
        </div>

        {isCreating ? (
          <Note icon="spark">{t.templates.createFirst}</Note>
        ) : (
          <TemplateTierEditor templateId={templateId} canManage={writable} />
        )}

        {!isCreating && writable && (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={deleteTemplate.isPending}
            className="mt-5 w-full rounded-[14px] border border-line py-[13px] text-center font-display text-[13px] font-bold text-[#E89AC0] transition-[filter] hover:brightness-[1.15] disabled:opacity-50"
          >
            {t.templates.deleteTemplate}
          </button>
        )}
      </Scroll>
      <BottomBar>
        <Btn
          kind="primary"
          full
          icon="check"
          onClick={() => void save()}
          disabled={!writable || saving}
          className={!writable || saving ? 'opacity-50' : ''}
        >
          {saving ? t.templates.saving : isCreating ? t.templates.createTemplate : t.templates.saveTemplate}
        </Btn>
      </BottomBar>
    </div>
  );
}

// ── Template tier editor (add + list + remove; delete-and-re-add to change one) ──
function TemplateTierEditor({ templateId, canManage }: { templateId: string; canManage: boolean }): JSX.Element {
  const tiers = usePoTemplateTiers(templateId);
  const createTier = usePoCreateTemplateTier(templateId);
  const deleteTier = usePoDeleteTemplateTier(templateId);

  const [adding, setAdding] = useState(false);
  const [nm, setNm] = useState('');
  const [color, setColor] = useState(TIER_COLORS[0]);
  const [max, setMax] = useState('');
  const [aliasText, setAliasText] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (!nm.trim() || createTier.isPending) return;
    setErr(null);
    const maxNum = Number.parseInt(max, 10);
    try {
      await createTier.mutateAsync({
        templateId,
        name: nm.trim(),
        color,
        maxGuests: Number.isFinite(maxNum) && maxNum > 0 ? maxNum : null,
        aliases: aliasText
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
      });
      setNm('');
      setColor(TIER_COLORS[0]);
      setMax('');
      setAliasText('');
      setAdding(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.templates.errCreateTier);
    }
  };

  const remove = async (tierId: string): Promise<void> => {
    setErr(null);
    try {
      await deleteTier.mutateAsync({ tierId });
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.templates.errDeleteTier);
    }
  };

  return (
    <div>
      <div className="mb-[10px] flex items-center justify-between">
        <Label>{t.templates.tiersLabel}</Label>
        {canManage && <IconBtn name={adding ? 'close' : 'plus'} onClick={() => setAdding((a) => !a)} />}
      </div>
      <p className="mb-3 text-[12px] leading-[1.5] text-faint">{t.templates.tiersHint}</p>
      {err && <div className="mb-3 text-[13px] font-semibold text-[#E89AC0]">{err}</div>}

      {adding && (
        <div className="mb-[14px] rounded-[18px] border border-acc bg-elev p-4">
          <Label className="mb-[10px]">{t.templates.newTier}</Label>
          <Field placeholder={t.templates.tierNamePlaceholder} value={nm} onChange={setNm} autoFocus className="mb-3" />
          <Label className="mb-2">{t.templates.color}</Label>
          <div className="mb-[14px] flex gap-[9px]">
            {TIER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="h-[34px] w-[34px] cursor-pointer rounded-full transition-[filter] hover:brightness-[1.1]"
                style={{ background: c, border: '2px solid ' + (color === c ? '#FFFFFF' : 'transparent') }}
                aria-label={fmt(t.events.colorAria, { color: c })}
              />
            ))}
          </div>
          <Label className="mb-2">{t.templates.maxLabel}</Label>
          <Field placeholder={t.templates.maxPlaceholder} value={max} onChange={setMax} inputMode="numeric" className="mb-[14px]" />
          <Label className="mb-2">{t.templates.aliasesLabel}</Label>
          <Field icon="spark" placeholder={t.templates.aliasesPlaceholder} value={aliasText} onChange={setAliasText} className="mb-[14px]" />
          <Btn
            kind="primary"
            full
            icon="check"
            onClick={() => void submit()}
            disabled={!nm.trim() || createTier.isPending}
            className={nm.trim() && !createTier.isPending ? '' : 'opacity-50'}
          >
            {createTier.isPending ? t.templates.saving : t.templates.addTier}
          </Btn>
        </div>
      )}

      {tiers.isLoading ? (
        <Empty text={t.templates.loadingTiers} />
      ) : (tiers.data ?? []).length === 0 ? (
        <Empty text={t.templates.emptyTiers} />
      ) : (
        <div className="flex flex-col gap-[11px]">
          {(tiers.data ?? []).map((tier) => (
            <div key={tier.id} className="flex items-center gap-[11px] rounded-[18px] border border-line bg-elev p-[15px]">
              <span className="h-[14px] w-[14px] shrink-0 rounded-full" style={{ background: tier.color ?? '#8E8E93' }} />
              <div className="min-w-0 flex-1">
                <div className="font-display text-[15.5px] font-bold text-text">{tier.name}</div>
                <div className="mt-px text-[12px] text-faint">
                  {tier.max_guests ? fmt(t.templates.tierMax, { n: tier.max_guests }) : t.templates.tierNoMax}
                  {tier.aliases.length > 0 ? ' · ' + tier.aliases.join(', ') : ''}
                </div>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={() => void remove(tier.id)}
                  disabled={deleteTier.isPending}
                  className="shrink-0 font-body text-[12.5px] font-semibold text-faint transition-[filter] hover:brightness-[1.2] disabled:opacity-50"
                >
                  {t.templates.removeTier}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
