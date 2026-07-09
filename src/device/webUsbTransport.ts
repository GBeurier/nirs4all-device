import type { UsbTransport } from "./transport";

declare global {
  interface Navigator {
    usb?: unknown;
    hid?: unknown;
  }
}

export class BrowserUsbTransport implements UsbTransport {
  available(): boolean {
    return Boolean(navigator.hid || navigator.usb);
  }

  explainUnavailable(): string | null {
    if (this.available()) return null;
    return "This browser WebView does not expose WebHID/WebUSB. Use BLE on phones/tablets, or add a native Capacitor USB adapter for Android OTG.";
  }
}
