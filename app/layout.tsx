import type { Metadata } from "next";
import localFont from "next/font/local";
import { Providers } from "./providers";
import "./globals.css";

const syne = localFont({
  src: [
    { path: "../public/fonts/syne/Syne-400.ttf", weight: "400", style: "normal" },
    { path: "../public/fonts/syne/Syne-500.ttf", weight: "500", style: "normal" },
    { path: "../public/fonts/syne/Syne-600.ttf", weight: "600", style: "normal" },
    { path: "../public/fonts/syne/Syne-700.ttf", weight: "700", style: "normal" },
    { path: "../public/fonts/syne/Syne-800.ttf", weight: "800", style: "normal" },
  ],
  variable: "--font-syne",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AgentVault — Reputation-Gated AI Agent Marketplace",
  description:
    "Onchain identity, verifiable trust, and portable reputation for autonomous agents via ERC-8004 on Arc.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${syne.variable} h-full`}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
