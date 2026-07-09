import { makeCaptureId, encodeBytesBase64 } from "@/domain/spectrum";
import type {
  DeviceDescriptor,
  DeviceStatus,
  ScanConfiguration,
  ScanProgress,
  SpectrumCapture,
  SpectrometerDevice,
} from "@/domain/types";
import type { BleTransport, BleTransportDevice } from "../transport";
import { NANO_OPTIONAL_SERVICES, NANO_UUID } from "./constants";
import {
  appendMultipartPacket,
  currentNanoDateBytes,
  int16le,
  littleEndianIndex,
  parseConfigurationFallback,
  parseStartScanNotification,
  uint16le,
  uint32le,
  utf8,
} from "./protocol";

const S = NANO_UUID.services;
const C = NANO_UUID.characteristics;

export class DlpNirscanNanoDevice implements SpectrometerDevice {
  readonly descriptor: DeviceDescriptor;
  #transport: BleTransport;
  #device: BleTransportDevice;

  private constructor(transport: BleTransport, device: BleTransportDevice) {
    this.#transport = transport;
    this.#device = device;
    this.descriptor = {
      id: device.id,
      name: device.name,
      model: device.model,
      manufacturer: device.manufacturer,
      transport: "ble",
    };
  }

  static async request(transport: BleTransport): Promise<DlpNirscanNanoDevice> {
    const device = await transport.scan({
      namePrefix: "NIR",
      services: [],
      optionalServices: NANO_OPTIONAL_SERVICES,
    });
    return new DlpNirscanNanoDevice(transport, device);
  }

  async connect(): Promise<DeviceStatus> {
    await this.#transport.connect(this.#device.deviceId);
    await this.#write(S.dateTime, C.dateTime, currentNanoDateBytes());
    return this.readStatus();
  }

  async disconnect(): Promise<void> {
    await this.#transport.disconnect(this.#device.deviceId);
  }

  async readStatus(): Promise<DeviceStatus> {
    const [battery, temp, humidity, firmware, hardware, serialNumber, activeConf, storedScans] = await Promise.allSettled([
      this.#read(S.battery, C.batteryLevel).then((b) => b[0]),
      this.#read(S.generalInformation, C.temperature).then((b) => int16le(b) / 100),
      this.#read(S.generalInformation, C.humidity).then((b) => uint16le(b) / 100),
      this.#read(S.deviceInformation, C.firmwareRevision).then(utf8),
      this.#read(S.deviceInformation, C.hardwareRevision).then(utf8),
      this.#read(S.deviceInformation, C.serialNumber).then(utf8),
      this.#read(S.scanConfiguration, C.activeScanConfiguration).then((b) => String(uint16le(b))),
      this.#read(S.scanData, C.numberStoredScans).then((b) => uint32le(b)),
    ]);
    return {
      connected: true,
      batteryPct: valueOf(battery),
      temperatureC: valueOf(temp),
      humidityPct: valueOf(humidity),
      firmware: valueOf(firmware),
      hardware: valueOf(hardware),
      serialNumber: valueOf(serialNumber),
      activeConfigurationId: valueOf(activeConf),
      storedScans: valueOf(storedScans),
    };
  }

  async listConfigurations(): Promise<ScanConfiguration[]> {
    const active = await this.#read(S.scanConfiguration, C.activeScanConfiguration).then((b) => uint16le(b)).catch(() => 0);
    const rawList = await this.#requestMultipart(S.scanConfiguration, C.requestStoredConfigurationList, C.returnStoredConfigurationList, new Uint8Array([0]));
    const ids = rawList.length >= 2 ? parseUint16List(rawList) : [active || 0];
    return ids.map((id) => ({
      id: String(id),
      name: id === active ? "Active Nano configuration" : `Nano configuration ${id}`,
      wavelengthStartNm: 900,
      wavelengthEndNm: 1700,
      active: id === active,
    }));
  }

  async setActiveConfiguration(id: string): Promise<void> {
    await this.#write(S.scanConfiguration, C.activeScanConfiguration, littleEndianIndex(Number(id), 2));
  }

  async startScan(
    options: { saveToDevice: boolean; sampleId: string },
    onProgress?: (progress: ScanProgress) => void,
  ): Promise<SpectrumCapture> {
    onProgress?.({ phase: "prepare", pct: 8, message: "syncing scan command" });
    const notifications = await this.#collectStartScan(options.saveToDevice);
    onProgress?.({ phase: "transfer", pct: 58, message: "reading serialized scan payload" });
    const scanIndex = notifications.index ?? 0;
    const raw = await this.#requestMultipart(S.scanData, C.requestSerializedScanData, C.returnSerializedScanData, littleEndianIndex(scanIndex, 4));
    onProgress?.({ phase: "decode", pct: 78, message: "preserving Nano payload" });
    const configRaw = await this.#requestMultipart(S.scanConfiguration, C.requestScanConfigurationData, C.returnScanConfigurationData, littleEndianIndex(scanIndex, 2)).catch(() => new Uint8Array());
    onProgress?.({ phase: "done", pct: 100 });
    return {
      id: makeCaptureId("nano"),
      sampleId: options.sampleId,
      createdAt: new Date().toISOString(),
      source: "live",
      device: this.descriptor,
      configuration: parseConfigurationFallback(scanIndex, configRaw),
      rawPayloadBase64: encodeBytesBase64(raw),
      tags: ["nano", "raw"],
      notes: "Raw DLP NIRscan Nano payload. Numeric decoding requires the Spectrum C/Nano reader surface.",
    };
  }

  async listStoredScans(): Promise<number[]> {
    const raw = await this.#requestMultipart(S.scanData, C.requestStoredScanIndices, C.returnStoredScanIndices, new Uint8Array([0]));
    const out: number[] = [];
    for (let offset = 0; offset + 3 < raw.length; offset += 4) out.push(uint32le(raw, offset));
    return out;
  }

  async readStoredScan(index: number, onProgress?: (progress: ScanProgress) => void): Promise<SpectrumCapture> {
    onProgress?.({ phase: "transfer", pct: 35, message: "reading stored scan payload" });
    const raw = await this.#requestMultipart(S.scanData, C.requestSerializedScanData, C.returnSerializedScanData, littleEndianIndex(index, 4));
    onProgress?.({ phase: "done", pct: 100 });
    return {
      id: makeCaptureId("nano"),
      sampleId: `stored-${index}`,
      createdAt: new Date().toISOString(),
      source: "stored",
      device: this.descriptor,
      configuration: { id: String(index), name: `Stored scan ${index}`, wavelengthStartNm: 900, wavelengthEndNm: 1700 },
      rawPayloadBase64: encodeBytesBase64(raw),
      tags: ["nano", "stored", "raw"],
    };
  }

  async #collectStartScan(saveToDevice: boolean): Promise<{ completed: boolean; index: number | null }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let subscription: { unsubscribe(): Promise<void> } | null = null;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        void subscription?.unsubscribe();
        reject(new Error("Nano scan timed out before completion notification."));
      }, 120_000);

      this.#transport
        .notify(this.#device.deviceId, S.scanData, C.startScan, (data) => {
          const parsed = parseStartScanNotification(data);
          if (!parsed.completed || settled) return;
          settled = true;
          window.clearTimeout(timeout);
          void subscription?.unsubscribe();
          resolve(parsed);
        })
        .then((sub) => {
          subscription = sub;
          return this.#write(S.scanData, C.startScan, new Uint8Array([saveToDevice ? 1 : 0]));
        })
        .catch((error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          reject(error);
        });
    });
  }

  async #requestMultipart(service: string, requestCharacteristic: string, returnCharacteristic: string, request: Uint8Array): Promise<Uint8Array> {
    const packets: Uint8Array[] = [];
    return new Promise((resolve, reject) => {
      let settled = false;
      let subscription: { unsubscribe(): Promise<void> } | null = null;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        void subscription?.unsubscribe();
        reject(new Error(`Nano multipart transfer timed out for ${returnCharacteristic}.`));
      }, 45_000);
      this.#transport
        .notify(this.#device.deviceId, service, returnCharacteristic, (packet) => {
          const result = appendMultipartPacket(packets, packet);
          if (!result.done || !result.payload || settled) return;
          settled = true;
          window.clearTimeout(timeout);
          void subscription?.unsubscribe();
          resolve(result.payload);
        })
        .then((sub) => {
          subscription = sub;
          return this.#write(service, requestCharacteristic, request);
        })
        .catch((error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          reject(error);
        });
    });
  }

  #read(service: string, characteristic: string): Promise<Uint8Array> {
    return this.#transport.read(this.#device.deviceId, service, characteristic);
  }

  #write(service: string, characteristic: string, data: Uint8Array): Promise<void> {
    return this.#transport.write(this.#device.deviceId, service, characteristic, data);
  }
}

function parseUint16List(raw: Uint8Array): number[] {
  const out: number[] = [];
  for (let offset = 0; offset + 1 < raw.length; offset += 2) out.push(uint16le(raw, offset));
  return out;
}

function valueOf<T>(result: PromiseSettledResult<T>): T | undefined {
  return result.status === "fulfilled" ? result.value : undefined;
}
