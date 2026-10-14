'use client';

/**
 * Save an existing event's setup (tiers + capacity + settings) as a reusable
 * template. Split out of `edit.tsx` (Joeri walkthrough, z8uq9m0hw3) so the event
 * form stays under the 800-LOC line; used by the event form and, standalone, by
 * the past-event recap (M11, 8/7).
 *
 * Reports a typed-but-unsaved name via onDraftChange so the parent's leave-guard
 * can catch it: "Save event" does NOT save the template (T4, 1/7). onDraftChange
 * is optional on the recap.
 *
 * The section label reads "Template" (z8uq9m0hw3, item 8; Max, PR #305): the
 * old "Reuse this setup" heading read as a second, vaguer name for the action.
 * The label names the section, the button says what it does.
 */
import { type JSX, useEffect, useState } from 'react';
import { t, fmt } from '@/lib/i18n';
import { usePoCreateTemplateFromEvent } from '@/features/po/mutations';
import { Icon } from '../../icon';
import { Btn, Field, FieldErrorFor, Label, fieldInputProps, useFieldErrors } from '../../kit';

// The one field for useFieldErrors: createTemplateFromEvent's schema key.
const SAVE_TEMPLATE_FIELDS = ['name'] as const;

export function SaveAsTemplate({
  eventId,
  onDraftChange,
}: {
  eventId: string;
  onDraftChange?: (dirty: boolean) => void;
}): JSX.Element {
  const createTpl = usePoCreateTemplateFromEvent();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [savedName, setSavedName] = useState<string | null>(null);
  // Field errors point at the field (z8uq9m5m8g); the rest is the banner.
  const fe = useFieldErrors(SAVE_TEMPLATE_FIELDS);

  const draft = open && !!name.trim();
  useEffect(() => {
    onDraftChange?.(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const submit = async (): Promise<void> => {
    if (!name.trim() || createTpl.isPending) return;
    fe.reset();
    setSavedName(null);
    try {
      const tplName = name.trim();
      await createTpl.mutateAsync({ eventId, name: tplName });
      setSavedName(tplName);
      setName('');
      setOpen(false);
    } catch (e) {
      fe.failWith(e, t.events.saveTemplateError);
    }
  };

  return (
    <div className="mt-[18px]">
      <Label className="mb-[10px]">{t.events.saveTemplateLabel}</Label>
      {open ? (
        <div className="rounded-[16px] border border-acc bg-elev p-4">
          <p className="mb-2.5 text-[12.5px] leading-[1.5] text-faint">{t.events.saveTemplateHint}</p>
          <Field
            placeholder={t.events.saveTemplatePlaceholder}
            value={name}
            onChange={fe.edit('name', setName)}
            autoFocus
            className="mb-3"
            {...fieldInputProps(fe.bind('name'))}
          />
          <FieldErrorFor error={fe.bind('name')} className="-mt-1.5 mb-3" />
          <div className="flex gap-2">
            <Btn
              kind="primary"
              sm
              icon="check"
              onClick={() => void submit()}
              disabled={!name.trim() || createTpl.isPending}
              className={!name.trim() || createTpl.isPending ? 'opacity-50' : ''}
            >
              {createTpl.isPending ? t.events.saving : t.events.saveTemplateConfirm}
            </Btn>
            <Btn
              kind="ghost"
              sm
              onClick={() => {
                setOpen(false);
                setName('');
                fe.reset();
              }}
            >
              {t.events.saveTemplateCancel}
            </Btn>
          </div>
          {fe.banner && (
            <p className="mt-2 text-[12.5px] text-[#E89AC0]" role="alert">
              {fe.banner}
            </p>
          )}
        </div>
      ) : (
        <>
          <Btn
            kind="dark"
            full
            icon="grid"
            onClick={() => {
              setOpen(true);
              setSavedName(null);
            }}
          >
            {t.events.saveTemplateCta}
          </Btn>
          {/* Unmissable saved-state: a card with the template's name + where to
              find it, not a one-line footnote (T4, 1/7 — "felt saved, couldn't
              find it back"). */}
          {savedName && (
            <div
              className="mt-2 flex items-start gap-[10px] rounded-[14px] border bg-acc-dim p-[13px]"
              style={{ borderColor: 'rgba(181,166,255,0.4)' }}
            >
              <span className="mt-px text-acc">
                <Icon name="check" size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-body text-[14px] font-bold text-text">
                  {fmt(t.events.saveTemplateDoneTitle, { name: savedName })}
                </div>
                <div className="mt-0.5 text-[12.5px] leading-[1.45] text-faint">{t.events.saveTemplateDoneBody}</div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
