import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { MerchantAuthProvider } from '@/context/MerchantAuth';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'NABIN | Restaurant Merchant',
  description: 'Order kitchen display and menu console for NABIN restaurant partners',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} antialiased`}>
      <body data-role="restaurant">
        <MerchantAuthProvider>{children}</MerchantAuthProvider>
      </body>
    </html>
  );
}
