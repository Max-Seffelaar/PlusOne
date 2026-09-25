'use client';

/** Onboarding step 3: invite the team (optional, #40), so the step is
 *  prominently skippable. Inviting is role-only; MFA is optional for every role
 *  (#20, 2026-07-01), so nothing here waits on two-factor.
 *  Finishing (send or skip) marks onboarding complete and moves to the app.
 *  The store-review demo account (86ey6bfug) gets the invite refusal instead of
 *  the form, and only the skip (which completes onboarding on its own venue). */
import { type JSX, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Field, Label, Btn, RefusedAction, press } from '@/components/po/kit';
import { inviteUserAction } from '@/features/auth/invite-actions';
import { completeOnboardingAction } from '@/features/billing/actions';
import { WizardShell, WizardPanel } from '../WizardShell';

type Role = 'user_manager' | 'staff';
interface Row {
  id: number;
  email: string;
  role: Role;
}

const c = t.onboarding.teamStep;
const ROLE_LABEL: Record<Role, string> = { user_manager: c.roleManager, staff: c.roleHost };

export function TeamStep({ venueId, demoAccount = false }: { venueId: string; demoAccount?: boolean }): JSX.Element {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([{ id: 0, email: '', role: 'staff' }]);
  const [nextId, setNextId] = useState(1);
  const [error, setError] = useState<string | null>(null);
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
    const res = await completeOnboardingAction({ venueId });
    if (!res.ok) {
      setError(res.message ?? c.finishError);
      return;
    }
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
      for (const r of validRows) {
        const fd = new FormData();
        fd.set('venueId', venueId);
        fd.set('email', r.email.trim());
        fd.append('roles', r.role);
        const res = await inviteUserAction({ ok: false }, fd);
        if (!res.ok) {
          setError(res.error ?? c.sendError);
          return;
        }
      }
      await finish();
    });
  }

  const panel = (
    <WizardPanel title={c.panelTitle} sub={c.panelSub} bullets={[c.panelBullet1, c.panelBullet2, c.panelBullet3]} />
  );

  if (demoAccount) {
    return (
      <WizardShell
        current={3}
        panel={panel}
        heading={c.heading}
        sub={c.sub}
        footer={
          <>
            {error && <div className="mb-3 text-[13.5px] text-[#ff9b9b]">{error}</div>}
            <Btn kind="dark" full onClick={skip} disabled={pending}>
              {c.skip}
            </Btn>
          </>
        }
      >
        <RefusedAction label={c.send} reason={t.auth.demoNoInvites} />
      </WizardShell>
    );
  }

  return (
    <WizardShell
      current={3}
      panel={panel}
      heading={c.heading}
      sub={c.sub}
      footer={
        <div className="flex flex-col gap-[10px]">
          {error && <div className="text-[13.5px] text-[#ff9b9b]">{error}</div>}
          <Btn
            kind="primary"
            full
            icon="arrowR"
            onClick={send}
            disabled={pending || validRows.length === 0}
            className={validRows.length === 0 ? 'opacity-[0.45]' : ''}
          >
            {pending ? c.working : c.send}
          </Btn>
          {/* A real secondary button, not a faint "quiet" one: with no email filled
              in, the primary above is disabled and this is the only way on. */}
          <Btn kind="dark" full onClick={skip} disabled={pending}>
            {c.skip}
          </Btn>
          <p className="m-0 text-center text-[12.5px] leading-[1.45] text-faint">
            {c.skipHintPre}
            <b className="font-semibold text-dim">{c.skipHintBold}</b>
            {c.skipHintPost}
          </p>
        </div>
      }
    >
      <div className="flex flex-col gap-[12px]">
        {rows.map((r) => (
          <div key={r.id} className="rounded-[16px] border border-line bg-elev p-[14px]">
            <div className="mb-[10px] flex items-center justify-between">
              <Label>{c.roleLabel}</Label>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(r.id)}
                  className={cn('text-[12.5px] font-semibold text-faint', press)}
                >
                  {c.remove}
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
              placeholder={c.emailPlaceholder}
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
        {c.addRow}
      </button>
    </WizardShell>
  );
}
