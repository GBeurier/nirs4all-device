import { describe, expect, it } from "vitest";
import { makeSimulatedCapture } from "@/device/simulatedDevice";
import { summarizeSpectrum } from "@/runtime/spectrumStats";

describe("summarizeSpectrum", () => {
  it("summarizes finite spectrum values", () => {
    const capture = makeSimulatedCapture("stats");
    capture.spectrum = {
      axis: [1, 2, 3, 4],
      values: [1, 2, Number.NaN, 4],
      axisUnit: "nm",
      signalType: "reflectance",
    };

    const stats = summarizeSpectrum(capture);

    expect(stats).toMatchObject({
      bands: 4,
      finiteShare: 0.75,
      min: 1,
      max: 4,
      mean: 7 / 3,
      range: 3,
    });
    expect(stats?.std).toBeCloseTo(1.5275, 4);
  });

  it("returns null without a decoded spectrum", () => {
    const capture = makeSimulatedCapture("raw");
    capture.spectrum = undefined;

    expect(summarizeSpectrum(capture)).toBeNull();
  });
});
