import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { preload } from "react-dom";
import { Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import { BRAND_FONT_URL } from "@/lib/brand";

const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Sania Job Bowl — Employee Verification", template: "%s · Sania Job Bowl" },
  description: "Sania Job Bowl employee identity and verification platform.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#030015" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render every page per request: the CSP nonce set in proxy.ts can only be applied to
  // Next.js scripts during dynamic rendering (static HTML would have its scripts blocked).
  await connection();
  // Urbanist (brand typeface) is self-hosted and declared in globals.css; fetch it with the HTML.
  preload(BRAND_FONT_URL, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  return (
    <html lang="en" className={`${geistMono.variable} h-full antialiased`}>
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
