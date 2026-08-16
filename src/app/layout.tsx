import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider, themeInitScript } from "@/components/ide/theme-provider";
import { AppKitProvider } from "@/lib/wallet/appkit-provider";
import { SiwsSessionBridge } from "@/lib/wallet/siws-session-bridge";
import { WalletModalHost } from "@/lib/wallet/wallet-modal-host";
import { ClientOnly } from "@/components/ide/client-only";
import { chunkErrorRecoveryScript } from "@/lib/chunk-error-recovery";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "StellarForge — Agentic Web IDE for Soroban Smart Contracts",
  description:
    "Browser-based IDE for Soroban smart contract development. Compile, deploy, collaborate, and ship — without leaving your browser.",
  keywords: [
    "Soroban",
    "Stellar",
    "IDE",
    "Smart Contracts",
    "Rust",
    "WebAssembly",
    "Blockchain",
  ],
  authors: [{ name: "SagantaHQ" }],
  applicationName: "StellarForge",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "StellarForge",
  },
  icons: {
    icon: [
      // Cache-bust with ?v=2 to force browsers to re-fetch (overrides old Z.ai favicon)
      { url: "/favicon.ico?v=2", sizes: "32x32" },
      { url: "/icon.svg?v=2", sizes: "any" },
      { url: "/favicon-32.png?v=2", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png?v=2",
  },
  openGraph: {
    title: "StellarForge",
    description: "Agentic Web IDE for Soroban Smart Contracts",
    siteName: "StellarForge",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0D0E11",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Inline theme init — runs BEFORE paint to prevent flash of wrong theme */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {/* §Fix (2026-08-16) — ChunkLoadError recovery. Must run BEFORE any
            chunks load so the listener is in place before the first error
            can fire. Detects stale-chunk 404s after redeploy and forces a
            cache-busting reload (one-shot, no loop). */}
        <script dangerouslySetInnerHTML={{ __html: chunkErrorRecoveryScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${jetbrainsMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider>
          <AppKitProvider>
            {children}
            <ClientOnly>
              <WalletModalHost />
            </ClientOnly>
            <SiwsSessionBridge />
          </AppKitProvider>
        </ThemeProvider>
        <Toaster />
      </body>
    </html>
  );
}
