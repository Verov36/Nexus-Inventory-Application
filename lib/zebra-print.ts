/**
 * Zebra label printing via the Zebra Browser Print SDK.
 *
 * Setup (one-time, per warehouse/office PC that has a Zebra printer attached):
 *   1. Install "Zebra Browser Print" (free, from zebra.com/browserprint) on the
 *      machine physically connected to the printer (USB, network, or Bluetooth).
 *      It runs a small local service on http://localhost:9100 that this app
 *      talks to — no server-side print driver needed.
 *   2. Download BrowserPrint-3.1.xxx.min.js from the same install package and
 *      drop it in /public/browserprint/BrowserPrint-3.1.min.js. It's loaded via
 *      a <script> tag in app/layout.tsx.
 *   3. Zebra ZD421 (or any ZPL-speaking Zebra) is the recommended printer —
 *      203dpi, 4"x2" or 2"x1" label stock works well for parts.
 *
 * This module never calls a server route to print — it talks directly from the
 * tech/warehouse browser tab to the local Browser Print service, which is how
 * Zebra's SDK is designed to work.
 */

declare global {
  interface Window {
    BrowserPrint?: {
      getDefaultDevice: (
        type: "printer",
        success: (device: ZebraDevice) => void,
        error: (msg: string) => void
      ) => void;
      getLocalDevices: (
        success: (devices: ZebraDevice[]) => void,
        error: (msg: string) => void,
        type: "printer"
      ) => void;
    };
  }
}

export interface ZebraDevice {
  name: string;
  uid: string;
  connection: string;
  send: (
    data: string,
    success?: () => void,
    error?: (msg: string) => void
  ) => void;
}

export interface LabelData {
  sku: string;
  name: string;
  barcodeValue: string; // encoded in the QR code — scanned back in on checkout
  category?: string | null;
}

/**
 * Builds ZPL for a 2" x 1" label (203dpi): QR code on the left, SKU + name on
 * the right, so it's readable at a glance on a shelf/bin and scannable by the
 * tech's tablet or a handheld scanner.
 */
export function buildPartLabelZPL(label: LabelData, copies = 1): string {
  const safeName = label.name.slice(0, 28).replace(/[\^~]/g, "");
  const safeSku = label.sku.replace(/[\^~]/g, "");
  const safeCategory = (label.category ?? "").slice(0, 24).replace(/[\^~]/g, "");

  return `
^XA
^PW406
^LL203
^CF0,22

^FO20,20
^BQN,2,4
^FDQA,${label.barcodeValue}^FS

^FO160,25
^A0N,26,26
^FD${safeSku}^FS

^FO160,58
^A0N,20,20
^FB230,2,0,L
^FD${safeName}^FS

^FO160,130
^A0N,18,18
^FD${safeCategory}^FS

^FO20,175
^A0N,16,16
^FD${label.barcodeValue}^FS

^PQ${copies}
^XZ
`.trim();
}

/** Resolves the default Zebra printer registered with Browser Print. */
export function getDefaultZebraPrinter(): Promise<ZebraDevice> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.BrowserPrint) {
      reject(
        new Error(
          "Zebra Browser Print isn't detected. Make sure the Browser Print app is running on this machine and the printer is connected."
        )
      );
      return;
    }
    window.BrowserPrint.getDefaultDevice(
      "printer",
      (device) => resolve(device),
      (msg) => reject(new Error(msg || "No default Zebra printer found."))
    );
  });
}

/** Lists every Zebra printer Browser Print can see (USB, network, Bluetooth). */
export function listZebraPrinters(): Promise<ZebraDevice[]> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.BrowserPrint) {
      reject(new Error("Zebra Browser Print isn't detected on this machine."));
      return;
    }
    window.BrowserPrint.getLocalDevices(
      (devices) => resolve(devices ?? []),
      (msg) => reject(new Error(msg || "Couldn't list Zebra printers.")),
      "printer"
    );
  });
}

/** Sends raw ZPL to a specific device (or the default one if none passed). */
export async function printLabel(label: LabelData, copies = 1, device?: ZebraDevice) {
  const target = device ?? (await getDefaultZebraPrinter());
  const zpl = buildPartLabelZPL(label, copies);
  return new Promise<void>((resolve, reject) => {
    target.send(
      zpl,
      () => resolve(),
      (msg) => reject(new Error(msg || "Print failed."))
    );
  });
}
