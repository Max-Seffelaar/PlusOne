'use client';

import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/client';
import { usePoProfile, usePoSessions } from '@/features/po/hooks';
import { usePoUpdateProfile, usePoUpdateEmail, usePoRevokeOwnSession } from '@/features/po/mutations';
import { groupPoSessions } from '@/features/po/adapters';
import { PoMfaSheet } from '../../mfa-gate';
import { useNav } from '../../context';
import { Icon, type IconName } from '../../icon';
import { Avatar, Btn, Empty, Field, Label, Loading, MiniChip, Note, Scroll, Top, press } from '../../kit';
import { BottomBar, Sheet } from '../../shell';
import { CountrySelect, PhoneInput, phoneCountryOf, type CountryCode } from '../../phone-lazy';
import { col, FormError, signOutDevice } from './_shared';

// MFA row in the profile's security card (S4.3). MFA is OPTIONAL for every role
// (#20 refinement 2026-07-02): anyone can enable it (reusing the enroll step from
// mfa-gate: QR + 6-digit code) and disable it again. For admin/finance we still
// RECOMMEND it (`recommended`, was `mandatory`) — copy + chip only, never a gate.
// The verified factor is read client-side from GoTrue (Capacitor-safe, #37).
function MfaCard({ recommended }: { recommended: boolean }): JSX.Element {
  const [hasMfa, setHasMfa] = useState<boolean | null>(null); // null = still loading
  const [enroll, setEnroll] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setHasMfa(null);
    void createClient()
      .auth.mfa.listFactors()
      .then(({ data }) =>
        setHasMfa((data?.all ?? []).some((f) => f.factor_type === 'totp' && f.status === 'verified'))
      )
      .catch(() => setHasMfa(false));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Drop every verified TOTP factor. GoTrue requires an AAL2 session to unenroll
  // a verified factor; on failure we surface a retry hint rather than dead-ending.
  async function disable(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = (data?.all ?? []).filter((f) => f.factor_type === 'totp' && f.status === 'verified');
      for (const f of verified) {
        const { error: unErr } = await supabase.auth.mfa.unenroll({ factorId: f.id });
        if (unErr) throw unErr;
      }
      setConfirmDisable(false);
      refresh();
    } catch {
      setError(t.settings.profile.mfaDisableError);
    } finally {
      setBusy(false);
    }
  }

  const on = hasMfa === true;
  const sub = on
    ? t.settings.profile.mfaSubOn
    : recommended
      ? t.settings.profile.mfaSubRecommended
      : t.settings.profile.mfaSubOff;
  const chipLabel =
    hasMfa === null
      ? '…'
      : on
        ? t.settings.profile.mfaChipOn
        : recommended
          ? t.settings.profile.mfaChipRecommended
          : t.settings.profile.mfaChipOff;

  return (
    <div className="flex items-start gap-[12px] border-b border-line2 py-[14px]">
      <span className={cn('mt-px', recommended || on ? 'text-acc' : 'text-faint')}>
        <Icon name="shield" size={19} />
      </span>
      <div className="flex-1">
        <div className="text-[14.5px] font-semibold text-text">{t.settings.profile.mfaTitle}</div>
        <div className="mt-0.5 text-[12px] leading-[1.4] text-faint">{sub}</div>
        {hasMfa !== null && (
          <button
            type="button"
            onClick={() => (on ? setConfirmDisable(true) : setEnroll(true))}
            className={cn('mt-[7px] font-body text-[12.5px] font-bold', press, on ? 'text-faint' : 'text-acc')}
          >
            {on ? t.settings.profile.mfaDisable : t.settings.profile.mfaEnable}
          </button>
        )}
      </div>
      <MiniChip className={cn('border-transparent', recommended || on ? 'bg-acc-dim text-acc' : 'bg-elev2 text-faint')}>
        {chipLabel}
      </MiniChip>

      {enroll && (
        <PoMfaSheet
          title={t.settings.profile.mfaEnrollTitle}
          subtitle={t.settings.profile.mfaEnrollSubtitle}
          onClose={() => setEnroll(false)}
          onVerified={() => {
            setEnroll(false);
            refresh();
          }}
        />
      )}
      {confirmDisable && (
        <Sheet onClose={() => setConfirmDisable(false)} center={false}>
          <Note icon="warn">
            {t.settings.profile.mfaDisableNote}
          </Note>
          {error && (
            <p className="mb-1 text-[12.5px] text-red-300" role="alert">
              {error}
            </p>
          )}
          <Btn kind="primary" full icon="shield" className="mt-2" disabled={busy} onClick={() => void disable()}>
            {busy ? t.settings.profile.mfaDisabling : t.settings.profile.mfaDisableConfirm}
          </Btn>
          <Btn kind="ghost" full className="mt-2" onClick={() => setConfirmDisable(false)}>
            {t.settings.common.cancel}
          </Btn>
        </Sheet>
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
  const [phone, setPhone] = useState<string | undefined>(undefined);
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>('NL');
  const [email, setEmail] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [confirmLogoutAll, setConfirmLogoutAll] = useState(false);
  const [signingOut, setSigningOut] = useState<'local' | 'global' | null>(null);
  const [signOutErr, setSignOutErr] = useState(false);

  // Prefill the editable fields once the profile arrives (and keep them in sync
  // after a save re-fetches the row).
  useEffect(() => {
    if (!p) return;
    if (!loaded) {
      setFirstName(p.firstName);
      setLastName(p.lastName);
      setPhone(p.phone || undefined);
      void phoneCountryOf(p.phone).then((c) => {
        if (c) setPhoneCountry(c);
      });
      setEmail(p.email);
      setLoaded(true);
    }
  }, [p, loaded]);

  if (profileQ.isLoading || !loaded) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title={t.settings.profile.title} />
        <Scroll bottom={24}>
          <Empty text={profileQ.isError ? t.settings.profile.loadError : t.settings.profile.loading} />
        </Scroll>
      </div>
    );
  }
  if (!p) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title={t.settings.profile.title} />
        <Scroll bottom={24}>
          <Empty text={t.settings.profile.loadError} />
        </Scroll>
      </div>
    );
  }

  const nameChanged = firstName !== p.firstName || lastName !== p.lastName || (phone ?? '') !== p.phone;
  const profileValid = firstName.trim() !== '' && lastName.trim() !== '';
  const emailChanged = email.trim().toLowerCase() !== p.email.toLowerCase();
  const sessions = sessionsQ.data ?? [];
  const current = sessions.find((s) => s.current) ?? null;
  const others = sessions.filter((s) => !s.current);
  // Identical stale sessions (same device + IP) collapse into one row with a
  // count — 12 dev-login rows read as one "Chrome · Windows · 5 sessions".
  const otherGroups = groupPoSessions(others);
  const sessionIcon = (device: string): IconName =>
    /mac|windows|linux/i.test(device) ? 'grid' : 'user';

  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.settings.profile.title} />
      <Scroll bottom={130}>
        <div className="flex flex-col items-center px-0 pb-5 pt-1 text-center">
          <Avatar name={p.name || p.email} size={84} accent />
          <h2 className="mb-0 mt-4 font-display text-[26px] font-extrabold tracking-[-0.02em] text-text">{p.name || t.settings.profile.noName}</h2>
          <div className="mt-1 text-[13px] text-faint">{p.roleLabel}</div>
        </div>

        <Label className="mb-2">{t.settings.profile.firstNameLabel}</Label>
        <Field icon="user" value={firstName} onChange={setFirstName} placeholder={t.settings.profile.firstNamePlaceholder} className="mb-[14px]" />
        <Label className="mb-2">{t.settings.profile.lastNameLabel}</Label>
        <Field icon="user" value={lastName} onChange={setLastName} placeholder={t.settings.profile.lastNamePlaceholder} className="mb-[14px]" />
        <Label className="mb-2">{t.settings.profile.phoneLabel}</Label>
        <div className="mb-1.5 flex items-center gap-[11px] rounded-[14px] border border-line bg-elev px-[11px] py-[13px] transition-colors focus-within:border-acc">
          <CountrySelect value={phoneCountry} onChange={(c) => { setPhoneCountry(c); setPhone(undefined); }} />
          <span className="h-5 w-px shrink-0 bg-line" />
          <PhoneInput country={phoneCountry} value={phone} onChange={setPhone} placeholder={t.settings.profile.phonePlaceholder} className="min-w-0 flex-1 border-none bg-transparent font-body text-[16px] text-text outline-none placeholder:text-faint" />
        </div>
        <FormError error={updateProfile.isError ? updateProfile.error : null} />
        {updateProfile.isSuccess && !nameChanged && (
          <p className="mt-2 text-[12.5px] text-acc-soft">{t.settings.profile.profileSaved}</p>
        )}

        <Label className="mb-2 mt-[18px]">{t.settings.profile.emailLabel}</Label>
        <Field icon="mail" value={email} onChange={setEmail} inputMode="email" className="mb-1.5" />
        <div className="pl-0.5 text-[12px] leading-[1.4] text-faint">
          {t.settings.profile.emailNote}
        </div>
        {emailChanged && (
          <Btn kind="dark" full icon="mail" className="mt-3" disabled={updateEmail.isPending} onClick={() => updateEmail.mutate(email.trim())}>
            {updateEmail.isPending ? t.settings.profile.sending : t.settings.profile.changeEmail}
          </Btn>
        )}
        <FormError error={updateEmail.isError ? updateEmail.error : null} />
        {updateEmail.isSuccess && (
          <p className="mt-2 text-[12.5px] text-acc-soft">{t.settings.profile.emailSent}</p>
        )}

        <Label className="mb-[10px] mt-[18px]">{t.settings.profile.securityLabel}</Label>
        <div className="mb-[18px] rounded-[18px] border border-line bg-elev px-4 py-1">
          <MfaCard recommended={p.mfaRequired} />
          <div className="flex items-center gap-[12px] py-[14px]">
            <span className="text-faint">
              <Icon name="mail" size={19} />
            </span>
            <div className="flex-1">
              <div className="text-[14.5px] font-semibold text-text">{t.settings.profile.loginMethodTitle}</div>
              <div className="mt-0.5 text-[12px] text-faint">{t.settings.profile.loginMethodSub}</div>
            </div>
          </div>
        </div>

        <Label className="mb-[10px]">{t.settings.profile.sessionsLabel}</Label>
        {sessionsQ.isLoading ? (
          <Loading />
        ) : sessions.length === 0 ? (
          <Empty text={t.settings.profile.sessionsEmpty} />
        ) : (
          <div className="mb-3 rounded-[18px] border border-line bg-elev px-4 py-0.5">
            {current && (
              <div className={cn('flex items-center gap-[12px] py-[13px]', otherGroups.length > 0 && 'border-b border-line2')}>
                <span className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[11px] border border-line bg-elev2 text-acc">
                  <Icon name={sessionIcon(current.device)} size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[14px] font-semibold text-text">
                    <span className="truncate">{current.device}</span>
                    <span className="shrink-0 rounded-full bg-acc px-[9px] py-[3px] font-display text-[10.5px] font-bold text-on-acc">
                      {t.settings.profile.thisDevice}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-acc">
                    {current.where} · {current.last}
                  </div>
                </div>
              </div>
            )}
            {otherGroups.map((g, i) => (
              <div key={g.ids[0]} className={cn('flex items-center gap-[12px] py-[13px]', i < otherGroups.length - 1 && 'border-b border-line2')}>
                <span className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[11px] border border-line bg-elev2 text-faint">
                  <Icon name={sessionIcon(g.device)} size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-text">
                    {g.device}
                    {g.count > 1 && <span className="text-faint"> · {fmt(t.settings.profile.sessionCount, { n: g.count })}</span>}
                  </div>
                  <div className="mt-0.5 text-[12px] text-faint">
                    {g.where} · {g.last}
                  </div>
                </div>
                <MiniChip onClick={() => g.ids.forEach((id) => revokeSession.mutate(id))}>
                  {revokeSession.isPending && g.ids.includes(revokeSession.variables as string) ? '…' : t.settings.profile.logOut}
                </MiniChip>
              </div>
            ))}
          </div>
        )}
        <Btn
          kind="dark"
          full
          icon="logout"
          className="mb-2"
          disabled={signingOut !== null}
          onClick={() => {
            setSignOutErr(false);
            setSigningOut('local');
            // Fail-safe reject (local session not cleared, e.g. offline): no
            // redirect happens — recover the button and warn.
            void signOutDevice('local').catch(() => {
              setSigningOut(null);
              setSignOutErr(true);
            });
          }}
        >
          {signingOut === 'local' ? t.settings.profile.signingOut : t.settings.profile.signOut}
        </Btn>
        {others.length > 0 && (
          <Btn
            kind="ghost"
            full
            icon="logout"
            className="mb-[18px]"
            disabled={revokeSession.isPending || signingOut !== null}
            onClick={() => setConfirmLogoutAll(true)}
          >
            {t.settings.profile.logOutAll}
          </Btn>
        )}
        <FormError error={revokeSession.isError ? revokeSession.error : null} />
        {signOutErr && (
          <p className="mt-3 text-[12.5px] leading-[1.45] text-red-300" role="alert">
            {t.settings.profile.signOutFailed}
          </p>
        )}
      </Scroll>
      <BottomBar>
        <Btn
          kind="primary"
          full
          icon="check"
          disabled={!nameChanged || !profileValid || updateProfile.isPending}
          className={!nameChanged || !profileValid ? 'opacity-[0.45]' : ''}
          onClick={() => updateProfile.mutate({ firstName: firstName.trim(), lastName: lastName.trim(), phone: phone ?? '' })}
        >
          {updateProfile.isPending ? t.settings.profile.saving : t.settings.profile.save}
        </Btn>
      </BottomBar>
      {confirmLogoutAll && (
        <Sheet onClose={() => setConfirmLogoutAll(false)} center={false}>
          <Note icon="warn">{t.settings.profile.logoutAllConfirm}</Note>
          <Btn
            kind="primary"
            full
            icon="logout"
            className="mt-2"
            disabled={signingOut !== null}
            onClick={() => {
              setSignOutErr(false);
              setSigningOut('global');
              void signOutDevice('global').catch(() => {
                setSigningOut(null);
                setSignOutErr(true);
                setConfirmLogoutAll(false); // close the sheet so the error under the buttons shows
              });
            }}
          >
            {signingOut === 'global' ? t.settings.profile.loggingOut : t.settings.profile.logoutAllConfirmBtn}
          </Btn>
          <Btn kind="ghost" full className="mt-2" onClick={() => setConfirmLogoutAll(false)}>
            {t.settings.common.cancel}
          </Btn>
        </Sheet>
      )}
    </div>
  );
}
