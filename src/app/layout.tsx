import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider, themeInitScript } from "@/components/ide/theme-provider";
import { AppKitProvider } from "@/lib/wallet/appkit-provider";
import { WalletModalHost } from "@/lib/wallet/wallet-modal-host";
import { SiwsSessionBridge } from "@/lib/wallet/siws-session-bridge";

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
  title: "Soroban.Build — Agentic Web IDE for Soroban Smart Contracts",
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
  applicationName: "Soroban.Build",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Soroban.Build",
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
    title: "Soroban.Build",
    description: "Agentic Web IDE for Soroban Smart Contracts",
    siteName: "Soroban.Build",
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
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${jetbrainsMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider>
          <AppKitProvider>
            {children}
            <WalletModalHost />
            <SiwsSessionBridge />
          </AppKitProvider>
        </ThemeProvider>
        <Toaster />
      </body>
    </html>
  );
}
