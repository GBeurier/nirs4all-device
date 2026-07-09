import { describe, expect, it } from "vitest";
import {
  appendMultipartPacket,
  currentNanoDateBytes,
  littleEndianIndex,
  parseStartScanNotification,
  uint16le,
  uint32le,
} from "@/device/nano/protocol";

describe("Nano protocol helpers", () => {
  it("reads little-endian integers", () => {
    expect(uint16le(new Uint8Array([0x34, 0x12]))).toBe(0x1234);
    expect(uint32le(new Uint8Array([0x78, 0x56, 0x34, 0x12]))).toBe(0x12345678);
    expect(Array.from(littleEndianIndex(0x12345678, 4))).toEqual([0x78, 0x56, 0x34, 0x12]);
  });

  it("parses scan completion notifications", () => {
    expect(parseStartScanNotification(new Uint8Array([0xff, 0x2a, 0, 0, 0]))).toEqual({ completed: true, index: 42 });
    expect(parseStartScanNotification(new Uint8Array([1, 0, 0, 0]))).toEqual({ completed: false, index: 1 });
  });

  it("assembles multi-packet payloads", () => {
    const packets: Uint8Array[] = [];
    expect(appendMultipartPacket(packets, new Uint8Array([0, 5])).done).toBe(false);
    expect(appendMultipartPacket(packets, new Uint8Array([1, 0, 10, 11, 12])).done).toBe(false);
    const done = appendMultipartPacket(packets, new Uint8Array([2, 13, 14, 15]));
    expect(done.done).toBe(true);
    expect(Array.from(done.payload ?? [])).toEqual([10, 11, 12, 13, 14]);
  });

  it("encodes Nano date bytes", () => {
    const bytes = currentNanoDateBytes(new Date("2026-07-09T11:12:13Z"));
    expect(bytes[0]).toBe(26);
    expect(bytes[1]).toBe(7);
    expect(bytes[2]).toBe(9);
  });
});
