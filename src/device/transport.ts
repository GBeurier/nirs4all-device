import type { DeviceDescriptor } from "@/domain/types";

export interface BleNotificationSubscription {
  unsubscribe(): Promise<void>;
}

export interface BleTransportDevice extends DeviceDescriptor {
  deviceId: string;
}

export interface BleTransport {
  scan(filters: { namePrefix?: string; services: string[]; optionalServices: string[] }): Promise<BleTransportDevice>;
  connect(deviceId: string): Promise<void>;
  disconnect(deviceId: string): Promise<void>;
  read(deviceId: string, service: string, characteristic: string): Promise<Uint8Array>;
  write(deviceId: string, service: string, characteristic: string, data: Uint8Array): Promise<void>;
  notify(
    deviceId: string,
    service: string,
    characteristic: string,
    onData: (data: Uint8Array) => void,
  ): Promise<BleNotificationSubscription>;
}

export interface UsbTransport {
  available(): boolean;
  explainUnavailable(): string | null;
}
