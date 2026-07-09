import { describe, expect, it } from "vitest";
import { buildSpectrumEnvelope } from "@/domain/spectrum";
import { makeSimulatedCapture } from "@/device/simulatedDevice";

describe("spectrum envelopes", () => {
  it("builds quantile bands on the requested axis", () => {
    const a = makeSimulatedCapture("a");
    const b = makeSimulatedCapture("b");
    const c = makeSimulatedCapture("c");
    a.spectrum = { axis: [1, 2, 3], values: [1, 2, 3], axisUnit: "nm", signalType: "reflectance" };
    b.spectrum = { axis: [1, 2, 3], values: [2, 4, 6], axisUnit: "nm", signalType: "reflectance" };
    c.spectrum = { axis: [1, 3], values: [3, 9], axisUnit: "nm", signalType: "reflectance" };

    const envelope = buildSpectrumEnvelope([a, b, c], [1, 2, 3], "Project", 0, 1);

    expect(envelope?.lower).toEqual([1, 2, 3]);
    expect(envelope?.median).toEqual([2, 4, 6]);
    expect(envelope?.upper).toEqual([3, 6, 9]);
  });
});
