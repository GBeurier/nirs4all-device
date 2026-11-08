import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import * as methods from "@nirs4all/methods";
import * as spectra from "@/domain/spectrum";
import { alignSpectrum, requireSpectrumDescriptor } from "@/runtime/spectrumAlignment";
import { useSpectrumEnvelope } from "@/app/useSpectrumEnvelope";
import type { Spectrum, SpectrumCapture, SpectrumDescriptor, SpectrumEnvelope } from "@/domain/types";
import { makeSimulatedCapture } from "@/device/simulatedDevice";

// Wrap only the non-configurable ESM exports we observe; all owner numerics stay real.
vi.mock("@nirs4all/methods", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nirs4all/methods")>();
  return {
    ...actual,
    loadModule: vi.fn(actual.loadModule),
    Resampler: vi.fn(function (...args: ConstructorParameters<typeof actual.Resampler>) {
      return new actual.Resampler(...args);
    }),
  };
});

const reference: SpectrumDescriptor = { axis: [2.5, 1.5], axisUnit: "cm-1", signalType: "reflectance" };
function capture(id: string, spectrum?: Spectrum): SpectrumCapture {
  return { id, sampleId: "same sample", createdAt: "2026-11-08T00:00:00Z", source: "simulated",
    device: { id: "sim", name: "Simulator", model: "sim", transport: "simulator" }, tags: [], spectrum };
}
function source(axis = [3, 2, 1], values = [3, 2, 1]): Spectrum {
  return { axis, values, axisUnit: "cm-1", signalType: "reflectance" };
}

// These scientific cases require Root's real newly staged M1 Methods JS/WASM pair.
// They do not mock numerical outputs or qualify the retired Core runner.
describe("Methods spectrum alignment and envelopes", () => {
  it("coalesces first initialization across resampling and quantiles", async () => {
    const initialize = vi.mocked(methods.loadModule);
    initialize.mockClear();
    try {
      const [aligned, envelope] = await Promise.all([
        alignSpectrum(source(), reference),
        spectra.buildSpectrumEnvelope([capture("previous", { ...reference, values: [4, 6] })], reference, "Project"),
      ]);
      expect(aligned.values).toEqual([2.5, 1.5]); // descending counterexample
      expect(envelope.median).toEqual([4, 6]);
      expect(envelope.diagnostics?.finiteCounts).toEqual([1, 1]);
      expect(initialize).toHaveBeenCalledTimes(1);
    } finally {
      initialize.mockClear();
    }
  });

  it.each([
    [[1, 2, 3], [1, 2, 3], [1.5, 2.5]],
    [[3, 2, 1], [3, 2, 1], [1.5, 2.5]],
    [[1, 2, 3], [1, 2, 3], [2.5, 1.5]],
    [[3, 2, 1], [3, 2, 1], [2.5, 1.5]],
  ])("keeps paired source values and requested target order (%j, %j -> %j)", async (axis, values, target) => {
    const input = source(axis, values);
    const before = structuredClone(input);
    expect((await alignSpectrum(input, { ...reference, axis: target })).values).toEqual(target);
    expect(input).toEqual(before);
  });

  it("preserves the exact-grid object, node precision, signed zero and nonfinite values", async () => {
    const input = source([3, 2, 1], [Number.NaN, -0, Number.POSITIVE_INFINITY]);
    const construct = vi.mocked(methods.Resampler);
    construct.mockClear();
    try {
      const aligned = await alignSpectrum(input, { ...reference, axis: [3, 2, 1] });
      expect(aligned).toBe(input);
      expect(Number.isNaN(aligned.values[0])).toBe(true);
      expect(Object.is(aligned.values[1], -0)).toBe(true);
      expect(aligned.values[2]).toBe(Number.POSITIVE_INFINITY);
      expect(construct).not.toHaveBeenCalled();
    } finally { construct.mockClear(); }
  });

  it("admits endpoints and refuses outside-domain targets without clamping", async () => {
    expect((await alignSpectrum(source(), { ...reference, axis: [1, 3] })).values).toEqual([1, 3]);
    await expect(alignSpectrum(source(), { ...reference, axis: [0.5, 2] })).rejects.toThrow("outside source domain");
    await expect(alignSpectrum(source(), { ...reference, axis: [2, 3.5] })).rejects.toThrow("outside source domain");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("refuses nonfinite source values on a differing grid (%s)", async (value) => {
    await expect(alignSpectrum(source([3, 2, 1], [3, value, 1]), reference)).rejects.toThrow("nonfinite values on a differing grid are unsupported");
  });

  it("refuses unit and signal mismatches, even on equal axes", async () => {
    await expect(alignSpectrum({ ...reference, values: [1, 2], axisUnit: "nm" }, reference)).rejects.toThrow("unit mismatch");
    await expect(alignSpectrum({ ...reference, values: [1, 2], signalType: "absorbance" }, reference)).rejects.toThrow("signal type mismatch");
    await expect(alignSpectrum({ ...reference, values: [1, 2], signalType: "unknown" }, reference)).rejects.toThrow("must be known");
    await expect(alignSpectrum(source([3, 2, 1], [3, 2]), reference)).rejects.toThrow("paired");
  });

  it.each([
    [1], [1, 1], [1, 3, 2], [1, Number.NaN], [1, Number.POSITIVE_INFINITY], ["1", "2"],
  ].map((axis) => [axis]))("refuses invalid descriptors without numeric coercion (%j)", (axis) => {
    expect(() => requireSpectrumDescriptor({ ...reference, axis })).toThrow();
  });

  it("validates the target before handing it to Methods", async () => {
    await expect(alignSpectrum(source(), { ...reference, axis: [Number.NaN, 2] })).rejects.toThrow("finite numeric nodes");
    expect(() => requireSpectrumDescriptor({ axis: [1, 2], signalType: "reflectance" })).toThrow("axis unit");
  });

  it("uses owner p10/p50/p90 and preserves empty-column and singleton finite counts", async () => {
    const descriptor: SpectrumDescriptor = { axis: [1, 2, 3], axisUnit: "nm", signalType: "reflectance" };
    const rows = [[1, Number.NaN, Number.POSITIVE_INFINITY], [2, Number.NaN, Number.NEGATIVE_INFINITY], [3, Number.NaN, 7]];
    const envelope = await spectra.buildSpectrumEnvelope(rows.map((values, i) => capture(`c${i}`, { ...descriptor, values })), descriptor, "Project");
    expect(envelope.lower[0]).toBeCloseTo(1.2, 14);
    expect(envelope.median[0]).toBe(2);
    expect(envelope.upper[0]).toBeCloseTo(2.8, 14);
    expect([envelope.lower[1], envelope.median[1], envelope.upper[1]].every(Number.isNaN)).toBe(true);
    expect([envelope.lower[2], envelope.median[2], envelope.upper[2]]).toEqual([7, 7, 7]);
    expect(envelope.count).toBe(3);
    expect(envelope.diagnostics).toMatchObject({ status: "ready", totalCount: 3, finiteCounts: [3, 0, 1] });
  });

  it("accounts for selected, raw, refused and included captures by capture ID", async () => {
    const selected = capture("selected", { ...reference, values: [2.5, 1.5] });
    const raw = capture("raw");
    const refused = capture("wrong unit", { ...reference, values: [2, 1], axisUnit: "nm" });
    const previous = capture("another repetition", source());
    const envelope = await spectra.buildSpectrumEnvelope([selected, raw, refused, previous], reference, "Session", selected.id);
    expect(envelope.median).toEqual([2.5, 1.5]);
    expect(envelope.count).toBe(1);
    expect(envelope.diagnostics).toMatchObject({ totalCount: 4, includedCaptureIds: [previous.id], finiteCounts: [1, 1] });
    expect(envelope.diagnostics?.excluded.map((item) => item.captureId)).toEqual([selected.id, raw.id]);
    expect(envelope.diagnostics?.refused).toEqual([{ captureId: refused.id, reason: expect.stringContaining("unit mismatch") }]);
  });

  it("returns explicit unavailability instead of inventing an empty aggregate", async () => {
    const envelope = await spectra.buildSpectrumEnvelope([capture("raw")], reference, "Session");
    expect(envelope.count).toBe(0);
    expect(envelope.diagnostics).toMatchObject({ status: "unavailable", totalCount: 1, finiteCounts: null, unavailableReason: expect.any(String) });
    expect(envelope.lower.every(Number.isNaN)).toBe(true);
  });

  it("accounts for a raw selection when its reference descriptor is unavailable", async () => {
    const selected = capture("raw selected");
    const previous = capture("decoded", source());
    const result = await spectra.buildSpectrumEnvelope([selected, previous], undefined, "Project", selected.id);
    expect(result.axis).toEqual([]);
    expect(result.diagnostics).toMatchObject({ status: "unavailable", totalCount: 2, finiteCounts: null,
      excluded: [{ captureId: selected.id, reason: expect.any(String) }],
      refused: [{ captureId: previous.id, reason: expect.stringContaining("Reference descriptor unavailable") }] });
  });

  it("reports an owner failure without computing a local quantile fallback", async () => {
    const run = vi.spyOn(methods.FiniteColumnQuantiles.prototype, "run").mockImplementation(() => { throw new Error("owner failure"); });
    try {
      const envelope = await spectra.buildSpectrumEnvelope([capture("good", source())], reference, "Project");
      expect(envelope.diagnostics).toMatchObject({ status: "unavailable", totalCount: 1, includedCaptureIds: ["good"], finiteCounts: null, unavailableReason: expect.stringContaining("owner failure") });
      expect(envelope.lower.every(Number.isNaN)).toBe(true);
    } finally { run.mockRestore(); }
  });

  it("retains simulator variability", () => {
    expect(makeSimulatedCapture("a").spectrum?.values).not.toEqual(makeSimulatedCapture("b").spectrum?.values);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function envelope(label: string): SpectrumEnvelope {
  return { label, axis: reference.axis, lower: [1, 1], median: [1, 1], upper: [1, 1], count: 1 };
}

describe("asynchronous envelope selection", () => {
  it("hides prior data immediately and discards stale completions and rejections", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const a = capture("a", source());
    const b = capture("b", source());
    const c = capture("c", source());
    const population = [a, b, c];
    const first = deferred<SpectrumEnvelope>();
    const second = deferred<SpectrumEnvelope>();
    const third = deferred<SpectrumEnvelope>();
    const fourth = deferred<SpectrumEnvelope>();
    const build = vi.spyOn(spectra, "buildSpectrumEnvelope")
      .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise).mockReturnValueOnce(fourth.promise);
    const container = document.createElement("div");
    const root = createRoot(container);
    const Probe = ({ selected }: { selected: SpectrumCapture }) => {
      const result = useSpectrumEnvelope(population, selected, "Project");
      return createElement("span", null, result?.label ?? "pending");
    };
    try {
      await act(async () => root.render(createElement(Probe, { selected: a })));
      expect(build).toHaveBeenLastCalledWith(population, a.spectrum, "Project", a.id);
      await act(async () => root.render(createElement(Probe, { selected: b })));
      await act(async () => second.resolve(envelope("B")));
      expect(container.textContent).toBe("B");
      await act(async () => first.resolve(envelope("obsolete A")));
      expect(container.textContent).toBe("B");
      await act(async () => root.render(createElement(Probe, { selected: c })));
      expect(container.textContent).toBe("pending");
      await act(async () => root.render(createElement(Probe, { selected: a })));
      await act(async () => fourth.resolve(envelope("new A")));
      await act(async () => third.reject(new Error("obsolete C failure")));
      expect(container.textContent).toBe("new A");
    } finally {
      await act(async () => root.unmount());
      build.mockRestore();
      Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    }
  });
});
