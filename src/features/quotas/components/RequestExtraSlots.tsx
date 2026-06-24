'use client';

import { useState, useTransition } from 'react';
import { requestExtraSlots } from '../actions';

/** Staff asks for extra slots with a motivation (#5). */
export function RequestExtraSlots({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  const [extra, setExtra] = useState(2);
  const [motivation, setMotivation] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setFeedback(null);
    startTransition(async () => {
      const res = await requestExtraSlots({ eventId, requestedExtra: extra, motivation });
      if (res.ok) {
        setFeedback({ ok: true, message: 'Request sent. An admin decides.' });
        setMotivation('');
        setOpen(false);
      } else {
        setFeedback({ ok: false, message: res.message });
      }
    });
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        <button type="button" className="btn-dark self-start" onClick={() => setOpen(true)}>
          Request more slots
        </button>
        {feedback && (
          <p className={feedback.ok ? 'text-sm text-acc' : 'text-sm text-acc-soft'}>
            {feedback.message}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="card flex flex-col gap-3">
      <p className="label">Request more slots</p>
      <label className="flex flex-col gap-1 text-sm">
        Extra slots
        <input
          type="number"
          min={1}
          max={100}
          className="field w-28"
          value={extra}
          onChange={(e) => setExtra(Math.max(1, Number(e.target.value) || 1))}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Reason
        <textarea
          className="field min-h-[4rem]"
          placeholder="Why do you need these slots?"
          value={motivation}
          onChange={(e) => setMotivation(e.target.value)}
          maxLength={500}
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-primary disabled:opacity-50"
          disabled={pending || motivation.trim() === ''}
          onClick={submit}
        >
          {pending ? '…' : 'Send'}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {feedback && !feedback.ok && <p className="text-sm text-acc-soft">{feedback.message}</p>}
    </div>
  );
}
