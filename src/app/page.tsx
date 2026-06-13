import Link from 'next/link';

export default function Home(): JSX.Element {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="text-center">
        <h1 className="font-display mb-4 text-4xl font-bold">PLUSONE</h1>
        <p className="text-dim mb-2">Gastenlijstbeheer voor venues</p>
        <p className="text-faint mb-8 text-sm">Zet ze op de lijst. Wij doen de deur.</p>
        <Link href="/login" className="btn-primary inline-block">
          Inloggen
        </Link>
      </div>
    </main>
  );
}
