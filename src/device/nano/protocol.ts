import type { ScanConfiguration } from "@/domain/types";

export function uint16le(bytes: Uint8Array, offset = 0): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

export function uint32le(bytes: Uint8Array, offset = 0): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

export function int16le(bytes: Uint8Array, offset = 0): number {
  const value = uint16le(bytes, offset);
  return value & 0x8000 ? value - 0x10000 : value;
}

export function littleEndianIndex(index: number, width = 4): Uint8Array {
  const out = new Uint8Array(width);
  for (let i = 0; i < width; i += 1) out[i] = (index >> (8 * i)) & 0xff;
  return out;
}

export function utf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(trimNull(bytes));
}

export function currentNanoDateBytes(date = new Date()): Uint8Array {
  return new Uint8Array([
    date.getFullYear() - 2000,
    date.getMonth() + 1,
    date.getDate(),
    date.getDay(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  ]);
}

export function parseStartScanNotification(bytes: Uint8Array): { completed: boolean; index: number | null } {
  if (bytes.length === 0) return { completed: false, index: null };
  if (bytes[0] === 0xff) {
    return { completed: true, index: bytes.length >= 5 ? uint32le(bytes, 1) : null };
  }
  return { completed: false, index: bytes.length >= 4 ? uint32le(bytes, 0) : null };
}

export function appendMultipartPacket(packets: Uint8Array[], packet: Uint8Array): { done: boolean; payload: Uint8Array | null } {
  if (packet.length === 0) return { done: false, payload: null };
  packets.push(packet);
  if (packets.length === 1) return { done: false, payload: null };
  const expectedLength = packets[0][1] ?? 0;
  const data = packets.slice(1).flatMap((part, i) => Array.from(part.slice(i === 0 ? 2 : 1)));
  if (expectedLength > 0 && data.length >= expectedLength) {
    return { done: true, payload: Uint8Array.from(data.slice(0, expectedLength)) };
  }
  return { done: false, payload: null };
}

export function parseConfigurationFallback(index: number, raw: Uint8Array): ScanConfiguration {
  return {
    id: String(index),
    name: raw.length > 0 ? `Nano config ${index}` : "Default Nano config",
    wavelengthStartNm: 900,
    wavelengthEndNm: 1700,
    raw: Array.from(raw),
  };
}

function trimNull(bytes: Uint8Array): Uint8Array {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end -= 1;
  return bytes.slice(0, end);
}
