import type { Metadata } from 'next';
import { events } from '@/lib/po/data';
import { DEMO_EVENT, LandingForm, type LandingEvent } from '@/components/po/landing';

export const metadata: Metadata = {
  title: 'Zet jezelf op de lijst · PLUSONE',
  robots: { index: false },
};

/** Mock resolver: map a landing slug (e.g. `frenzy-x4k9`) to an event. */
function resolveEvent(slug: string): LandingEvent {
  const id = slug.split('-')[0];
  const e = events.find((ev) => ev.id === id);
  return e ? { ...DEMO_EVENT, name: e.name, venue: e.venue, time: e.time } : DEMO_EVENT;
}

export default async function LandingPage({ params }: { params: Promise<{ slug: string }> }): Promise<JSX.Element> {
  const { slug } = await params;
  return <LandingForm event={resolveEvent(slug)} />;
}
