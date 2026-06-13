import type { Metadata } from 'next';
import { PlusOneApp } from '@/components/po/app';

export const metadata: Metadata = {
  title: 'PLUSONE — Gastenlijst',
};

export default function AppPage(): JSX.Element {
  return <PlusOneApp />;
}
