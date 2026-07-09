import { BleClient, type BleDevice } from "@capacitor-community/bluetooth-le";
import type { BleNotificationSubscription, BleTransport, BleTransportDevice } from "./transport";

export class CapacitorBleTransport implements BleTransport {
  #initialized = false;

  async scan(filters: { namePrefix?: string; services: string[]; optionalServices: string[] }): Promise<BleTransportDevice> {
    await this.#init();
    const device = await BleClient.requestDevice({
      namePrefix: filters.namePrefix,
      services: filters.services,
      optionalServices: filters.optionalServices,
    });
    return toTransportDevice(device);
  }

  async connect(deviceId: string): Promise<void> {
    await this.#init();
    await BleClient.connect(deviceId);
  }

  async disconnect(deviceId: string): Promise<void> {
    await BleClient.disconnect(deviceId);
  }

  async read(deviceId: string, service: string, characteristic: string): Promise<Uint8Array> {
    const value = await BleClient.read(deviceId, service, characteristic);
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }

  async write(deviceId: string, service: string, characteristic: string, data: Uint8Array): Promise<void> {
    await BleClient.write(deviceId, service, characteristic, new DataView(data.buffer, data.byteOffset, data.byteLength));
  }

  async notify(
    deviceId: string,
    service: string,
    characteristic: string,
    onData: (data: Uint8Array) => void,
  ): Promise<BleNotificationSubscription> {
    await BleClient.startNotifications(deviceId, service, characteristic, (value) => {
      onData(new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)));
    });
    return {
      unsubscribe: () => BleClient.stopNotifications(deviceId, service, characteristic),
    };
  }

  async #init(): Promise<void> {
    if (this.#initialized) return;
    await BleClient.initialize();
    this.#initialized = true;
  }
}

function toTransportDevice(device: BleDevice): BleTransportDevice {
  return {
    id: device.deviceId,
    deviceId: device.deviceId,
    name: device.name ?? "DLP NIRscan Nano",
    model: "DLP NIRscan Nano",
    transport: "ble",
  };
}
