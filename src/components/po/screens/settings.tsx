'use client';

/** Settings cluster: Meer (hub), gebruikers/rollen, toelage, venue switch/beheer,
 *  persoonlijke gegevens + sessies, abonnement & facturen, importeren. */
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { account, allowance as allowanceData, venues } from '@/lib/po/data';
import type { Venue } from '@/lib/po/types';
import { VENUE_ROLES, ROLE_LABELS, canGrantRoles, requiresMfa, type VenueRole } from '@/features/auth/roles';
import { venueCapabilities } from '@/features/venues/access';
import {
  parseCsv,
  parsePastedList,
  dedupeWithin,
  normalizeEmail,
  normalizePhoneToDigits,
  normalizeImportPhone,
  normalizeImportBirthdate,
  csvFirstRowIsHeader,
} from '@/features/contacts/import/parse';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import {
  usePoTeam,
  usePoInvites,
  usePoSessions,
  usePoProfile,
  usePoVenueSettings,
  usePoSubscription,
  usePoContactKeys,
} from '@/features/po/hooks';
import {
  usePoInviteUser,
  usePoRevokeInvite,
  usePoUpdateMemberRoles,
  usePoRemoveMember,
  usePoSetDefaultQuota,
  usePoUpdateProfile,
  usePoUpdateEmail,
  usePoRevokeOwnSession,
  usePoUpdateVenueSettings,
  usePoImportContacts,
} from '@/features/po/mutations';
import type { PoSubscription, PoTeamMember } from '@/features/po/adapters';
import { useMfaGate, isAal2Error } from '../mfa-gate';
import { useNav, usePo } from '../context';
import { Icon, type IconName } from '../icon';
import { Avatar, Btn, Empty, Field, IconBtn, Label, MiniChip, Note, Row, Scroll, ToggleRow, Top } from '../kit';
import { BottomBar, Sheet } from '../shell';

const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';
const cardPress = 'transition-[border-color,transform] hover:border-white/[0.24] active:scale-[0.99]';
const col = 'flex h-full flex-col';
const iconSm = 'flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] border border-line text-faint';

/** Inline action error, matching the desktop forms' `text-red-300` treatment. */
function FormError({ error }: { error: unknown }): JSX.Element | null {
  if (!error) return null;
  const msg = error instanceof Error && error.message ? error.message : 'Er ging iets mis.';
  return (
    <p className="mt-3 text-[12.5px] leading-[1.45] text-red-300" role="alert">
      {msg}
    </p>
  );
}

/** Role multi-select rows, shared by the invite form and the member sheet. Only
 *  an admin may toggle the `admin` role (mirrors the escalation guard / RLS). */
function RolePicker({
  selected,
  toggle,
  callerIsAdmin,
}: {
  selected: VenueRole[];
  toggle: (r: VenueRole) => void;
  callerIsAdmin: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      {VENUE_ROLES.map((k) => {
        const on = selected.includes(k);
        const blocked = k === 'admin' && !callerIsAdmin;
        return (
          <button
            key={k}
            type="button"
            disabled={blocked}
            onClick={() => toggle(k)}
            className={cn(
              'flex items-center gap-[12px] rounded-[13px] border px-[14px] py-[13px] text-left',
              on ? 'border-transparent bg-acc-dim' : 'border-line bg-elev',
              blocked && 'opacity-40',
              !blocked && press,
            )}
          >
            <span
              className={cn(
                'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] border-2',
                on ? 'border-acc bg-acc' : 'border-ghost bg-transparent',
              )}
            >
              {on && <Icon name="check" size={13} stroke="#16132B" sw={3} />}
            </span>
            <span className="flex-1 font-display text-[14.5px] font-bold text-text">{ROLE_LABELS[k]}</span>
            {blocked && <span className="text-[11px] text-faint">alleen beheerder</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── MEER (settings tab) ──────────────────────────────────────────────────────
export function Meer(): JSX.Element {
  const nav = useNav();
  const { venue, statsVenues } = usePo();
  const { venueName, roles } = usePoIdentity();
  const canAudit = venueCapabilities(roles).viewAudit;
  const profile = usePoProfile();
  const subQ = usePoSubscription();
  const v = venue;
  // Live active-venue name + plan for the header card (the switcher behind it is
  // still mock — separate venue-switcher task).
  const displayVenue = venueName ?? v.name;
  const planLabel = subQ.data?.plan ?? null;
  const billingSub = subQ.data
    ? subQ.data.priceLabel.startsWith('€')
      ? `${subQ.data.plan} · ${subQ.data.priceLabel}/${subQ.data.period}`
      : subQ.data.plan
    : 'Beheer je abonnement';
  return (
    <div className={col}>
      <Top big title="Instellingen" />
      <Scroll bottom={100}>
        <button type="button" onClick={() => nav.push('venueswitch')} className={cn('mb-5 flex w-full items-center gap-[14px] rounded-[18px] border border-line bg-elev p-4 text-left', cardPress)}>
          <Avatar name={displayVenue} size={48} accent />
          <div className="min-w-0 flex-1">
            <div className="font-display text-[18px] font-bold text-text">{displayVenue}</div>
            <div className="text-[12.5px] text-faint">{profile.data?.name ?? account.user} · wissel van venue</div>
          </div>
          <span className="inline-flex items-center gap-[7px]">
            {planLabel && (
              <span className="rounded-full bg-acc px-[11px] py-[5px] font-display text-[11px] font-bold text-on-acc">{planLabel}</span>
            )}
            <span className="text-ghost">
              <Icon name="swap" size={18} />
            </span>
          </span>
        </button>
        <Label className="mb-1">Jouw bedrijf</Label>
        {statsVenues.length > 0 && (
          <Row
            icon="spark"
            title="Statistieken"
            sub="Opkomst, instroom & toevoegingen"
            onClick={() => nav.push('stats')}
            accent
          />
        )}
        {canAudit && (
          <Row
            icon="history"
            title="Audit log"
            sub="Wie deed wat, wanneer · MFA"
            onClick={() => nav.push('audit')}
            accent
          />
        )}
        <Row
          icon="bell"
          title="Aanvragen & verzoeken"
          sub="Quotum-verzoeken & landingpage-aanvragen"
          onClick={() => nav.push('aanvragen')}
          accent
        />
        <Row icon="user" title="Persoonlijke gegevens" sub="Profiel, e-mail & sessies" onClick={() => nav.push('profile')} />
        <Row icon="cal" title="Events & tiers" sub="Events aanmaken, tiers en aliassen" onClick={() => nav.push('eventbeheer')} />
        <Row icon="building" title="Venues" sub={`${venues.length} locaties · wisselen`} onClick={() => nav.push('venueswitch')} />
        <Row icon="cog" title="Venue beheren" sub="Naam, AVG-bewaartermijn, standaarden" onClick={() => nav.push('venuesettings')} />
        <Row icon="users" title="Gebruikers" sub="Uitnodigen, rollen en MFA" onClick={() => nav.push('gebruikers')} accent />
        {roles.includes('admin') && (
          <Row icon="lock" title="Sessies & beveiliging" sub="Apparaten van teamleden op afstand uitloggen · MFA" onClick={() => nav.push('adminsessions')} />
        )}
        <Row icon="ticket" title="Toelage per event" sub="Gasten-per-event per teamlid" onClick={() => nav.push('allowance')} />
        <Row icon="star" title="Permanente gasten" sub="Staan automatisch op elke gastenlijst" onClick={() => nav.push('vaste')} accent />
        <Row icon="contact" title="Adresboek" sub="Opgeslagen contacten herbruiken" onClick={() => nav.push('contacten')} accent />
        <Row icon="upload" title="Importeren" sub="Plak, CSV of telefooncontacten" onClick={() => nav.push('import')} />
        <Label className="mb-1 mt-[22px]">Abonnement</Label>
        <Row icon="spark" title="Abonnement & facturen" sub={billingSub} onClick={() => nav.push('billing')} accent right={<Icon name="chev" size={18} className="text-ghost" />} />
      </Scroll>
    </div>
  );
}

// ── GEBRUIKERS (pushed) — S6 Team-beheer, live ───────────────────────────────
export function Gebruikers(): JSX.Element {
  const nav = useNav();
  const { roles } = usePoIdentity();
  const caps = venueCapabilities(roles);
  const callerIsAdmin = roles.includes('admin');

  const team = usePoTeam();
  const invitesQ = usePoInvites();
  const inviteUser = usePoInviteUser();
  const revokeInvite = usePoRevokeInvite();
  const mfa = useMfaGate();

  const [invite, setInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [inviteRoles, setInviteRoles] = useState<VenueRole[]>(['staff']);
  const [quota, setQuota] = useState('');
  const [sheetMember, setSheetMember] = useState<PoTeamMember | null>(null);

  const toggleInviteRole = (r: VenueRole): void =>
    setInviteRoles((s) => (s.includes(r) ? s.filter((x) => x !== r) : [...s, r]));
  const sensitive = requiresMfa(inviteRoles);
  const canSubmit = /.+@.+\..+/.test(email) && inviteRoles.length > 0 && !inviteUser.isPending;

  // A member without team-read rights (e.g. plain staff) gets a permission state.
  if (!caps.viewTeam) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title="Gebruikers" />
        <Scroll bottom={24}>
          <Empty text="Je hebt geen rechten om het team te beheren." />
        </Scroll>
      </div>
    );
  }

  // ── Invite sub-form ──
  if (invite) {
    const submit = (): void =>
      inviteUser.mutate(
        { email: email.trim(), roles: inviteRoles, defaultQuota: quota === '' ? undefined : Number(quota) },
        {
          onSuccess: () => {
            setInvite(false);
            setEmail('');
            setInviteRoles(['staff']);
            setQuota('');
          },
          // AAL1 user → open the MFA step-up sheet and retry the invite after.
          onError: (e) => mfa.guard(e, submit),
        },
      );
    return (
      <div className={col}>
        <Top onBack={() => setInvite(false)} title="Gebruiker uitnodigen" />
        <Scroll bottom={130}>
          <Label className="mb-2">E-mailadres</Label>
          <Field icon="contact" placeholder="naam@venue.nl" value={email} onChange={setEmail} inputMode="email" autoFocus className="mb-[18px]" />
          <Label className="mb-[10px]">Rollen · meerdere mogelijk</Label>
          <RolePicker selected={inviteRoles} toggle={toggleInviteRole} callerIsAdmin={callerIsAdmin} />
          {sensitive && (
            <Note icon="shield">
              Beheerder en Financiën krijgen <b>verplichte MFA</b>. Bij de eerste login stelt de gebruiker een authenticator-app in.
            </Note>
          )}
          <Label className="mb-2 mt-[18px]">Standaardquotum · optioneel</Label>
          <Field
            icon="ticket"
            placeholder="bv. 5 gasten per event"
            value={quota}
            onChange={(v) => setQuota(v.replace(/[^0-9]/g, '').slice(0, 4))}
            inputMode="numeric"
            className="mb-1.5"
          />
          <div className="pl-0.5 text-[12px] leading-[1.4] text-faint">
            Wordt het standaardquotum zodra de uitnodiging is geaccepteerd. Leeg = de standaard van de venue.
          </div>
          <FormError error={inviteUser.isError && !isAal2Error(inviteUser.error) ? inviteUser.error : null} />
        </Scroll>
        <BottomBar>
          <Btn kind="primary" full icon="arrowR" disabled={!canSubmit} onClick={submit} className={canSubmit ? '' : 'opacity-[0.45]'}>
            {inviteUser.isPending ? 'Versturen…' : 'Verstuur uitnodiging'}
          </Btn>
        </BottomBar>
        {mfa.sheet}
      </div>
    );
  }

  // ── List view ──
  const teamCount = team.data?.length ?? 0;
  const inviteCount = invitesQ.data?.length ?? 0;
  return (
    <div className={col}>
      <Top
        onBack={nav.back}
        title="Gebruikers"
        sub={`${teamCount} ${teamCount === 1 ? 'teamlid' : 'teamleden'} · ${inviteCount} open`}
        right={caps.manageTeam ? <IconBtn name="plus" onClick={() => setInvite(true)} /> : undefined}
      />
      <Scroll bottom={24}>
        {(caps.manageTeam || caps.viewQuota) && (
          <div className="lg:mb-[18px] lg:flex lg:gap-3">
            {caps.manageTeam && (
              <Btn kind="dark" full icon="plus" className="mb-3 lg:mb-0 lg:w-auto" onClick={() => setInvite(true)}>
                Gebruiker uitnodigen
              </Btn>
            )}
            {caps.viewQuota && (
              <Btn kind="ghost" full icon="ticket" className="mb-[18px] lg:mb-0 lg:w-auto" onClick={() => nav.push('rollen')}>
                Standaardquota per teamlid
              </Btn>
            )}
          </div>
        )}
        <Label className="mb-[10px]">Team</Label>
        {team.isLoading ? (
          <Empty text="Laden…" />
        ) : team.isError ? (
          <Empty text="Kon het team niet laden." />
        ) : teamCount === 0 ? (
          <Empty text="Nog geen teamleden." />
        ) : (
          <div className="mb-5 flex flex-col gap-[9px] lg:grid lg:grid-cols-2 lg:gap-[10px]">
            {(team.data ?? []).map((t) => {
              const rowInner = (
                <>
                  <Avatar name={t.name} size={42} />
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[15px] font-bold text-text">{t.name}</div>
                    <div className="mt-0.5 text-[12px] text-faint">
                      {t.rolesLabel} · quotum {t.quota}
                    </div>
                  </div>
                  {requiresMfa(t.roles) && (
                    <MiniChip className="border-transparent bg-acc-dim text-acc">
                      <Icon name="shield" size={11} stroke="#B5A6FF" />
                      MFA
                    </MiniChip>
                  )}
                  {caps.manageTeam && (
                    <span className="inline-flex items-center gap-1 rounded-[9px] border border-line2 px-2 py-[5px] font-body text-[12px] font-semibold text-dim">
                      Beheer
                      <Icon name="chev" size={15} />
                    </span>
                  )}
                </>
              );
              return caps.manageTeam ? (
                <button
                  key={t.userId}
                  type="button"
                  onClick={() => setSheetMember(t)}
                  className={cn('flex items-center gap-[12px] rounded-[16px] border border-line bg-elev p-[13px] text-left', cardPress)}
                  aria-label={`Beheer ${t.name}`}
                >
                  {rowInner}
                </button>
              ) : (
                <div key={t.userId} className="flex items-center gap-[12px] rounded-[16px] border border-line bg-elev p-[13px]">
                  {rowInner}
                </div>
              );
            })}
          </div>
        )}
        <Label className="mb-[10px]">Openstaande uitnodigingen</Label>
        {invitesQ.isLoading ? (
          <Empty text="Laden…" />
        ) : inviteCount === 0 ? (
          <Empty text="Geen openstaande uitnodigingen." />
        ) : (
          <div className="flex flex-col gap-[9px] lg:grid lg:grid-cols-2 lg:gap-[10px]">
            {(invitesQ.data ?? []).map((iv) => (
              <div key={iv.id} className="flex items-center gap-[12px] rounded-[16px] border border-dashed border-line bg-elev p-[13px]">
                <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[13px] border border-line bg-elev2 text-faint">
                  <Icon name="contact" size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="overflow-hidden text-ellipsis whitespace-nowrap font-body text-[14px] font-semibold text-text">{iv.email}</div>
                  <div className="mt-0.5 text-[12px] text-faint">
                    {iv.rolesLabel} · verstuurd {iv.sentAt}
                  </div>
                </div>
                {caps.manageTeam && (
                  <MiniChip onClick={() => revokeInvite.mutate(iv.id)}>
                    {revokeInvite.isPending && revokeInvite.variables === iv.id ? '…' : 'Intrekken'}
                  </MiniChip>
                )}
              </div>
            ))}
          </div>
        )}
        <FormError error={revokeInvite.isError ? revokeInvite.error : null} />
      </Scroll>
      {sheetMember && <MemberSheet member={sheetMember} callerRoles={roles} onClose={() => setSheetMember(null)} />}
    </div>
  );
}

// Member action sheet: edit roles or revoke venue access. Both writes go through
// the AAL2 + escalation + last-admin guarded venues actions; the sheet only
// offers controls the caller may use and surfaces the action's copy on refusal.
function MemberSheet({
  member,
  callerRoles,
  onClose,
}: {
  member: PoTeamMember;
  callerRoles: VenueRole[];
  onClose: () => void;
}): JSX.Element {
  const updateRoles = usePoUpdateMemberRoles();
  const removeMember = usePoRemoveMember();
  const mfa = useMfaGate();
  const [roles, setRoles] = useState<VenueRole[]>(member.roles);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const callerIsAdmin = callerRoles.includes('admin');
  const canManageThis = canGrantRoles(callerRoles, member.roles);
  const toggle = (r: VenueRole): void => setRoles((s) => (s.includes(r) ? s.filter((x) => x !== r) : [...s, r]));
  const busy = updateRoles.isPending || removeMember.isPending;
  const saveRoles = (): void =>
    updateRoles.mutate({ userId: member.userId, roles }, { onSuccess: onClose, onError: (e) => mfa.guard(e, saveRoles) });
  const doRemove = (): void =>
    removeMember.mutate(member.userId, { onSuccess: onClose, onError: (e) => mfa.guard(e, doRemove) });
  const err =
    updateRoles.isError && !isAal2Error(updateRoles.error)
      ? updateRoles.error
      : removeMember.isError && !isAal2Error(removeMember.error)
        ? removeMember.error
        : null;

  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-4 flex items-center gap-[12px]">
        <Avatar name={member.name} size={44} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[16px] font-bold text-text">{member.name}</div>
          <div className="truncate text-[12px] text-faint">{member.email}</div>
        </div>
      </div>

      {!canManageThis ? (
        <Note icon="shield">Je mag dit lid niet beheren — alleen een beheerder kan een beheerder wijzigen of verwijderen.</Note>
      ) : confirmRemove ? (
        <>
          <Note icon="warn">
            <b>{member.name}</b> verliest toegang tot deze venue. Het account en toegang tot andere venues blijven intact (#24).
          </Note>
          <FormError error={err} />
          <Btn kind="primary" full icon="warn" className="mt-2" disabled={busy} onClick={doRemove}>
            {removeMember.isPending ? 'Intrekken…' : 'Ja, toegang intrekken'}
          </Btn>
          <Btn kind="ghost" full className="mt-2" onClick={() => setConfirmRemove(false)}>
            Annuleren
          </Btn>
        </>
      ) : (
        <>
          <Label className="mb-[10px]">Rollen</Label>
          <RolePicker selected={roles} toggle={toggle} callerIsAdmin={callerIsAdmin} />
          <FormError error={err} />
          <Btn
            kind="primary"
            full
            icon="check"
            className={cn('mt-4', roles.length === 0 && 'opacity-[0.45]')}
            disabled={roles.length === 0 || busy}
            onClick={saveRoles}
          >
            {updateRoles.isPending ? 'Opslaan…' : 'Rollen opslaan'}
          </Btn>
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            className={cn('mt-3 w-full cursor-pointer border-none bg-transparent text-center font-body text-[13px] font-semibold text-faint', press)}
          >
            Toegang tot deze venue intrekken
          </button>
        </>
      )}
      {mfa.sheet}
    </Sheet>
  );
}

// ── GEBRUIKERS & TOELAGES (pushed) — S6 default-quota, live ───────────────────
// Per-member DEFAULT quota (quotas.default_count, falling back to the venue
// default). Per-event overrides (event_quotas) live on the "Toelage per event"
// screen — out of scope here. Editing is admin-only + AAL2 (setDefaultQuota).
export function Rollen(): JSX.Element {
  const nav = useNav();
  const { roles } = usePoIdentity();
  const caps = venueCapabilities(roles);
  const team = usePoTeam();

  if (!caps.viewQuota) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title="Gebruikers & toelages" />
        <Scroll bottom={24}>
          <Empty text="Je hebt geen rechten om toelages te bekijken." />
        </Scroll>
      </div>
    );
  }

  const members = team.data ?? [];
  return (
    <div className={col}>
      <Top onBack={nav.back} title="Gebruikers & toelages" />
      <Scroll bottom={28}>
        <Note icon="ticket">
          Elk teamlid mag standaard een aantal gasten per event toevoegen.{' '}
          {caps.editQuota ? 'Elke wijziging komt in het audit log.' : 'Alleen een beheerder kan dit wijzigen.'}
        </Note>
        {team.isLoading ? (
          <Empty text="Laden…" />
        ) : team.isError ? (
          <Empty text="Kon de toelages niet laden." />
        ) : members.length === 0 ? (
          <Empty text="Nog geen teamleden." />
        ) : (
          <div className="flex flex-col gap-[11px]">
            {members.map((m) => (
              <MemberQuotaRow key={m.userId} member={m} canEdit={caps.editQuota} />
            ))}
          </div>
        )}
      </Scroll>
    </div>
  );
}

// One member's default-quota editor. Local stepper value re-syncs to the server
// value after a save (the team query refetches); a "Opslaan" chip appears only
// while the value differs. Read-only for finance.
function MemberQuotaRow({ member, canEdit }: { member: PoTeamMember; canEdit: boolean }): JSX.Element {
  const setQuota = usePoSetDefaultQuota();
  const mfa = useMfaGate();
  const [value, setValue] = useState(member.quota);
  useEffect(() => {
    setValue(member.quota);
  }, [member.quota]);
  const changed = value !== member.quota;
  const save = (): void =>
    setQuota.mutate({ userId: member.userId, defaultCount: value }, { onError: (e) => mfa.guard(e, save) });
  const stepBtn = cn('flex h-[42px] w-[42px] items-center justify-center rounded-[13px] border border-line bg-elev2 text-text', press);

  return (
    <div className="rounded-[16px] border border-line bg-elev p-[14px]">
      <div className="mb-3 flex items-center gap-[12px]">
        <Avatar name={member.name} size={40} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[15px] font-bold text-text">{member.name}</div>
          <div className="truncate text-[12px] text-faint">{member.rolesLabel}</div>
        </div>
        {canEdit && changed && (
          <MiniChip onClick={save} className="border-transparent bg-acc text-on-acc">
            {setQuota.isPending ? 'Opslaan…' : 'Opslaan'}
          </MiniChip>
        )}
      </div>
      {canEdit ? (
        <div className="flex items-center justify-between gap-[14px] rounded-[16px] bg-acc-dim p-[9px]">
          <button type="button" onClick={() => setValue((v) => Math.max(0, v - 1))} className={stepBtn} aria-label="Minder">
            <Icon name="minus" size={20} sw={2.4} />
          </button>
          <div className="text-center">
            <div className="font-display text-[26px] font-extrabold leading-none text-text">{value}</div>
            <div className="mt-0.5 text-[11px] text-dim">gasten / event</div>
          </div>
          <button type="button" onClick={() => setValue((v) => v + 1)} className={stepBtn} aria-label="Meer">
            <Icon name="plus" size={20} sw={2.4} stroke="#B5A6FF" />
          </button>
        </div>
      ) : (
        <div className="rounded-[14px] bg-elev2 px-[14px] py-[12px] text-center">
          <span className="font-display text-[18px] font-extrabold text-text">{member.quota}</span>
          <span className="ml-1.5 text-[12px] text-faint">gasten / event</span>
        </div>
      )}
      <FormError error={setQuota.isError && !isAal2Error(setQuota.error) ? setQuota.error : null} />
      {mfa.sheet}
    </div>
  );
}

// ── TOELAGE PER EVENT (pushed) ───────────────────────────────────────────────
export function Allowance(): JSX.Element {
  const nav = useNav();
  const [rows, setRows] = useState(allowanceData.rows.map((r) => ({ ...r })));
  const set = (name: string, v: number): void => setRows((rs) => rs.map((r) => (r.name === name ? { ...r, override: Math.max(0, v) } : r)));
  const stepBtn = cn('flex h-[46px] w-[46px] items-center justify-center rounded-[14px] border border-line bg-elev2 text-text', press);
  return (
    <div className={col}>
      <Top onBack={nav.back} title="Toelage per event" sub={allowanceData.event} right={<IconBtn name="cal" />} />
      <Scroll bottom={120}>
        <Note icon="ticket">
          Iedereen heeft een standaardquotum. Hier verhoog of verlaag je het <b>alleen voor dit event</b> — elke wijziging komt in het audit log.
        </Note>
        <Label className="mb-[10px]">Teamleden · {allowanceData.event}</Label>
        <div className="flex flex-col gap-[10px]">
          {rows.map((r) => {
            const changed = r.override !== r.base;
            return (
              <div key={r.name} className="rounded-[18px] border border-line bg-elev p-[14px]">
                <div className="mb-3 flex items-center gap-[12px]">
                  <Avatar name={r.name} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[15px] font-bold text-text">{r.name}</div>
                    <div className="text-[12px] text-faint">
                      {r.role} · standaard {r.base}
                    </div>
                  </div>
                  {changed && <MiniChip className="border-transparent bg-acc-dim text-acc">{r.override > r.base ? '+' + (r.override - r.base) : r.override - r.base} override</MiniChip>}
                </div>
                <div className="flex items-center justify-between gap-[14px] rounded-[16px] bg-acc-dim p-[9px]">
                  <button type="button" onClick={() => set(r.name, r.override - 1)} className={stepBtn} aria-label="Minder">
                    <Icon name="minus" size={20} sw={2.4} />
                  </button>
                  <div className="text-center">
                    <div className="font-display text-[26px] font-extrabold leading-none text-text">{r.override}</div>
                    <div className="mt-0.5 text-[11px] text-dim">plekken</div>
                  </div>
                  <button type="button" onClick={() => set(r.name, r.override + 1)} className={stepBtn} aria-label="Meer">
                    <Icon name="plus" size={20} sw={2.4} stroke="#B5A6FF" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Scroll>
      <BottomBar>
        <Btn kind="primary" full icon="check" onClick={() => nav.back()}>
          Toelages opslaan
        </Btn>
      </BottomBar>
    </div>
  );
}

// ── VENUE SWITCHER (pushed) ──────────────────────────────────────────────────
export function VenueSwitch(): JSX.Element {
  const nav = useNav();
  const { venue, switchVenue } = usePo();
  return (
    <div className={col}>
      <Top onBack={nav.back} title="Venues" sub="Wissel tussen je locaties" right={<IconBtn name="plus" onClick={() => nav.push('venuecreate')} />} />
      <Scroll bottom={24}>
        <Note icon="building">
          Je werkt nu in <b>{venue.name}</b>. Je account staat los van de venue — wisselen verandert niets aan je toegang elders.
        </Note>
        <Label className="mb-[10px]">Jouw venues · {venues.length}</Label>
        <div className="flex flex-col gap-[10px]">
          {venues.map((v) => {
            const cur = v.id === venue.id;
            return (
              <div key={v.id} className={cn('rounded-[18px] border p-[15px]', cur ? 'border-transparent bg-acc-dim' : 'border-line bg-elev')}>
                <div className="flex items-center gap-[13px]">
                  <Avatar name={v.name} size={46} accent={cur} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="font-display text-[16.5px] font-bold text-text">{v.name}</div>
                      {cur && <MiniChip className="border-transparent bg-white/[0.10] text-acc">HUIDIG</MiniChip>}
                    </div>
                    <div className={cn('mt-0.5 text-[12.5px]', cur ? 'text-dim' : 'text-faint')}>
                      {v.city} · {v.plan} · {v.events} events
                    </div>
                  </div>
                </div>
                <div className="mt-[13px] flex flex-wrap items-center gap-[7px]">
                  <div className="flex flex-1 flex-wrap gap-1.5">
                    {v.roles.map((ro) => (
                      <MiniChip key={ro}>{ro}</MiniChip>
                    ))}
                  </div>
                  {cur ? (
                    <Btn sm kind="ghost" icon="cog" onClick={() => nav.push('venuesettings', { id: v.id })}>
                      Beheren
                    </Btn>
                  ) : (
                    <Btn sm kind="primary" icon="swap" onClick={() => switchVenue(v)}>
                      Wissel
                    </Btn>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <Btn kind="dark" full icon="plus" className="mt-[14px]" onClick={() => nav.push('venuecreate')}>
          Nieuwe venue toevoegen
        </Btn>
      </Scroll>
    </div>
  );
}

// ── VENUE SETTINGS (pushed) — S8 Venue-instellingen, live ────────────────────
// Name + AVG retention + venue-default quota + the company/legal/finance/address
// profile (mirrors the desktop VenueSettingsForm). Admin edits; finance reads
// (RLS venues_update_admin). The action re-checks admin server-side.
export function VenueSettings({ venue }: { venue: Venue }): JSX.Element {
  const nav = useNav();
  const { roles, venueName } = usePoIdentity();
  const caps = venueCapabilities(roles);
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
      });
      setLoaded(true);
    }
  }, [s, loaded]);

  const canEdit = caps.editSettings;
  type StrField = 'name' | 'companyName' | 'kvkNumber' | 'vatNumber' | 'financeEmail' | 'addressLine' | 'postalCode' | 'city' | 'country';
  const editStr = (k: StrField, sanitize?: (v: string) => string) =>
    canEdit ? (v: string) => setForm((f) => ({ ...f, [k]: sanitize ? sanitize(v) : v })) : undefined;

  if (!caps.viewSettings) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title="Venue beheren" sub={venueName ?? venue.name} />
        <Scroll bottom={24}>
          <Empty text="Je hebt geen rechten om de venue-instellingen te bekijken." />
        </Scroll>
      </div>
    );
  }
  if ((settingsQ.isLoading || !loaded) && !settingsQ.isError) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title="Venue beheren" sub={venueName ?? venue.name} />
        <Scroll bottom={24}>
          <Empty text="Laden…" />
        </Scroll>
      </div>
    );
  }
  if (!s) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title="Venue beheren" sub={venueName ?? venue.name} />
        <Scroll bottom={24}>
          <Empty text="Kon de venue-instellingen niet laden." />
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
    form.country !== s.country;
  const canSave = canEdit && dirty && form.name.trim() !== '' && !save.isPending;

  return (
    <div className={col}>
      <Top onBack={nav.back} title="Venue beheren" sub={s.name} />
      <Scroll bottom={canEdit ? 120 : 28}>
        {!canEdit && <Note icon="shield">Je ziet de instellingen alleen-lezen. Alleen een beheerder kan ze wijzigen.</Note>}

        <Label className="mb-2">Naam</Label>
        <Field icon="building" value={form.name} onChange={editStr('name')} className="mb-[14px]" />
        <Label className="mb-2">Landingpage-basis</Label>
        <Field icon="link" value={`plus.one/${s.slug}`} className="mb-[18px]" />

        <Label className="mb-[10px]">Gastenlijst-standaarden</Label>
        <div className="mb-[18px] rounded-[18px] border border-line bg-elev px-4 py-1">
          <div className="flex items-center gap-[12px] py-[14px]">
            <div className="flex-1">
              <div className="text-[14.5px] font-semibold text-text">Standaard quotum per teamlid</div>
              <div className="mt-0.5 text-[12px] text-faint">Gasten-per-event, per persoon te overschrijven</div>
            </div>
            {canEdit ? (
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setForm((f) => ({ ...f, defaultPersonalQuota: Math.max(0, f.defaultPersonalQuota - 1) }))} className={cn(iconSm, press)} aria-label="Minder">
                  <Icon name="minus" size={16} />
                </button>
                <span className="min-w-[22px] text-center font-display text-[18px] font-extrabold text-text">{form.defaultPersonalQuota}</span>
                <button type="button" onClick={() => setForm((f) => ({ ...f, defaultPersonalQuota: f.defaultPersonalQuota + 1 }))} className={cn(iconSm, press, 'text-acc')} aria-label="Meer">
                  <Icon name="plus" size={16} />
                </button>
              </div>
            ) : (
              <span className="font-display text-[18px] font-extrabold text-text">{form.defaultPersonalQuota}</span>
            )}
          </div>
        </div>

        <Label className="mb-[10px]">Aan de deur</Label>
        <div className="mb-[18px] rounded-[18px] border border-line bg-elev px-4 py-1">
          <ToggleRow
            title="Uitchecken toestaan"
            sub="Mag een check-in aan de deur teruggedraaid worden? Per event te overschrijven."
            on={form.allowUncheck}
            set={(v) => canEdit && setForm((f) => ({ ...f, allowUncheck: v }))}
            last
          />
        </div>

        <Label className="mb-[10px]">AVG & bewaartermijn</Label>
        <div className="mb-[18px] rounded-[18px] border border-line bg-elev p-4">
          <div className="mb-[14px] text-[13.5px] leading-[1.5] text-dim">Gastdata wordt na deze termijn automatisch geanonimiseerd tot “Gast #X”. Het audit log blijft intact.</div>
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
                {m} mnd
              </button>
            ))}
          </div>
        </div>

        <Label className="mb-[10px]">Bedrijfsgegevens</Label>
        <Field icon="building" value={form.companyName} onChange={editStr('companyName')} placeholder="Bedrijfsnaam" className="mb-[14px]" />
        <div className="mb-[14px] flex gap-2">
          <Field icon="grid" value={form.kvkNumber} onChange={editStr('kvkNumber', (v) => v.replace(/[^0-9]/g, '').slice(0, 8))} inputMode="numeric" placeholder="KvK (8 cijfers)" className="flex-1" />
          <Field value={form.vatNumber} onChange={editStr('vatNumber')} placeholder="btw-nummer" className="flex-1" />
        </div>
        <Field icon="mail" value={form.financeEmail} onChange={editStr('financeEmail')} inputMode="email" placeholder="Factuur-e-mail" className="mb-[18px]" />

        <Label className="mb-[10px]">Adres</Label>
        <Field icon="pin" value={form.addressLine} onChange={editStr('addressLine')} placeholder="Straat en nummer" className="mb-[14px]" />
        <div className="mb-[14px] flex gap-2">
          <Field value={form.postalCode} onChange={editStr('postalCode')} placeholder="Postcode" className="flex-1" />
          <Field value={form.city} onChange={editStr('city')} placeholder="Stad" className="flex-[1.4]" />
        </div>
        <Field value={form.country} onChange={editStr('country')} placeholder="Land" className="mb-1.5" />

        <FormError error={save.isError ? save.error : null} />
        {save.isSuccess && !dirty && <p className="mt-3 text-[12.5px] text-acc-soft">Instellingen opgeslagen.</p>}
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
            {save.isPending ? 'Opslaan…' : 'Opslaan'}
          </Btn>
        </BottomBar>
      )}
    </div>
  );
}

// ── PERSOONLIJKE GEGEVENS (pushed) — S7 Profiel & Sessies, live ──────────────
export function Profile(): JSX.Element {
  const nav = useNav();
  const profileQ = usePoProfile();
  const sessionsQ = usePoSessions();
  const updateProfile = usePoUpdateProfile();
  const updateEmail = usePoUpdateEmail();
  const revokeSession = usePoRevokeOwnSession();

  const p = profileQ.data ?? null;
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [confirmLogoutAll, setConfirmLogoutAll] = useState(false);

  // Prefill the editable fields once the profile arrives (and keep them in sync
  // after a save re-fetches the row).
  useEffect(() => {
    if (!p) return;
    if (!loaded) {
      setFirstName(p.firstName);
      setLastName(p.lastName);
      setPhone(p.phone);
      setEmail(p.email);
      setLoaded(true);
    }
  }, [p, loaded]);

  if (profileQ.isLoading || !loaded) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title="Persoonlijke gegevens" />
        <Scroll bottom={24}>
          <Empty text={profileQ.isError ? 'Kon je profiel niet laden.' : 'Laden…'} />
        </Scroll>
      </div>
    );
  }
  if (!p) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title="Persoonlijke gegevens" />
        <Scroll bottom={24}>
          <Empty text="Kon je profiel niet laden." />
        </Scroll>
      </div>
    );
  }

  const nameChanged = firstName !== p.firstName || lastName !== p.lastName || phone !== p.phone;
  const profileValid = firstName.trim() !== '' && lastName.trim() !== '';
  const emailChanged = email.trim().toLowerCase() !== p.email.toLowerCase();
  const sessions = sessionsQ.data ?? [];
  const others = sessions.filter((s) => !s.current);
  const sessionIcon = (device: string): IconName =>
    /mac|windows|linux/i.test(device) ? 'grid' : 'user';

  return (
    <div className={col}>
      <Top onBack={nav.back} title="Persoonlijke gegevens" />
      <Scroll bottom={130}>
        <div className="flex flex-col items-center px-0 pb-5 pt-1 text-center">
          <Avatar name={p.name || p.email} size={84} accent />
          <h2 className="mb-0 mt-4 font-display text-[26px] font-extrabold tracking-[-0.02em] text-text">{p.name || 'Naamloos'}</h2>
          <div className="mt-1 text-[13px] text-faint">{p.roleLabel}</div>
        </div>

        <Label className="mb-2">Voornaam</Label>
        <Field icon="user" value={firstName} onChange={setFirstName} placeholder="Voornaam" className="mb-[14px]" />
        <Label className="mb-2">Achternaam</Label>
        <Field icon="user" value={lastName} onChange={setLastName} placeholder="Achternaam" className="mb-[14px]" />
        <Label className="mb-2">Telefoon</Label>
        <Field icon="phone" value={phone} onChange={setPhone} inputMode="tel" placeholder="06 …" className="mb-1.5" />
        <FormError error={updateProfile.isError ? updateProfile.error : null} />
        {updateProfile.isSuccess && !nameChanged && (
          <p className="mt-2 text-[12.5px] text-acc-soft">Profiel opgeslagen.</p>
        )}

        <Label className="mb-2 mt-[18px]">E-mailadres</Label>
        <Field icon="mail" value={email} onChange={setEmail} inputMode="email" className="mb-1.5" />
        <div className="pl-0.5 text-[12px] leading-[1.4] text-faint">
          Alleen jij kunt je e-mailadres wijzigen — nooit een venue-admin. We sturen een bevestiging naar je oude én nieuwe adres.
        </div>
        {emailChanged && (
          <Btn kind="dark" full icon="mail" className="mt-3" disabled={updateEmail.isPending} onClick={() => updateEmail.mutate(email.trim())}>
            {updateEmail.isPending ? 'Versturen…' : 'Wijzig e-mailadres'}
          </Btn>
        )}
        <FormError error={updateEmail.isError ? updateEmail.error : null} />
        {updateEmail.isSuccess && (
          <p className="mt-2 text-[12.5px] text-acc-soft">Bevestig de wijziging via de link die we naar je oude én nieuwe adres sturen.</p>
        )}

        <Label className="mb-[10px] mt-[18px]">Beveiliging</Label>
        <div className="mb-[18px] rounded-[18px] border border-line bg-elev px-4 py-1">
          <div className="flex items-center gap-[12px] border-b border-line2 py-[14px]">
            <span className={p.mfaRequired ? 'text-acc' : 'text-faint'}>
              <Icon name="shield" size={19} />
            </span>
            <div className="flex-1">
              <div className="text-[14.5px] font-semibold text-text">Tweestapsverificatie</div>
              <div className="mt-0.5 text-[12px] text-faint">
                {p.mfaRequired ? 'Verplicht voor jouw rol · authenticator-app' : 'Optioneel voor jouw rol'}
              </div>
            </div>
            <MiniChip className={cn('border-transparent', p.mfaRequired ? 'bg-acc-dim text-acc' : 'bg-elev2 text-faint')}>
              {p.mfaRequired ? 'VERPLICHT' : 'OPTIONEEL'}
            </MiniChip>
          </div>
          <div className="flex items-center gap-[12px] py-[14px]">
            <span className="text-faint">
              <Icon name="mail" size={19} />
            </span>
            <div className="flex-1">
              <div className="text-[14.5px] font-semibold text-text">Inlogmethode</div>
              <div className="mt-0.5 text-[12px] text-faint">Passwordless · e-mailcode (OTP)</div>
            </div>
          </div>
        </div>

        <Label className="mb-[10px]">Actieve sessies</Label>
        {sessionsQ.isLoading ? (
          <Empty text="Laden…" />
        ) : sessions.length === 0 ? (
          <Empty text="Geen actieve sessies." />
        ) : (
          <div className="mb-3 rounded-[18px] border border-line bg-elev px-4 py-0.5">
            {sessions.map((se, i) => (
              <div key={se.id} className={cn('flex items-center gap-[12px] py-[13px]', i < sessions.length - 1 && 'border-b border-line2')}>
                <span className={cn('flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[11px] border border-line bg-elev2', se.current ? 'text-acc' : 'text-faint')}>
                  <Icon name={sessionIcon(se.device)} size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-text">{se.device}</div>
                  <div className={cn('mt-0.5 text-[12px]', se.current ? 'text-acc' : 'text-faint')}>
                    {se.where} · {se.last}
                  </div>
                </div>
                {!se.current && (
                  <MiniChip onClick={() => revokeSession.mutate(se.id)}>
                    {revokeSession.isPending && revokeSession.variables === se.id ? '…' : 'Uitloggen'}
                  </MiniChip>
                )}
              </div>
            ))}
          </div>
        )}
        {others.length > 0 && (
          <Btn
            kind="ghost"
            full
            icon="logout"
            className="mb-[18px]"
            disabled={revokeSession.isPending}
            onClick={() => setConfirmLogoutAll(true)}
          >
            Alle andere apparaten uitloggen
          </Btn>
        )}
        <FormError error={revokeSession.isError ? revokeSession.error : null} />
      </Scroll>
      <BottomBar>
        <Btn
          kind="primary"
          full
          icon="check"
          disabled={!nameChanged || !profileValid || updateProfile.isPending}
          className={!nameChanged || !profileValid ? 'opacity-[0.45]' : ''}
          onClick={() => updateProfile.mutate({ firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim() })}
        >
          {updateProfile.isPending ? 'Opslaan…' : 'Opslaan'}
        </Btn>
      </BottomBar>
      {confirmLogoutAll && (
        <Sheet onClose={() => setConfirmLogoutAll(false)} center={false}>
          <Note icon="warn">
            Je logt {others.length} {others.length === 1 ? 'ander apparaat' : 'andere apparaten'} uit. Op {others.length === 1 ? 'dat apparaat' : 'die apparaten'} moet daarna opnieuw worden ingelogd. Dit apparaat blijft ingelogd.
          </Note>
          <FormError error={revokeSession.isError ? revokeSession.error : null} />
          <Btn
            kind="primary"
            full
            icon="logout"
            className="mt-2"
            disabled={revokeSession.isPending}
            onClick={() => {
              others.forEach((s) => revokeSession.mutate(s.id));
              setConfirmLogoutAll(false);
            }}
          >
            {revokeSession.isPending ? 'Uitloggen…' : `Ja, log ${others.length} ${others.length === 1 ? 'apparaat' : 'apparaten'} uit`}
          </Btn>
          <Btn kind="ghost" full className="mt-2" onClick={() => setConfirmLogoutAll(false)}>
            Annuleren
          </Btn>
        </Sheet>
      )}
    </div>
  );
}

// ── ABONNEMENT & FACTUREN (pushed) — Billing stub, live read-only ────────────
// Reads the venue entitlement from features/billing (the subscriptions row) and
// nothing else: no Stripe call, no checkout, no invoices yet (Fase 13, #32). Any
// member may view (RLS subscriptions_select_member).
const SUB_STATUS: Record<PoSubscription['status'], { label: string; chip: string }> = {
  trialing: { label: 'PROEFPERIODE', chip: 'bg-acc-dim text-acc' },
  active: { label: 'ACTIEF', chip: 'bg-acc-dim text-acc' },
  comped: { label: 'GRATIS · PILOT', chip: 'bg-acc-dim text-acc' },
  past_due: { label: 'BETALING MISLUKT', chip: 'bg-red-300/15 text-red-300' },
  canceled: { label: 'OPGEZEGD', chip: 'bg-elev2 text-faint' },
};

export function Billing(): JSX.Element {
  const nav = useNav();
  const subQ = usePoSubscription();
  const sub = subQ.data ?? null;
  return (
    <div className={col}>
      <Top onBack={nav.back} title="Abonnement & facturen" />
      <Scroll bottom={28}>
        {subQ.isLoading ? (
          <Empty text="Laden…" />
        ) : subQ.isError ? (
          <Empty text="Kon het abonnement niet laden." />
        ) : !sub ? (
          <Empty text="Nog geen abonnement voor deze venue." />
        ) : (
          <BillingBody sub={sub} />
        )}
      </Scroll>
    </div>
  );
}

function BillingBody({ sub }: { sub: PoSubscription }): JSX.Element {
  const st = SUB_STATUS[sub.status] ?? { label: sub.status.toUpperCase(), chip: 'bg-elev2 text-faint' };
  return (
    <>
      <div className="mb-[14px] rounded-[18px] bg-acc-dim p-5">
        <div className="mb-[14px] flex items-center justify-between">
          <div className="flex items-center gap-[10px]">
            <Icon name="spark" size={20} stroke="#B5A6FF" />
            <span className="font-display text-[20px] font-extrabold text-text">{sub.plan}</span>
          </div>
          <MiniChip className={cn('border-transparent', st.chip)}>{st.label}</MiniChip>
        </div>
        <div className="mb-4 flex items-end gap-1.5">
          <span className="font-display text-[36px] font-extrabold leading-none text-text">{sub.priceLabel}</span>
          {sub.priceLabel.startsWith('€') && <span className="pb-[5px] text-[14px] text-dim">/ {sub.period}</span>}
        </div>
        <div className="grid grid-cols-2 gap-[10px]">
          {([['Events', sub.events], ['Venue', sub.venueLabel], ['Verlengt', sub.renews], ['Status', st.label]] as const).map(([k, val]) => (
            <div key={k}>
              <div className="text-[11.5px] text-dim">{k}</div>
              <div className="mt-0.5 font-display text-[14px] font-bold text-text">{val}</div>
            </div>
          ))}
        </div>
      </div>

      {sub.status === 'past_due' && (
        <Note icon="warn">Je laatste betaling is mislukt. Werk je betaalmethode bij in het betaalportaal om onderbreking te voorkomen.</Note>
      )}

      <Label className="mb-[10px]">Betaalmethode</Label>
      <div className="mb-2 flex items-center gap-[13px] rounded-[18px] border border-line bg-elev p-4">
        <span className="flex h-[42px] w-[42px] items-center justify-center rounded-[12px] border border-line bg-elev2 text-acc">
          <Icon name="card" size={20} />
        </span>
        <div className="flex-1">
          <div className="text-[14.5px] font-semibold text-text">SEPA-incasso &amp; iDEAL</div>
          <div className="mt-0.5 text-[12.5px] text-faint">Beheerd via de betaalprovider</div>
        </div>
      </div>
      <div className="mb-[18px] flex items-start gap-[7px] pl-0.5 text-[12px] text-faint">
        <Icon name="shield" size={13} className="text-ghost" />
        <span className="leading-[1.45]">Betalingen via SEPA-incasso &amp; iDEAL. We bewaren nooit zelf je IBAN — dat regelt de betaalprovider.</span>
      </div>

      <Label className="mb-[10px]">Facturen</Label>
      <div className="rounded-[18px] border border-dashed border-line bg-elev p-5 text-center">
        <div className="text-[13.5px] leading-[1.5] text-faint">Facturen en het betaalportaal verschijnen hier zodra facturatie live gaat.</div>
      </div>
    </>
  );
}

// ── IMPORTEREN (pushed) — S3 Import, live ────────────────────────────────────
// Paste a list or a CSV → parse + coerce (phone to E.164, plausible birthdate) →
// dedupe within the file → preview each row as NIEUW or BESTAAT AL against the
// venue's existing contacts (same email-first-else-phone match as upsert_contacts)
// → commit via the idempotent RPC. Manager-only (the action self-guards). Phone
// contacts / "vorig event" sources come later.
type ImportSource = 'paste' | 'csv';

export function Import(): JSX.Element {
  const nav = useNav();
  const { venueId } = usePoIdentity();
  const importMut = usePoImportContacts();
  const keysQ = usePoContactKeys();

  const [source, setSource] = useState<ImportSource>('paste');
  const [text, setText] = useState('');
  // CSV header handling (Q12): auto-detect a recognised header, but let the user
  // override per file (null = follow auto-detect). Only relevant for CSV.
  const [headerOverride, setHeaderOverride] = useState<boolean | null>(null);
  const autoHeader = source === 'csv' && csvFirstRowIsHeader(text);
  const firstRowIsHeader = headerOverride ?? autoHeader;

  // Parse → coerce to what the import accepts (so the preview's dedup decision
  // matches the real import) → dedupe within the file.
  const { rows, intraSkipped } = useMemo(() => {
    const parsed = source === 'csv' ? parseCsv(text, { firstRowIsHeader }) : parsePastedList(text);
    const coerced = parsed.map((r) => ({
      ...r,
      phone: normalizeImportPhone(r.phone),
      birthdate: normalizeImportBirthdate(r.birthdate),
    }));
    const { rows: deduped, skipped } = dedupeWithin(coerced);
    return { rows: deduped, intraSkipped: skipped };
  }, [text, source, firstRowIsHeader]);

  // Classify against existing contacts exactly like the RPC: e-mail first, else
  // phone digits. While the keys load, nothing is marked as a duplicate yet.
  const emails = keysQ.data?.emails;
  const phones = keysQ.data?.phones;
  const classified = rows.map((r) => {
    const e = normalizeEmail(r.email);
    const p = normalizePhoneToDigits(r.phone);
    const exists = (!!e && !!emails?.has(e)) || (!!p && !!phones?.has(p));
    return { row: r, exists };
  });
  const total = classified.length;
  const dupCount = classified.filter((c) => c.exists).length;
  const newCount = total - dupCount;

  const result = importMut.data && importMut.data.ok ? importMut.data : null;
  const canImport = !!venueId && total > 0 && !importMut.isPending;

  const onPickFile = (file: File | undefined): void => {
    if (!file) return;
    setSource('csv');
    setHeaderOverride(null); // re-auto-detect for the new file
    void file.text().then(setText);
  };

  const commit = (): void => {
    if (!canImport || !venueId) return;
    importMut.mutate({ venueId, rows });
  };

  // Success state — the per-row outcome from the RPC.
  if (result) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title="Importeren" />
        <Scroll bottom={100}>
          <div className="mb-4 flex flex-col items-center gap-3 rounded-[18px] bg-acc-dim p-6 text-center">
            <span className="flex h-[52px] w-[52px] items-center justify-center rounded-[16px] bg-acc">
              <Icon name="check2" size={28} stroke="#16132B" sw={2.4} />
            </span>
            <div className="font-display text-[22px] font-extrabold text-text">Klaar!</div>
            <div className="text-[13.5px] leading-[1.5] text-text">
              {result.inserted} nieuw · {result.updated} bijgewerkt · {result.skipped} overgeslagen
            </div>
          </div>
          <Note icon="contact">
            Nieuwe en bijgewerkte contacten staan nu in je adresboek. Dubbele zijn samengevoegd — bestaande gegevens blijven behouden.
          </Note>
        </Scroll>
        <BottomBar>
          <Btn
            kind="primary"
            full
            icon="contact"
            onClick={() => {
              importMut.reset();
              nav.back();
            }}
          >
            Naar adresboek
          </Btn>
        </BottomBar>
      </div>
    );
  }

  const sources: [ImportSource | 'soon', IconName, string][] = [
    ['paste', 'paste', 'Plak lijst'],
    ['csv', 'upload', 'CSV'],
    ['soon', 'contact', 'Telefoon'],
    ['soon', 'ticket', 'Vorig event'],
  ];

  return (
    <div className={col}>
      <Top onBack={nav.back} title="Importeren" />
      <Scroll bottom={total > 0 ? 110 : 40}>
        <div className="mb-[14px] text-[13.5px] leading-[1.5] text-faint">
          Iedereen die ooit op een lijst stond in één keer in je adresboek. Dubbele worden automatisch herkend en gekoppeld.
        </div>
        <div className="po-scroll mb-4 flex gap-2 overflow-x-auto">
          {sources.map(([key, ic, l]) => {
            const on = key === source;
            const soon = key === 'soon';
            return (
              <button
                key={l}
                type="button"
                disabled={soon}
                onClick={() => {
                  if (soon) return;
                  setSource(key as ImportSource);
                  setHeaderOverride(null);
                }}
                className={cn(
                  'inline-flex shrink-0 items-center gap-[7px] rounded-full border px-[14px] py-[9px] font-display text-[13px] font-bold',
                  press,
                  on ? 'border-transparent bg-acc text-on-acc' : 'border-line text-dim',
                  soon && 'opacity-40',
                )}
              >
                <Icon name={ic} size={15} sw={2.1} />
                {l}
                {soon && <span className="text-[10px] font-bold text-faint">binnenkort</span>}
              </button>
            );
          })}
        </div>

        {source === 'csv' && (
          <>
            <label className={cn('mb-3 flex cursor-pointer items-center justify-center gap-2 rounded-[14px] border border-dashed border-line bg-elev py-[14px] font-display text-[14px] font-bold text-text', press)}>
              <Icon name="upload" size={17} />
              Kies een CSV-bestand
              <input type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => onPickFile(e.target.files?.[0])} />
            </label>
            {text.trim() !== '' && (
              <button
                type="button"
                onClick={() => setHeaderOverride(!firstRowIsHeader)}
                className={cn('mb-3 flex w-full items-center gap-[11px] rounded-[13px] border border-line bg-elev px-[13px] py-[11px] text-left', press)}
              >
                <span className={cn('flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] border-2', firstRowIsHeader ? 'border-acc bg-acc' : 'border-ghost bg-transparent')}>
                  {firstRowIsHeader && <Icon name="check" size={13} stroke="#16132B" sw={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[13.5px] font-bold text-text">Eerste regel is een koprij</span>
                  <span className="block text-[11.5px] text-faint">Zet uit als je lijst meteen met een contact begint</span>
                </span>
              </button>
            )}
          </>
        )}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder={
            source === 'csv'
              ? 'naam,email,telefoon,rol\nAnouk Smit,anouk@mail.nl,0612345678,vip'
              : 'Anouk Smit, anouk@mail.nl\nPim Scholten\nFemke Bakker, +31612345678'
          }
          className="mb-4 w-full resize-y rounded-[14px] border border-line bg-elev p-[14px] font-body text-[14.5px] leading-[1.5] text-text outline-none placeholder:text-faint"
        />

        {total > 0 && (
          <>
            <div className="mb-[10px] flex items-center justify-between">
              <Label>
                Herkend · {total} {total === 1 ? 'contact' : 'contacten'}
              </Label>
              <div className="flex gap-1.5">
                <MiniChip className="border-transparent bg-acc-dim text-acc">{newCount} nieuw</MiniChip>
                {dupCount > 0 && <MiniChip>{dupCount} bestaat al</MiniChip>}
              </div>
            </div>
            {keysQ.isLoading && <div className="mb-2 text-[12px] text-faint">Dubbele controleren…</div>}
            <div className="flex flex-col gap-2">
              {classified.slice(0, 50).map(({ row, exists }, i) => (
                <div key={`${row.fullName}-${i}`} className="flex items-center gap-[11px] rounded-[13px] border border-line bg-elev px-[12px] py-[10px]">
                  <Avatar name={row.fullName} size={34} accent={exists} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold text-text">{row.fullName}</div>
                    {(row.email || row.phone) && <div className="truncate text-[11.5px] text-faint">{row.email ?? row.phone}</div>}
                  </div>
                  <span className={cn('shrink-0 rounded-[7px] px-2 py-[3px] text-[10.5px] font-bold', exists ? 'bg-acc-dim text-acc' : 'border border-line text-text')}>
                    {exists ? 'BESTAAT AL' : 'NIEUW'}
                  </span>
                </div>
              ))}
            </div>
            {total > 50 && <div className="mt-2 text-center text-[12px] text-faint">+{total - 50} meer worden ook geïmporteerd</div>}
            {intraSkipped > 0 && <div className="mt-2 text-[12px] text-faint">{intraSkipped} dubbele in je lijst overgeslagen.</div>}
          </>
        )}

        {importMut.isError && (
          <div className="mt-3 flex items-center gap-[9px] rounded-[13px] border border-acc bg-acc-dim px-[14px] py-[11px] text-[13px] text-text">
            <Icon name="warn" size={16} stroke="#B5A6FF" />
            <span className="flex-1">{importMut.error?.message ?? 'Importeren mislukt.'}</span>
          </div>
        )}
      </Scroll>
      {total > 0 && (
        <BottomBar>
          <Btn kind="primary" full icon="check" disabled={!canImport} className={canImport ? '' : 'opacity-[0.45]'} onClick={commit}>
            {importMut.isPending ? 'Importeren…' : `Importeer ${total} ${total === 1 ? 'contact' : 'contacten'}`}
          </Btn>
        </BottomBar>
      )}
    </div>
  );
}
