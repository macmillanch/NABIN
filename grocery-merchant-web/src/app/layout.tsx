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
  title: 'NABIN | Grocery Merchant',
  description: 'Store inventory and order console for NABIN grocery partners',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} antialiased`}>
      <body data-role="grocery">
        <MerchantAuthProvider>{children}</MerchantAuthProvider>
      </body>
    </html>
  );
}
