import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "org.nirs4all.device",
  appName: "nirs4all Device",
  webDir: "dist",
  plugins: {
    BluetoothLe: {
      displayStrings: {
        scanning: "Scanning for NIRS devices...",
        cancel: "Cancel",
        availableDevices: "Available NIRS devices",
        noDeviceFound: "No device found",
      },
    },
  },
};

export default config;
