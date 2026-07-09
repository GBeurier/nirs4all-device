import { describe, expect, it } from "vitest";
import { makeSimulatedCapture } from "@/device/simulatedDevice";
import { buildExport } from "@/storage/export";

describe("exports", () => {
  it("builds a single spectrum CSV", () => {
    const file = buildExport([makeSimulatedCapture("s1")], "single-csv");
    expect(file.filename.endsWith(".csv")).toBe(true);
    expect(file.text.split("\n")[0]).toBe("sample_id,capture_id,created_at,axis,value,axis_unit,signal_type");
    expect(file.text).toContain("s1");
  });

  it("builds a matrix CSV", () => {
    const file = buildExport([makeSimulatedCapture("s1"), makeSimulatedCapture("s2")], "matrix-csv");
    const lines = file.text.split("\n");
    expect(lines[0].startsWith("sample_id,x_")).toBe(true);
    expect(lines).toHaveLength(3);
  });

  it("builds a JSON bundle", () => {
    const file = buildExport([makeSimulatedCapture("s1")], "json");
    const parsed = JSON.parse(file.text) as { schema: string; captures: unknown[] };
    expect(parsed.schema).toBe("nirs4all-device.captures.v1");
    expect(parsed.captures).toHaveLength(1);
  });
});
