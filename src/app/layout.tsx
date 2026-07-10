import type { Metadata } from "next";
// Local font package (no network fetch at build time — CI/proxy friendly).
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { themeInitScript } from "@/components/shell/theme";

export const metadata: Metadata = {
  title: { default: "ComeDigit CRM", template: "%s · ComeDigit CRM" },
  description:
    "AI-powered marketing CRM — Shopify, Meta, Google Ads, TikTok and your clients in one dashboard.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full font-sans">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
      </body>
    </html>
  );
}
