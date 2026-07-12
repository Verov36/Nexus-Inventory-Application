import "./globals.css";
import type { Metadata, Viewport } from "next";
import Script from "next/script";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "Nexus Parts Inventory",
  description: "Warehouse and truck parts inventory for field techs",
};

// Locked scale, no pinch-zoom — this runs as a near-native app on tablets.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
