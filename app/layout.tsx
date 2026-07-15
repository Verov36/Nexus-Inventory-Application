import "./globals.css";
import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Manrope, Inter, IBM_Plex_Mono } from "next/font/google";
import Providers from "./providers";
import AppShell from "@/components/AppShell";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

// Manrope for headings — a little more geometric character than a default
// sans, without tipping into decorative. Inter for body copy, since dense
// data lists need a face that stays legible small. IBM Plex Mono for part
// numbers, job numbers, SKUs, and barcodes specifically — these are the
// "ticket numbers" of a dispatch operation and read better set apart from
// prose, the way a work order or shipping label would set them.
const display = Manrope({ subsets: ["latin"], variable: "--font-display", weight: ["600", "700", "800"] });
const body = Inter({ subsets: ["latin"], variable: "--font-body" });
const data = IBM_Plex_Mono({ subsets: ["latin"], variable: "--font-data", weight: ["500", "600"] });

export const metadata: Metadata = {
  title: "Nexus Parts Inventory",
  description: "Warehouse and truck parts inventory for field techs",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Nexus Inventory",
  },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

// Locked scale, no pinch-zoom — this runs as a near-native app on tablets.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0F2438",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${data.variable}`}>
      <body>
        {/*
          Zebra Browser Print SDK — download from zebra.com/browserprint and
          place the file at public/browserprint/BrowserPrint-3.1.min.js.
          It talks to the local Browser Print app (http://localhost:9100)
          running on whichever machine has the Zebra printer attached.
        */}
        <Script src="/browserprint/BrowserPrint-3.1.min.js" strategy="beforeInteractive" />
        <ServiceWorkerRegister />
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
