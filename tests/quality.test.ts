import { describe, expect, it } from "vitest";
import { LocalQualityEngine } from "@/runtime/quality";
import { makeSimulatedCapture } from "@/device/simulatedDevice";
import type { SpectrumCapture } from "@/domain/types";

describe("LocalQualityEngine", () => {
  it("passes a normal decoded simulated spectrum", async () => {
    const report = await new LocalQualityEngine().evaluate(makeSimulatedCapture());
    expect(report.status).not.toBe("fail");
    expect(report.metrics.length).toBeGreaterThan(3);
  });

  it("warns on raw payloads without decoded spectra", async () => {
    const capture = {
      ...makeSimulatedCapture(),
      spectrum: undefined,
      rawPayloadBase64: "AQID",
    } satisfies SpectrumCapture;
    const report = await new LocalQualityEngine().evaluate(capture);
    expect(report.status).toBe("warn");
    expect(report.flags).toContain("raw_payload_only");
  });

  it("fails flat spectra", async () => {
    const capture = makeSimulatedCapture();
    capture.spectrum = { axis: [1, 2, 3, 4], values: [0.4, 0.4, 0.4, 0.4], axisUnit: "nm", signalType: "reflectance" };
    const report = await new LocalQualityEngine().evaluate(capture);
    expect(report.flags).toContain("variance");
    expect(report.status).toBe("fail");
  });
});
