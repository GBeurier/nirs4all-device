import { makeCaptureId } from "@/domain/spectrum";
import type {
  DeviceDescriptor,
  DeviceStatus,
  ScanConfiguration,
  ScanProgress,
  Spectrum,
  SpectrumCapture,
  SpectrometerDevice,
} from "@/domain/types";

const SIM_DESCRIPTOR: DeviceDescriptor = {
  id: "sim-nano",
  name: "Simulated DLP NIRscan Nano",
  model: "DLP NIRscan Nano",
  manufacturer: "Texas Instruments",
  transport: "simulator",
};

const CONFIGS: ScanConfiguration[] = [
  { id: "0", name: "Diffuse reflectance 900-1700", wavelengthStartNm: 900, wavelengthEndNm: 1700, widthPx: 6, numPatterns: 228, numRepeats: 6, active: true },
  { id: "1", name: "Fast triage 1100-1650", wavelengthStartNm: 1100, wavelengthEndNm: 1650, widthPx: 8, numPatterns: 140, numRepeats: 3 },
];

export class SimulatedNirscanNanoDevice implements SpectrometerDevice {
  readonly descriptor = SIM_DESCRIPTOR;
  #active = CONFIGS[0].id;

  async connect(): Promise<DeviceStatus> {
    await delay(220);
    return this.readStatus();
  }

  async disconnect(): Promise<void> {
    await delay(80);
  }

  async readStatus(): Promise<DeviceStatus> {
    return {
      connected: true,
      batteryPct: 82,
      temperatureC: 27.4,
      humidityPct: 44.2,
      firmware: "sim-2.1.0",
      hardware: "nano-evm",
      serialNumber: "SIM-NANO-0001",
      activeConfigurationId: this.#active,
      storedScans: 4,
      statusText: "ready",
    };
  }

  async listConfigurations(): Promise<ScanConfiguration[]> {
    return CONFIGS.map((config) => ({ ...config, active: config.id === this.#active }));
  }

  async setActiveConfiguration(id: string): Promise<void> {
    this.#active = id;
  }

  async startScan(
    options: { saveToDevice: boolean; sampleId: string },
    onProgress?: (progress: ScanProgress) => void,
  ): Promise<SpectrumCapture> {
    const config = CONFIGS.find((item) => item.id === this.#active) ?? CONFIGS[0];
    for (const progress of [
      { phase: "prepare", pct: 12, message: "warming lamps" },
      { phase: "scan", pct: 45, message: "collecting reflectance" },
      { phase: "transfer", pct: 72, message: "streaming spectrum" },
      { phase: "decode", pct: 90, message: "normalizing axis" },
    ] as ScanProgress[]) {
      onProgress?.(progress);
      await delay(180);
    }
    const capture = makeSimulatedCapture(options.sampleId, config, options.saveToDevice ? ["saved"] : []);
    onProgress?.({ phase: "done", pct: 100 });
    return capture;
  }

  async listStoredScans(): Promise<number[]> {
    return [1001, 1002, 1003, 1004];
  }

  async readStoredScan(index: number, onProgress?: (progress: ScanProgress) => void): Promise<SpectrumCapture> {
    onProgress?.({ phase: "transfer", pct: 50, message: "reading simulated SD slot" });
    await delay(160);
    onProgress?.({ phase: "done", pct: 100 });
    return makeSimulatedCapture(`stored-${index}`, CONFIGS[0], ["stored"]);
  }
}

export function makeSimulatedCapture(sampleId = "sample-001", config = CONFIGS[0], extraTags: string[] = []): SpectrumCapture {
  const spectrum = simulatedSpectrum(config);
  return {
    id: makeCaptureId("sim"),
    sampleId,
    createdAt: new Date().toISOString(),
    source: "simulated",
    device: SIM_DESCRIPTOR,
    configuration: config,
    spectrum,
    tags: ["simulated", ...extraTags],
  };
}

function simulatedSpectrum(config: ScanConfiguration): Spectrum {
  const n = Math.max(120, config.numPatterns ?? 180);
  const axis = Array.from({ length: n }, (_, i) => config.wavelengthStartNm + (i * (config.wavelengthEndNm - config.wavelengthStartNm)) / (n - 1));
  const seed = Math.random() * 0.08;
  const values = axis.map((x, i) => {
    const baseline = 0.42 + 0.08 * Math.sin((x - 900) / 120);
    const water = -0.12 * gaussian(x, 1450, 55);
    const protein = -0.07 * gaussian(x, 1210, 40);
    const starch = -0.05 * gaussian(x, 1660, 35);
    const noise = Math.sin(i * 1.7 + seed) * 0.003 + (Math.random() - 0.5) * 0.002;
    return round6(baseline + water + protein + starch + noise);
  });
  return { axis: axis.map((x) => Math.round(x * 100) / 100), values, axisUnit: "nm", signalType: "reflectance" };
}

function gaussian(x: number, mu: number, sigma: number): number {
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z);
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
