import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Sania Job Bowl — Employee Verification", template: "%s · Sania Job Bowl" },
  description: "Sania Job Bowl employee identity and verification platform.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0b1f3a" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render every page per request: the CSP nonce set in proxy.ts can only be applied to
  // Next.js scripts during dynamic rendering (static HTML would have its scripts blocked).
  await connection();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-white px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        {children}
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
