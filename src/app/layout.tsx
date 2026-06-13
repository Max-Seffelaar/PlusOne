import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Hanken_Grotesk } from 'next/font/google';
import './globals.css';

// Display: Bricolage Grotesque (600/700/800), body/UI: Hanken Grotesk (400–700).
// Exposed as CSS variables consumed by the Tailwind `font-display` / `font-body` utilities.
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-display',
});

const body = Hanken_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-body',
});

export const metadata: Metadata = {
  title: 'PLUSONE — Gastenlijstbeheer',
  description: 'Multi-tenant gastenlijst SaaS voor venues',
  generator: 'Next.js',
  applicationName: 'PLUSONE',
  referrer: 'strict-origin-when-cross-origin',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  colorScheme: 'dark',
  themeColor: '#0B0B0D',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <html lang="nl" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="PLUSONE" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body className="bg-bg text-text font-body antialiased">{children}</body>
    </html>
  );
}
