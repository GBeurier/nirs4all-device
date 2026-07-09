import { Capacitor, registerPlugin } from "@capacitor/core";
import type { Spectrum } from "@/domain/types";

interface NanoSpectrumPlugin {
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  interpretReference(options: {
    scanDataBase64: string;
    referenceCoefficientsBase64: string;
    referenceMatrixBase64: string;
  }): Promise<{
    axis: number[];
    intensity: number[];
    reflectance: number[];
    absorbance: number[];
    axisUnit: "nm";
    length: number;
  }>;
}

const NanoSpectrum = registerPlugin<NanoSpectrumPlugin>("NanoSpectrum");

export async function decodeNanoSpectrumNative(options: {
  scanDataBase64: string;
  referenceCoefficientsBase64: string;
  referenceMatrixBase64: string;
}): Promise<{ spectrum?: Spectrum; notes?: string } | null> {
  if (Capacitor.getPlatform() !== "android") return null;
  const availability = await NanoSpectrum.isAvailable().catch((error) => ({
    available: false,
    reason: error instanceof Error ? error.message : String(error),
  }));
  if (!availability.available) {
    return { notes: availability.reason ?? "Native Spectrum C bridge is unavailable." };
  }
  const decoded = await NanoSpectrum.interpretReference(options);
  return {
    spectrum: {
      axis: decoded.axis.map(Number),
      values: decoded.reflectance.map(Number),
      axisUnit: decoded.axisUnit,
      signalType: "reflectance",
    },
  };
}
