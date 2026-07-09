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
  #scanIndex = 0;

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
    this.#scanIndex += 1;
    const capture = makeSimulatedCapture(options.sampleId, config, options.saveToDevice ? ["saved"] : [], this.#scanIndex);
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

export function makeSimulatedCapture(sampleId = "sample-001", config = CONFIGS[0], extraTags: string[] = [], scanIndex = 0): SpectrumCapture {
  const spectrum = simulatedSpectrum(config);
  return {
    id: makeCaptureId("sim"),
    sampleId,
    createdAt: new Date().toISOString(),
    source: "simulated",
    device: SIM_DESCRIPTOR,
    configuration: config,
    spectrum,
    tags: ["simulated", scanIndex > 0 ? `sim-${scanIndex}` : "", ...extraTags].filter(Boolean),
  };
}

function simulatedSpectrum(config: ScanConfiguration): Spectrum {
  const n = Math.max(120, config.numPatterns ?? 180);
  const axis = Array.from({ length: n }, (_, i) => config.wavelengthStartNm + (i * (config.wavelengthEndNm - config.wavelengthStartNm)) / (n - 1));
  const seed = Math.random() * Math.PI * 2;
  const scatter = 0.94 + Math.random() * 0.14;
  const baselineOffset = (Math.random() - 0.5) * 0.045;
  const slope = (Math.random() - 0.5) * 0.055;
  const waterDepth = 0.095 + Math.random() * 0.06;
  const proteinDepth = 0.045 + Math.random() * 0.045;
  const starchDepth = 0.03 + Math.random() * 0.04;
  const waterCenter = 1450 + (Math.random() - 0.5) * 8;
  const proteinCenter = 1210 + (Math.random() - 0.5) * 6;
  const starchCenter = 1660 + (Math.random() - 0.5) * 6;
  const lowFrequencyRipple = (Math.random() - 0.5) * 0.018;
  const noiseAmplitude = 0.0035 + Math.random() * 0.0045;
  const mid = (config.wavelengthStartNm + config.wavelengthEndNm) / 2;
  const span = Math.max(1, config.wavelengthEndNm - config.wavelengthStartNm);
  const values = axis.map((x, i) => {
    const xNorm = (x - mid) / span;
    const baseline = 0.42 + 0.08 * Math.sin((x - 900) / 120) + baselineOffset + slope * xNorm;
    const water = -waterDepth * gaussian(x, waterCenter, 55);
    const protein = -proteinDepth * gaussian(x, proteinCenter, 40);
    const starch = -starchDepth * gaussian(x, starchCenter, 35);
    const ripple = lowFrequencyRipple * Math.sin((x - config.wavelengthStartNm) / 80 + seed);
    const detectorTexture = Math.sin(i * 1.7 + seed) * 0.0025;
    const noise = detectorTexture + (Math.random() - 0.5) * noiseAmplitude;
    return round6((baseline + water + protein + starch + ripple) * scatter + noise);
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
