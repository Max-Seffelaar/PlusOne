'use client';

/**
 * PLUSONE design-system primitives — recreated from `po-kit.jsx` in idiomatic
 * React/TS + Tailwind. Tokens come from `tailwind.config.ts`; exact one-off
 * pixel values use arbitrary Tailwind values so the visual output matches the
 * handoff. Interaction: hover `brightness(1.07)`, active `scale(0.975)`.
 */
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import type { Tier } from '@/lib/po/types';
import { Icon, type IconName } from './icon';

// FE-4: the canonical press/cardPress feels — 26 files hand-rolled a local copy
// of one of these (some already drifted to 0.94/0.985/1.09); exported so a
// screen imports instead of retyping the Tailwind string. `pressDesktop` is the
// desktop-density variant (was desktop/kit.tsx's local `press`).
export const press = 'transition-[filter,transform,background,border-color] hover:brightness-[1.07] active:scale-[0.975]';
export const cardPress = 'transition-[border-color,transform] hover:border-white/[0.24] active:scale-[0.99]';
export const pressDesktop = 'transition-[filter,transform,background,border-color,color] hover:brightness-[1.08] active:scale-[0.985]';

export function initials(name: string): string {
  return name
    .split(' ')
    .map((x) => x[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// ── Avatar ──────────────────────────────────────────────────────────────────
export function Avatar({ name, size = 44, accent }: { name: string; size?: number; accent?: boolean }): JSX.Element {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center font-display font-bold tracking-[-0.02em]',
        accent ? 'bg-acc text-on-acc border border-transparent' : 'bg-elev2 text-text border border-line',
      )}
      style={{ width: size, height: size, borderRadius: size * 0.32, fontSize: size * 0.34 }}
    >
      {initials(name)}
    </div>
  );
}

// ── Pill ────────────────────────────────────────────────────────────────────
export function Pill({ children, on, icon }: { children: ReactNode; on?: boolean; icon?: IconName }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[5px] whitespace-nowrap rounded-full border px-[10px] py-[5px] font-body text-[11.5px] font-semibold',
        on ? 'border-line text-text' : 'border-line2 text-dim',
      )}
    >
      {icon && <Icon name={icon} size={12} sw={2} />}
      {children}
    </span>
  );
}

// ── StatusDot ───────────────────────────────────────────────────────────────
export function StatusDot({ status, label = true }: { status: 'in' | 'wait'; label?: boolean }): JSX.Element {
  const inn = status === 'in';
  return (
    <span className={cn('inline-flex items-center gap-[6px] font-body text-[12px] font-bold', inn ? 'text-acc' : 'text-faint')}>
      {inn ? (
        <span className="flex h-[17px] w-[17px] items-center justify-center rounded-full bg-acc">
          <Icon name="check" size={11} sw={3} stroke="#16132B" />
        </span>
      ) : (
        <span className="h-[15px] w-[15px] rounded-full border-2 border-ghost" />
      )}
      {label && (inn ? t.shared.kit.statusInside : t.shared.kit.statusOnTheWay)}
    </span>
  );
}

// ── PayChip ─────────────────────────────────────────────────────────────────
export function PayChip({ pay }: { pay: string }): JSX.Element | null {
  if (pay !== 'pay') return null;
  return (
    <span className="inline-flex items-center gap-[4px] rounded-[7px] border border-dashed border-line px-2 py-[3px] font-body text-[11px] font-bold tracking-[0.02em] text-text">
      {t.shared.kit.payMustPay}
    </span>
  );
}

// ── Btn ─────────────────────────────────────────────────────────────────────
type BtnKind = 'primary' | 'dark' | 'ghost' | 'quiet' | 'danger';
const BTN_KINDS: Record<BtnKind, string> = {
  primary: 'bg-acc text-on-acc border-transparent',
  dark: 'bg-elev2 text-text border-line',
  ghost: 'bg-transparent text-text border-line',
  quiet: 'bg-transparent text-dim border-line2',
  danger: 'bg-red-500/90 text-white border-transparent',
};

export function Btn({
  children,
  kind = 'primary',
  icon,
  onClick,
  full,
  sm,
  type = 'button',
  disabled,
  className,
  style,
  desktop,
  autoFocus,
}: {
  children: ReactNode;
  kind?: BtnKind;
  icon?: IconName;
  onClick?: () => void;
  full?: boolean;
  sm?: boolean;
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Desktop density (was desktop/kit.tsx's `DBtn`): tighter radius + the
   *  desktop press feel. Same API otherwise — a screen never needs two imports. */
  desktop?: boolean;
  autoFocus?: boolean;
}): JSX.Element {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      autoFocus={autoFocus}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center gap-[9px] whitespace-nowrap border font-display font-bold tracking-[-0.01em]',
        desktop ? 'rounded-[12px]' : 'rounded-btn',
        desktop ? pressDesktop : press,
        'disabled:pointer-events-none',
        sm ? 'px-4 py-[10px] text-[14px]' : 'px-5 py-[15px] text-[16px]',
        full ? 'w-full' : 'w-auto',
        BTN_KINDS[kind],
        className,
      )}
      style={style}
    >
      {icon && <Icon name={icon} size={sm ? 16 : 19} sw={2.1} />}
      {children}
    </button>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────
// Was desktop/kit.tsx's `DCard` — the only "card" primitive in the app (not
// actually desktop-specific), folded in under FE-4.
export function Card({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={cn('rounded-[20px] border border-line bg-elev transition-colors', className)}>{children}</div>;
}

// ── Seg (segmented toggle) ───────────────────────────────────────────────────
// Was copy-pasted in door/CheckInList.tsx + door/Taken.tsx (byte-identical
// button markup, different Filter type + labels each time).
export function Seg<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  items: readonly (readonly [T, string])[];
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('flex gap-1.5', className)}>
      {items.map(([k, l]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={cn(
            'flex-1 cursor-pointer rounded-full border py-[9px] font-display text-[13px] font-bold transition-[filter] hover:brightness-[1.07]',
            value === k ? 'border-transparent bg-text text-bg' : 'border-line bg-transparent text-dim',
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

// ── TierPicker (radio rows) ──────────────────────────────────────────────────
// Was near-identical in links.tsx (LinkSheet), approvals.tsx (AssignSheet) and a
// divergent horizontal variant in promo-create-link.tsx (G3-0): one canonical
// tier chooser — color dot + capacity hint + radio check. Surface copy stays at
// the call site (`hint`/`none` are pre-formatted strings), so the kit needs no
// per-surface i18n keys.
export function TierPicker({
  tiers,
  value,
  onChange,
  hint,
  none,
  className,
}: {
  tiers: Tier[];
  /** Selected tier id; '' selects the `none` row (when provided). */
  value: string;
  onChange: (id: string) => void;
  /** Per-tier sub line, e.g. "3/40 used" / "No max" — formatted by the caller. */
  hint: (row: Tier) => string;
  /** Optional "no fixed tier" row (value ''); omit to force a real tier. */
  none?: { label: string; sub: string };
  className?: string;
}): JSX.Element {
  const radio = (on: boolean): ReactNode => (
    <span className={cn('flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border-2', on ? 'border-acc bg-acc' : 'border-ghost bg-transparent')}>
      {on && <Icon name="check" size={12} stroke="#16132B" sw={3} />}
    </span>
  );
  const row = (on: boolean): string =>
    cn('flex items-center gap-[11px] rounded-[12px] border px-[13px] py-[12px] text-left', on ? 'border-transparent bg-acc-dim' : 'border-line bg-elev', press);
  return (
    <div className={cn('flex flex-col gap-[7px]', className)}>
      {none && (
        <button type="button" onClick={() => onChange('')} className={row(value === '')}>
          <span className="h-[12px] w-[12px] shrink-0 rounded-full border-2 border-dashed border-ghost" />
          <span className="min-w-0 flex-1">
            <span className="block font-display text-[14.5px] font-bold text-text">{none.label}</span>
            <span className="block text-[11.5px] text-faint">{none.sub}</span>
          </span>
          {radio(value === '')}
        </button>
      )}
      {tiers.map((tier) => {
        const on = tier.id === value;
        return (
          <button key={tier.id} type="button" onClick={() => onChange(tier.id)} className={row(on)}>
            <span className="h-[12px] w-[12px] shrink-0 rounded-full" style={{ background: tier.color }} />
            <span className="min-w-0 flex-1">
              <span className="block font-display text-[14.5px] font-bold text-text">{tier.short}</span>
              <span className="block text-[11.5px] text-faint">{hint(tier)}</span>
            </span>
            {radio(on)}
          </button>
        );
      })}
    </div>
  );
}

// ── Field (input or static display) ──────────────────────────────────────────
export function Field({
  icon,
  placeholder,
  value,
  onChange,
  autoFocus,
  type = 'text',
  inputMode,
  maxLength,
  className,
}: {
  icon?: IconName;
  placeholder?: string;
  value?: string;
  onChange?: (v: string) => void;
  autoFocus?: boolean;
  type?: string;
  inputMode?: 'text' | 'numeric' | 'email' | 'tel';
  maxLength?: number;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('flex items-center gap-[11px] rounded-field border border-line bg-elev px-[15px] py-[13px]', className)}>
      {icon && (
        <span className="text-faint">
          <Icon name={icon} size={19} />
        </span>
      )}
      {onChange != null ? (
        <input
          autoFocus={autoFocus}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          type={type}
          inputMode={inputMode}
          maxLength={maxLength}
          className="min-w-0 flex-1 border-none bg-transparent font-body text-[16px] text-text outline-none placeholder:text-faint"
        />
      ) : (
        <span className={cn('min-w-0 flex-1 font-body text-[16px]', value ? 'text-text' : 'text-faint')}>{value || placeholder}</span>
      )}
    </div>
  );
}

// ── Stepper ─────────────────────────────────────────────────────────────────
export function Stepper({ value, onChange, max }: { value: number; onChange: (v: number) => void; max?: number }): JSX.Element {
  const btn = cn('flex h-[52px] w-[52px] items-center justify-center rounded-[16px] border border-line bg-elev2 text-text', press);
  return (
    <div className="flex items-center justify-between gap-[14px] rounded-[20px] bg-acc-dim p-[10px]">
      <button type="button" className={btn} onClick={() => onChange(Math.max(0, value - 1))} aria-label={t.shared.kit.stepperLess}>
        <Icon name="minus" size={22} sw={2.4} />
      </button>
      <div className="text-center">
        <div className="font-display text-[30px] font-bold leading-none text-text">
          {value}
          {max != null && <span className="text-faint">/{max}</span>}
        </div>
        <div className="mt-[3px] font-body text-[11px] text-dim">{t.shared.kit.stepperUnit}</div>
      </div>
      <button type="button" className={btn} onClick={() => onChange(value + 1)} aria-label={t.shared.kit.stepperMore}>
        <Icon name="plus" size={22} sw={2.4} stroke="#B5A6FF" />
      </button>
    </div>
  );
}

// ── Label ───────────────────────────────────────────────────────────────────
export function Label({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <div className={cn('font-body text-[12px] font-bold uppercase tracking-[0.04em] text-faint', className)}>{children}</div>;
}

// ── Row (settings / list line) ───────────────────────────────────────────────
export function Row({
  icon,
  title,
  sub,
  right,
  onClick,
  accent,
}: {
  icon?: IconName;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  accent?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-[13px] border-b border-line2 bg-transparent px-1 py-[14px] text-left',
        onClick ? 'cursor-pointer hover:bg-white/[0.03]' : 'cursor-default',
      )}
    >
      {icon && (
        <span className={cn('flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] border border-line bg-elev2', accent ? 'text-acc' : 'text-text')}>
          <Icon name={icon} size={18} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block font-body text-[15.5px] font-semibold text-text">{title}</span>
        {sub && <span className="mt-px block font-body text-[12.5px] text-faint">{sub}</span>}
      </span>
      {right || (onClick && <Icon name="chev" size={18} className="text-ghost" />)}
    </button>
  );
}

// ── Top (screen header) ──────────────────────────────────────────────────────
export function Top({
  title,
  big,
  onBack,
  right,
  sub,
}: {
  title: ReactNode;
  big?: boolean;
  onBack?: () => void;
  right?: ReactNode;
  sub?: ReactNode;
}): JSX.Element {
  const backBtn = (
    <button type="button" onClick={onBack} className={cn('flex h-[40px] w-[40px] items-center justify-center rounded-[12px] border border-line bg-elev text-text', press)} aria-label={t.shared.kit.back}>
      <Icon name="back" size={20} />
    </button>
  );
  if (big) {
    return (
      <div className="flex-none px-5 pb-[14px] pt-2">
        {onBack && <div className="mb-3">{backBtn}</div>}
        <div className="flex items-center justify-between">
          <h1 className="m-0 whitespace-nowrap font-display text-[34px] font-extrabold tracking-[-0.02em] text-text">{title}</h1>
          {right && <div className="flex gap-2">{right}</div>}
        </div>
        {sub && <div className="mt-0.5 text-[13.5px] text-faint">{sub}</div>}
      </div>
    );
  }
  return (
    <div className="flex flex-none items-center gap-[10px] px-4 pb-3 pt-[10px]">
      {onBack && backBtn}
      <div className="min-w-0 flex-1">
        <div className="overflow-hidden text-ellipsis whitespace-nowrap font-display text-[18px] font-bold text-text">{title}</div>
        {sub && <div className="text-[12px] text-faint">{sub}</div>}
      </div>
      {right && <div className="flex gap-2">{right}</div>}
    </div>
  );
}

export function IconBtn({
  name,
  onClick,
  ariaLabel,
}: {
  name: IconName;
  onClick?: () => void;
  /** Accessible name (also shown as a hover tooltip) for icon-only buttons with no visible label. */
  ariaLabel?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      className={cn('flex h-[40px] w-[40px] items-center justify-center rounded-[12px] border border-line bg-elev text-text', press)}
    >
      <Icon name={name} size={19} />
    </button>
  );
}

// ── Scroll (in-screen scroll area) ───────────────────────────────────────────
export function Scroll({ children, pad = 20, bottom = 24, className }: { children: ReactNode; pad?: number; bottom?: number; className?: string }): JSX.Element {
  return (
    <div className={cn('po-scroll min-h-0 flex-1 overflow-y-auto', className)} style={{ padding: `0 ${pad}px ${bottom}px` }}>
      {children}
    </div>
  );
}

// ── Toggle / ToggleRow ───────────────────────────────────────────────────────
export function Toggle({ on, onClick }: { on: boolean; onClick?: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      role="switch"
      aria-checked={on}
      className={cn('flex h-[28px] w-[46px] cursor-pointer rounded-full p-[3px] transition-colors', press, on ? 'justify-end bg-acc' : 'justify-start bg-elev2')}
    >
      <span className={cn('block h-[22px] w-[22px] rounded-full', on ? 'bg-on-acc' : 'bg-faint')} />
    </button>
  );
}

export function ToggleRow({ title, sub, on, set, last }: { title: string; sub?: string; on: boolean; set: (v: boolean) => void; last?: boolean }): JSX.Element {
  return (
    <div className={cn('flex items-center gap-[12px] py-[13px]', last ? '' : 'border-b border-line2')}>
      <div className="flex-1">
        <div className="font-body text-[14.5px] font-semibold text-text">{title}</div>
        {sub && <div className="mt-0.5 text-[12px] leading-[1.4] text-faint">{sub}</div>}
      </div>
      <Toggle on={on} onClick={() => set(!on)} />
    </div>
  );
}

// ── Note / Empty / MiniChip ──────────────────────────────────────────────────
export function Note({ children, icon = 'shield' }: { children: ReactNode; icon?: IconName }): JSX.Element {
  return (
    <div className="mb-[14px] flex gap-[11px] rounded-[13px] bg-acc-dim p-[13px]">
      <span className="mt-px shrink-0 text-acc">
        <Icon name={icon} size={17} />
      </span>
      <div className="text-[12.5px] leading-[1.45] text-text">{children}</div>
    </div>
  );
}

export function Empty({ text }: { text: string }): JSX.Element {
  return <div className="py-[30px] text-center text-[14px] text-faint">{text}</div>;
}

// ── Spinner / Loading ─────────────────────────────────────────────────────────
// A lavender-accented ring spinner for in-screen load states (replaces a bare
// "Laden…" line). Tailwind's `animate-spin` is functional, not an entrance
// animation, so it intentionally runs regardless of prefers-reduced-motion.
export function Spinner({ size = 18, className }: { size?: number; className?: string }): JSX.Element {
  return (
    <span
      role="status"
      aria-label={t.shared.kit.loadingAria}
      className={cn('inline-block animate-spin rounded-full border-2 border-line2 border-t-acc', className)}
      style={{ width: size, height: size }}
    />
  );
}

export function Loading({ text = t.shared.kit.loading, className }: { text?: string; className?: string }): JSX.Element {
  return (
    <div className={cn('flex items-center justify-center gap-[10px] py-[30px] text-[14px] text-faint', className)}>
      <Spinner />
      {text && <span>{text}</span>}
    </div>
  );
}

export function MiniChip({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }): JSX.Element {
  const cls = cn(
    'inline-flex items-center gap-[5px] whitespace-nowrap rounded-[7px] border border-line bg-transparent px-[9px] py-[4px] font-body text-[10.5px] font-bold tracking-[0.03em] text-dim',
    className,
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(cls, 'cursor-pointer', press)}>
        {children}
      </button>
    );
  }
  return <span className={cls}>{children}</span>;
}
