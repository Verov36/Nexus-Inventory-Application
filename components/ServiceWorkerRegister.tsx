"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Non-fatal — app works fine without the service worker, it just
        // won't be installable/offline-tolerant.
      });
    }
  }, []);
  return null;
}
