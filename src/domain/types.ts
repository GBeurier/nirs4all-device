export type TransportKind = "simulator" | "ble" | "usb";

export type DeviceConnectionState = "idle" | "scanning" | "connecting" | "connected" | "busy" | "error";

export interface DeviceDescriptor {
  id: string;
  name: string;
  model: string;
  manufacturer?: string;
  transport: TransportKind;
  rssi?: number;
}

export interface DeviceStatus {
  connected: boolean;
  batteryPct?: number;
  temperatureC?: number;
  humidityPct?: number;
  firmware?: string;
  hardware?: string;
  serialNumber?: string;
  activeConfigurationId?: string;
  storedScans?: number;
  statusText?: string;
}

export interface ScanConfiguration {
  id: string;
  name: string;
  wavelengthStartNm: number;
  wavelengthEndNm: number;
  widthPx?: number;
  numPatterns?: number;
  numRepeats?: number;
  active?: boolean;
  raw?: number[];
}

export interface Spectrum {
  axis: number[];
  values: number[];
  axisUnit: "nm" | "cm-1";
  signalType: "intensity" | "reflectance" | "absorbance" | "unknown";
}

export interface SpectrumCapture {
  id: string;
  sampleId: string;
  createdAt: string;
  source: "live" | "stored" | "imported" | "simulated";
  device: DeviceDescriptor;
  configuration?: ScanConfiguration;
  spectrum?: Spectrum;
  rawPayloadBase64?: string;
  quality?: QualityReport;
  prediction?: PredictionResult;
  notes?: string;
  tags: string[];
}

export interface QualityMetric {
  id: string;
  label: string;
  value: number;
  unit?: string;
  threshold?: number;
  pass: boolean;
}

export interface QualityReport {
  status: "pass" | "warn" | "fail";
  score: number;
  metrics: QualityMetric[];
  flags: string[];
  evaluatedAt: string;
  engine: string;
}

export interface PipelineArtifact {
  id: string;
  name: string;
  importedAt: string;
  engine: string;
  nFeatures: number;
  targetName?: string;
  raw: unknown;
}

export interface PredictionResult {
  pipelineId: string;
  pipelineName: string;
  value: number;
  label?: string;
  unit?: string;
  predictedAt: string;
  engine: string;
}

export interface ScanProgress {
  phase: "prepare" | "scan" | "transfer" | "decode" | "quality" | "done";
  pct: number;
  message?: string;
}

export interface SpectrometerDevice {
  readonly descriptor: DeviceDescriptor;
  connect(): Promise<DeviceStatus>;
  disconnect(): Promise<void>;
  readStatus(): Promise<DeviceStatus>;
  listConfigurations(): Promise<ScanConfiguration[]>;
  setActiveConfiguration(id: string): Promise<void>;
  startScan(options: { saveToDevice: boolean; sampleId: string }, onProgress?: (progress: ScanProgress) => void): Promise<SpectrumCapture>;
  listStoredScans(): Promise<number[]>;
  readStoredScan(index: number, onProgress?: (progress: ScanProgress) => void): Promise<SpectrumCapture>;
}
