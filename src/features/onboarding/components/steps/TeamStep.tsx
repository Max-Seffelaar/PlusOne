'use client';

/** Onboarding step 3 — invite the team (optional, #40). Inviting requires AAL2,
 *  which a brand-new owner has not set up yet, so invites are best-effort and the
 *  step is prominently skippable; MFA can be enrolled afterwards from the app.
 *  Finishing (send or skip) marks onboarding complete and moves to the app. */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Field, Label, Note, Btn } from '@/components/po/kit';
import { inviteUserAction } from '@/features/auth/invite-actions';
import { completeOnboardingAction } from '@/features/billing/actions';
import { WizardShell, WizardPanel } from '../WizardShell';

const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';

type Role = 'user_manager' | 'staff';
interface Row {
  id: number;
  email: string;
  role: Role;
}

const ROLE_LABEL: Record<Role, string> = { user_manager: 'Manager', staff: 'Host' };

export function TeamStep({ venueId }: { venueId: string }): JSX.Element {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([{ id: 0, email: '', role: 'staff' }]);
  const [nextId, setNextId] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [mfaBlocked, setMfaBlocked] = useState(false);
  const [pending, startTransition] = useTransition();

  const validRows = rows.filter((r) => /.+@.+\..+/.test(r.email.trim()));

  function update(id: number, patch: Partial<Row>): void {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function addRow(): void {
    setRows((rs) => [...rs, { id: nextId, email: '', role: 'staff' }]);
    setNextId((n) => n + 1);
  }
  function removeRow(id: number): void {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));
  }

  async function finish(): Promise<void> {
    await completeOnboardingAction({ venueId });
    router.push('/app');
  }

  function skip(): void {
    if (pending) return;
    startTransition(finish);
  }

  function send(): void {
    if (pending || validRows.length === 0) return;
    setError(null);
    startTransition(async () => {
      let blocked = false;
      for (const r of validRows) {
        const fd = new FormData();
        fd.set('venueId', venueId);
        fd.set('email', r.email.trim());
        fd.append('roles', r.role);
        const res = await inviteUserAction({ ok: false }, fd);
        if (!res.ok) {
          if (res.error && /MFA|authenticator/i.test(res.error)) {
            blocked = true;
          } else {
            setError(res.error ?? 'Kon de uitnodiging niet versturen.');
            return;
          }
        }
      }
      if (blocked) {
        setMfaBlocked(true);
        return;
      }
      await finish();
    });
  }

  return (
    <WizardShell
      current={3}
      panel={
        <WizardPanel
          title="Beter met je team"
          sub="Geef hosts en managers toegang met de juiste rollen en quota."
          bullets={[
            'Rollen bepalen wie wat mag',
            'Uitnodigen kan ook later',
            'Teamleden krijgen een eigen magic link per e-mail',
          ]}
        />
      }
      heading="Nodig je team uit"
      sub="Voeg hosts en managers toe. Of sla over en doe het later vanuit Team."
      footer={
        <div className="flex flex-col gap-[10px]">
          {error && <div className="text-[13.5px] text-[#ff9b9b]">{error}</div>}
          {mfaBlocked ? (
            <Btn kind="primary" full icon="arrowR" onClick={() => startTransition(finish)} disabled={pending}>
              {pending ? 'Bezig…' : 'Doorgaan naar dashboard'}
            </Btn>
          ) : (
            <Btn
              kind="primary"
              full
              icon="arrowR"
              onClick={send}
              disabled={pending || validRows.length === 0}
              className={validRows.length === 0 ? 'opacity-[0.45]' : ''}
            >
              {pending ? 'Bezig…' : 'Uitnodigingen versturen'}
            </Btn>
          )}
          <Btn kind="quiet" full onClick={skip} disabled={pending}>
            Overslaan
          </Btn>
        </div>
      }
    >
      {mfaBlocked && (
        <Note icon="shield">
          Stel eerst tweestapsverificatie in om teamleden uit te nodigen — dat is verplicht voor het
          toekennen van rollen (AAL2). Je rondt onboarding nu af en nodigt je team daarna uit vanuit
          <b> Team</b>.
        </Note>
      )}

      <div className="flex flex-col gap-[12px]">
        {rows.map((r) => (
          <div key={r.id} className="rounded-[16px] border border-line bg-elev p-[14px]">
            <div className="mb-[10px] flex items-center justify-between">
              <Label>Rol</Label>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(r.id)}
                  className={cn('text-[12.5px] font-semibold text-faint', press)}
                >
                  Verwijderen
                </button>
              )}
            </div>
            <div className="mb-[12px] flex gap-[8px]">
              {(['user_manager', 'staff'] as Role[]).map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => update(r.id, { role })}
                  className={cn(
                    'flex-1 rounded-[11px] border py-[10px] font-display text-[13.5px] font-bold',
                    press,
                    r.role === role
                      ? 'border-transparent bg-acc text-on-acc'
                      : 'border-line bg-elev2 text-dim'
                  )}
                >
                  {ROLE_LABEL[role]}
                </button>
              ))}
            </div>
            <Field
              icon="mail"
              placeholder="naam@venue.nl"
              value={r.email}
              onChange={(v) => update(r.id, { email: v })}
              inputMode="email"
            />
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRow}
        className={cn(
          'mt-[12px] flex w-full items-center justify-center gap-[8px] rounded-[14px] border border-dashed border-line py-[12px] font-display text-[14px] font-bold text-dim',
          press
        )}
      >
        Nog iemand toevoegen
      </button>
    </WizardShell>
  );
}
