import Link from 'next/link';

export default function Home(): JSX.Element {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="text-center">
        <h1 className="mb-4 font-display text-4xl font-bold">PLUSONE</h1>
        <p className="mb-8 text-dim">Gastenlijstbeheer voor venues</p>
        <p className="mb-8 text-sm text-faint">Zet ze op de lijst. Wij doen de deur.</p>
        <div className="flex flex-col items-center gap-3">
          <Link
            href="/app"
            className="inline-flex w-64 items-center justify-center rounded-btn bg-acc px-5 py-3 font-display font-bold text-on-acc transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]"
          >
            Open de app (mobiel)
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex w-64 items-center justify-center rounded-btn border border-line bg-elev2 px-5 py-3 font-display font-bold text-text transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]"
          >
            Desktop dashboard
          </Link>
          <Link
            href="/e/frenzy-x4k9"
            className="inline-flex w-64 items-center justify-center rounded-btn border border-line bg-transparent px-5 py-3 font-display font-bold text-dim transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]"
          >
            Landingpage (demo)
          </Link>
        </div>
      </div>
    </main>
  );
}
