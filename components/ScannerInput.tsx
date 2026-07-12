"use client";

import { useEffect, useRef, useState } from "react";

interface ScannerInputProps {
  onScan: (value: string) => void;
  placeholder?: string;
}

/**
 * Two scan paths in one control:
 *  - Dedicated Bluetooth/USB barcode scanners act as a keyboard ("HID wedge") —
 *    they just type the code into whatever's focused and send Enter. We keep
 *    this input auto-focused so that just works with zero extra code.
 *  - "Use camera" opens the tablet's camera and reads codes with html5-qrcode
 *    for warehouses without dedicated scanner hardware.
 */
export default function ScannerInput({ onScan, placeholder }: ScannerInputProps) {
  const [manualValue, setManualValue] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!cameraOpen) return;

    let cancelled = false;
    import("html5-qrcode").then(({ Html5Qrcode }) => {
      if (cancelled) return;
      const scanner = new Html5Qrcode("camera-scan-region");
      scannerRef.current = scanner;
      scanner
        .start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decodedText) => {
            onScan(decodedText);
            stopCamera();
          },
          () => {
            /* ignore per-frame decode failures */
          }
        )
        .catch((err) => {
          console.error("Camera scan failed to start", err);
          setCameraOpen(false);
        });
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOpen]);

  function stopCamera() {
    scannerRef.current?.stop().then(() => scannerRef.current?.clear());
    setCameraOpen(false);
    inputRef.current?.focus();
  }

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = manualValue.trim();
    if (!value) return;
    onScan(value);
    setManualValue("");
  }

  return (
    <div className="w-full">
      <form onSubmit={handleManualSubmit} className="flex gap-2">
        <input
          ref={inputRef}
          value={manualValue}
          onChange={(e) => setManualValue(e.target.value)}
          placeholder={placeholder ?? "Scan or type a part barcode"}
          className="tap-target flex-1 rounded-lg border-2 border-nexus-steel/30 bg-white px-4 text-lg focus:border-nexus-amber focus:outline-none"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => setCameraOpen((v) => !v)}
          className="tap-target rounded-lg bg-nexus-navy px-4 text-white"
        >
          {cameraOpen ? "Close camera" : "Use camera"}
        </button>
      </form>

      {cameraOpen && (
        <div className="mt-3 overflow-hidden rounded-lg border-2 border-nexus-steel/30">
          <div id="camera-scan-region" />
        </div>
      )}
    </div>
  );
}
