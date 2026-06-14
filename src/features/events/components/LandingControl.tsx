'use client';

import { useEffect, useState, useTransition } from 'react';
import { setLandingActive, updateLandingSlug } from '../actions';

/**
 * Landing-link control (#12/#28): activate/deactivate the public request link
 * without closing the event, show/copy the link, and edit the slug. The page
 * itself (route /e/[slug]) is fase 8 — here we only manage its switch and slug.
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
  const [editing, setEditing] = useState(false);
  const [slugDraft, setSlugDraft] = useState(slug);
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
      () => setError('Kopiëren lukte niet.')
    );
  }

  function saveSlug() {
    setError(null);
    startTransition(async () => {
      const res = await updateLandingSlug({ eventId, slug: slugDraft });
      if (res.ok) setEditing(false);
      else setError(res.message);
    });
  }

  return (
    <section className="card flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="label">Aanvraaglink</h2>
          <p className="text-dim mt-0.5 text-sm">
            {landingActive ? 'Actief — gasten kunnen zich aanmelden.' : 'Uit — niemand kan zich aanmelden.'}
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => toggle(!landingActive)}
          className={`${landingActive ? 'btn-dark' : 'btn-primary'} text-sm disabled:opacity-50`}
        >
          {landingActive ? 'Deactiveren' : 'Activeren'}
        </button>
      </div>

      <div className="border-line2 flex items-center gap-2 border-t pt-3">
        <code className="text-dim min-w-0 flex-1 truncate font-mono text-xs">{origin ? url : `/e/${slug}`}</code>
        <button type="button" className="btn-ghost text-xs" onClick={copy}>
          {copied ? 'Gekopieerd' : 'Kopiëren'}
        </button>
        <button type="button" className="btn-ghost text-xs" onClick={() => setEditing((v) => !v)}>
          {editing ? 'Sluiten' : 'Link wijzigen'}
        </button>
      </div>

      {editing && (
        <div className="border-line2 flex flex-col gap-2 border-t pt-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="label">Eigen link (slug)</span>
            <input
              className="field font-mono"
              value={slugDraft}
              onChange={(e) => setSlugDraft(e.target.value)}
              placeholder="zomer-rave"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary text-sm disabled:opacity-50"
              disabled={pending}
              onClick={saveSlug}
            >
              {pending ? '…' : 'Link opslaan'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-acc-soft text-sm" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
