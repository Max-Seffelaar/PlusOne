import Link from 'next/link';

// Lightweight top bar for the event-management routes (which live outside the
// (app) route group, like the fase-7 guest-list screen). Gives consistent
// chrome + a way back to the dashboard.
export function EventsTopbar({ backHref }: { backHref?: string }): JSX.Element {
  return (
    <header className="border-line bg-bg/80 sticky top-0 z-10 border-b backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-4 text-sm">
          <Link href="/dashboard" className="font-display text-lg font-extrabold tracking-tight">
            PLUSONE
          </Link>
          <Link href="/events" className="text-dim hover:text-text transition-colors">
            Events
          </Link>
        </div>
        {backHref && (
          <Link href={backHref} className="text-dim hover:text-text text-sm transition-colors">
            ← Terug
          </Link>
        )}
      </div>
    </header>
  );
}
