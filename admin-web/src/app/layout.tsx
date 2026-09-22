import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { ConfirmActionProvider } from "@/components/ConfirmAction";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "NABIN Admin Dashboard",
  description: "Admin portal for NABIN Super App",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body data-role="admin" className="min-h-full flex flex-col">
        <AuthProvider>
          <ConfirmActionProvider>
            {children}
          </ConfirmActionProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
