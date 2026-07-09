import { notFound } from 'next/navigation';
import { SentryTestButtons } from './SentryTestButtons';

// Deliberate error-trigger harness (fase 6). Local + Vercel Preview only; 404 in
// production. Middleware still requires login here — which is fine: an
// authenticated trigger also verifies the user.id tag end-to-end. Kept permanent.
export default function SentryTestPage(): JSX.Element {
  if (process.env.VERCEL_ENV === 'production') notFound();
  return <SentryTestButtons />;
}
