import type { Metadata } from 'next';
import { DesktopApp } from '@/components/po/desktop/app';

export const metadata: Metadata = {
  title: 'PLUSONE — Dashboard',
};

export default function DashboardPage(): JSX.Element {
  return <DesktopApp />;
}
