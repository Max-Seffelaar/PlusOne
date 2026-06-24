'use client';

import { useEffect, useState, useTransition } from 'react';
import { setLandingActive } from '../actions';

/**
 * Landing-link control (#12/#28): activate/deactivate the public request link
 * without closing the event, and copy the link. The slug is generated once from
 * the name and is intentionally NOT editable — a link that's already been shared
 * must never break (feedback 2026-06-14). The page itself (route /e/[slug]) is
 * fase 8.
 */
export function LandingControl({
  eventId,
  landingActive,
  slug,
}: {
  eventId: string;
  landingActive: boolean;
  slug: string;
}): JSX.Element {
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}/e/${slug}`;

  function toggle(active: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await setLandingActive({ eventId, active });
      if (!res.ok) setError(res.message);
    });
  }

  function copy() {
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => setError("Couldn't copy the link.")
    );
  }

  return (
    <section className="card flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="label">Request link</h2>
          <p className="text-dim mt-0.5 text-sm">
            {landingActive ? 'On. Guests can request a spot.' : 'Off. No one can request a spot.'}
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => toggle(!landingActive)}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {landingActive ? 'Deactivate' : 'Activate'}
        </button>
      </div>

      <div className="border-line2 flex items-center gap-2 border-t pt-3">
        <code className="text-dim min-w-0 flex-1 truncate font-mono text-xs">{origin ? url : `/e/${slug}`}</code>
        <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {error && (
        <p className="text-acc-soft text-sm" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
