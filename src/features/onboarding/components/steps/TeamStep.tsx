'use client';

/** Onboarding step 3 — invite the team (optional, #40). Inviting requires AAL2,
 *  which a brand-new owner has not set up yet, so invites are best-effort and the
 *  step is prominently skippable; MFA can be enrolled afterwards from the app.
 *  Finishing (send or skip) marks onboarding complete and moves to the app. */
import { type JSX, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Field, Label, Note, Btn, press } from '@/components/po/kit';
import { inviteUserAction } from '@/features/auth/invite-actions';
import { completeOnboardingAction } from '@/features/billing/actions';
import { WizardShell, WizardPanel } from '../WizardShell';

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
    // Land on Home (Max, 3/7 test round): a fresh owner should arrive at the
    // dashboard and orient first — not be pushed straight into event creation.
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
            setError(res.error ?? "Couldn't send the invite.");
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
          title="Better with your team"
          sub="Give hosts and managers access with the right roles and quota."
          bullets={[
            'Roles decide who can do what',
            'You can invite people later too',
            'Team members get their own magic link by email',
          ]}
        />
      }
      heading="Invite your team"
      sub="Add hosts and managers. Or skip and do it later from Team."
      footer={
        <div className="flex flex-col gap-[10px]">
          {error && <div className="text-[13.5px] text-[#ff9b9b]">{error}</div>}
          {mfaBlocked ? (
            <Btn kind="primary" full icon="arrowR" onClick={() => startTransition(finish)} disabled={pending}>
              {pending ? 'Working…' : 'Continue to dashboard'}
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
              {pending ? 'Working…' : 'Send invites'}
            </Btn>
          )}
          <Btn kind="quiet" full onClick={skip} disabled={pending}>
            Skip
          </Btn>
        </div>
      }
    >
      {mfaBlocked && (
        <Note icon="shield">
          Set up two-factor first to invite team members. It&apos;s required for granting roles (AAL2).
          You&apos;ll finish onboarding now and invite your team afterwards from
          <b> Team</b>.
        </Note>
      )}

      <div className="flex flex-col gap-[12px]">
        {rows.map((r) => (
          <div key={r.id} className="rounded-[16px] border border-line bg-elev p-[14px]">
            <div className="mb-[10px] flex items-center justify-between">
              <Label>Role</Label>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(r.id)}
                  className={cn('text-[12.5px] font-semibold text-faint', press)}
                >
                  Remove
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
              placeholder="name@venue.com"
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
        Add someone else
      </button>
    </WizardShell>
  );
}
