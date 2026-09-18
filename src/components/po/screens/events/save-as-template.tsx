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
 */
import { type JSX, useEffect, useState } from 'react';
import { t, fmt } from '@/lib/i18n';
import { usePoCreateTemplateFromEvent } from '@/features/po/mutations';
import { Icon } from '../../icon';
import { Btn, Field, Label } from '../../kit';

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
  const [err, setErr] = useState<string | null>(null);

  const draft = open && !!name.trim();
  useEffect(() => {
    onDraftChange?.(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const submit = async (): Promise<void> => {
    if (!name.trim() || createTpl.isPending) return;
    setErr(null);
    setSavedName(null);
    try {
      const tplName = name.trim();
      await createTpl.mutateAsync({ eventId, name: tplName });
      setSavedName(tplName);
      setName('');
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.events.saveTemplateError);
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
            onChange={setName}
            autoFocus
            className="mb-3"
          />
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
                setErr(null);
              }}
            >
              {t.events.saveTemplateCancel}
            </Btn>
          </div>
          {err && <p className="mt-2 text-[12.5px] text-[#E89AC0]">{err}</p>}
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
