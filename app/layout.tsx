import "./globals.css";
import type { Metadata, Viewport } from "next";
import Script from "next/script";
import Providers from "./providers";
import AppShell from "@/components/AppShell";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

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
    <html lang="en">
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
