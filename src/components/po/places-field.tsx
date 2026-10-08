'use client';

/**
 * PlacesField (Onboarding A, z8uq9m2vg5): the kit's Field with address
 * suggestions from our own /api/places proxy (Google Places API (New), key
 * server-side). Exported through kit.tsx.
 *
 * It is a plain text field first. Typing always works; suggestions only show
 * when the server has a key, the user typed at least 3 characters and the
 * proxy answered within its timeout. No key, throttled, offline or a Google
 * error: no list, nothing else changes.
 *
 * Billing: one session token per focus, sent with every autocomplete call and
 * closed by the one details call of a pick (then a new token next time).
 * Debounced 250 ms.
 *
 * Capacitor (#37): same-origin fetch only, no Google SDK, no popup, no
 * target=_blank; crypto.randomUUID has a fallback. Options are 44px tall on
 * touch; the list sits in the normal flow under the field, so nothing is cut
 * off by a sheet or the keyboard.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import {
  fetchPlaceAddress,
  fetchPlaceSuggestions,
  newPlacesSessionToken,
  placesKnownDisabled,
} from '@/lib/places/client';
import { PLACES_MIN_INPUT, PLACES_MAX_INPUT, type PlaceAddress, type PlaceSuggestion } from '@/lib/places/schema';
import { Icon, type IconName } from './icon';

const DEBOUNCE_MS = 250;

/** What a pick hands back: the suggestion's name (free, from autocomplete)
 *  and the address from details. address is null when details failed; the
 *  caller then has the suggestion text only. */
export interface PlacePick {
  name: string;
  /** "Name, rest of the line" as the suggestion showed it. */
  label: string;
  address: PlaceAddress | null;
}

export function PlacesField({
  icon = 'pin',
  placeholder,
  value,
  onChange,
  onPick,
  maxLength = PLACES_MAX_INPUT,
  className,
  ariaLabel,
}: {
  icon?: IconName;
  placeholder?: string;
  value: string;
  /** undefined = read-only, like Field: no input and no suggestions. */
  onChange?: (v: string) => void;
  onPick: (pick: PlacePick) => void;
  maxLength?: number;
  className?: string;
  ariaLabel?: string;
}): JSX.Element {
  const listId = useId();
  const [items, setItems] = useState<PlaceSuggestion[]>([]);
  const [active, setActive] = useState(-1);
  const token = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const latest = useRef(value);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      inflight.current?.abort();
    },
    [],
  );

  const close = (): void => {
    setItems([]);
    setActive(-1);
  };

  const lookup = (text: string): void => {
    if (timer.current) clearTimeout(timer.current);
    inflight.current?.abort();
    if (text.trim().length < PLACES_MIN_INPUT || placesKnownDisabled()) {
      close();
      return;
    }
    timer.current = setTimeout(() => {
      const ctrl = new AbortController();
      inflight.current = ctrl;
      token.current ??= newPlacesSessionToken();
      void fetchPlaceSuggestions(text.trim(), token.current, ctrl.signal).then((found) => {
        // Only the answer for what is in the field now.
        if (ctrl.signal.aborted || latest.current !== text) return;
        setItems(found);
        setActive(-1);
      });
    }, DEBOUNCE_MS);
  };

  const change = (v: string): void => {
    latest.current = v;
    onChange?.(v);
    lookup(v);
  };

  const pick = (s: PlaceSuggestion): void => {
    close();
    const sessionToken = token.current ?? newPlacesSessionToken();
    token.current = null; // the details call closes this billing session
    const label = [s.mainText, s.secondaryText].filter(Boolean).join(', ');
    void fetchPlaceAddress(s.placeId, sessionToken).then((address) => {
      onPick({ name: s.mainText, label, address });
    });
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(items[active]!);
    } else if (e.key === 'Escape') {
      close();
    }
  };

  const open = items.length > 0;

  return (
    <div className={className}>
      <div className="flex items-center gap-[11px] rounded-field border border-line bg-elev px-[15px] py-[13px]">
        <span className="text-faint">
          <Icon name={icon} size={19} />
        </span>
        {onChange != null ? (
          <input
            value={value}
            onChange={(e) => change(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={close}
            placeholder={placeholder}
            maxLength={maxLength}
            aria-label={ariaLabel}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            autoComplete="off"
            className="min-w-0 flex-1 border-none bg-transparent font-body text-[16px] text-text outline-none placeholder:text-faint"
          />
        ) : (
          <span className={cn('min-w-0 flex-1 font-body text-[16px]', value ? 'text-text' : 'text-faint')}>
            {value || placeholder}
          </span>
        )}
      </div>
      {open && (
        <div className="mt-1.5 overflow-hidden rounded-field border border-line bg-elev">
          <ul id={listId} role="listbox" aria-label={t.shared.places.listLabel}>
            {items.map((s, i) => (
              <li
                key={s.placeId}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                // mousedown, not click: it fires before the input's blur closes the list.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
                className={cn(
                  'flex min-h-[44px] cursor-pointer flex-col justify-center border-b border-line2 px-[15px] py-[8px] lg:[@media(pointer:fine)]:min-h-[36px]',
                  i === active ? 'bg-elev2' : 'hover:bg-elev2',
                )}
              >
                <span className="text-[14.5px] font-semibold text-text">{s.mainText}</span>
                {s.secondaryText && <span className="text-[12.5px] text-faint">{s.secondaryText}</span>}
              </li>
            ))}
          </ul>
          <div className="px-[15px] py-[6px] text-right text-[11px] text-faint">{t.shared.places.attribution}</div>
        </div>
      )}
    </div>
  );
}
