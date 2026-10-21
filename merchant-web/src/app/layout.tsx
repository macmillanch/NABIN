import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { MerchantAuthProvider } from '@/context/MerchantAuth';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  title: 'NABIN | Merchant Portal',
  description: 'Unified management console for NABIN restaurant and grocery partners',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} antialiased`}>
      <body data-role="merchant">
        <MerchantAuthProvider>{children}</MerchantAuthProvider>
      </body>
    </html>
  );
}
