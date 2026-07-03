import Link from 'next/link';

export default function Home(): JSX.Element {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="text-center">
        <h1 className="mb-4 font-display text-4xl font-bold">PLUSONE</h1>
        <p className="mb-8 text-dim">The guest list that runs the door.</p>
        <p className="mb-8 text-sm text-faint">No QR, no screenshots. Just your name at the door.</p>
        <div className="flex flex-col items-center gap-3">
          <Link
            href="/app"
            className="inline-flex w-64 items-center justify-center rounded-btn bg-acc px-5 py-3 font-display font-bold text-on-acc transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]"
          >
            Open the app
          </Link>
        </div>
      </div>
    </main>
  );
}
