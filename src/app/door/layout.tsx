import type { ReactNode } from 'react';
import { DoorQueryProvider } from '@/features/door/DoorQueryProvider';
import { RegisterServiceWorker } from './register-sw';

// Full-bleed door shell — deliberately NOT the (app) dashboard chrome. The route
// is still protected by middleware (a session is required; doorhost has no MFA
// mandate). Offline data + outbox live in DoorQueryProvider.
export default function DoorLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <DoorQueryProvider>
      <RegisterServiceWorker />
      {children}
    </DoorQueryProvider>
  );
}
