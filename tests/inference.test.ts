import { beforeEach, describe, expect, it, vi } from "vitest";
import { predictPortablePipeline, runPortablePipeline } from "nirs4all";
import { PortableNirs4allInferenceEngine } from "@/runtime/inference";
import { buildSpectrumEnvelope, capturesToMatrixCsv } from "@/domain/spectrum";
import { saveCaptureWithPrediction } from "@/app/App";
import type { PipelineArtifact, Spectrum, SpectrumCapture, SpectrumDescriptor } from "@/domain/types";

// Only the retired Core 0.4.5 runner is mocked. Alignment uses Root's real M1 Methods artifact.
// These tests cover host ordering/metadata; they do not qualify Core fitting or prediction.
vi.mock("nirs4all", () => ({
  capabilityManifest: vi.fn(() => ({ aggregate: "Core 0.4.5", controllers: [] })),
  predictPortablePipeline: vi.fn(),
  runPortablePipeline: vi.fn(),
}));

const descriptor: SpectrumDescriptor = { axis: [2.5, 1.5], axisUnit: "cm-1", signalType: "reflectance" };
const result = { name: "Host fixture", cols: 2, model: {} };
const engine = new PortableNirs4allInferenceEngine();
function capture(id: string, spectrum?: Spectrum): SpectrumCapture {
  return { id, sampleId: "same sample", createdAt: "2026-11-08T00:00:00Z", source: "simulated", tags: [], spectrum,
    device: { id: "sim", name: "Simulator", model: "sim", transport: "simulator" } };
}
function artifact(extra: Record<string, unknown> = {}): PipelineArtifact {
  return engine.importArtifact(JSON.stringify({ result, ...descriptor, targetName: "demo_target", ...extra }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runPortablePipeline).mockResolvedValue(result as unknown as Awaited<ReturnType<typeof runPortablePipeline>>);
  vi.mocked(predictPortablePipeline).mockResolvedValue({ data: [42], rows: 1, cols: 1 });
});

describe("n4a host artifact metadata (Core 0.4.5 limitation retained)", () => {
  it("keeps pipeline definitions in context without marking them runnable", () => {
    const definition = engine.importArtifact(JSON.stringify({ name: "Pretreatment only", pipeline: [{ class: "nirs4all.operators.transforms.StandardNormalVariate" }] }), "pretreatment.n4a");
    expect(definition.runnable).toBe(false);
    expect(definition.kind).toBe("pipeline_definition");
    expect(definition.validationMessage).toContain("Pipeline definition loaded");
  });

  it.each(["axis", "axisUnit", "signalType"])("makes prediction unavailable when artifact %s is missing", async (field) => {
    const imported = artifact({ [field]: undefined });
    expect(imported.kind).toBe("portable_result");
    expect(imported.runnable).toBe(false);
    expect(imported.validationMessage).toBe("unavailable — feature descriptor missing");
    // Also cover previously persisted artifacts whose runnable flag predates metadata validation.
    await expect(engine.predict(capture("input", { ...descriptor, values: [1, 2] }), { ...imported, runnable: true })).rejects.toThrow("feature descriptor missing");
    expect(predictPortablePipeline).not.toHaveBeenCalled();
  });

  it.each([
    { axis: ["2.5", "1.5"] }, { axisUnit: "unknown" }, { signalType: "unknown" }, { axis: [1, 1] },
  ])("does not coerce or infer a model descriptor (%j)", (extra) => {
    const imported = artifact(extra);
    expect(imported.runnable).toBe(false);
    expect(imported.validationMessage).toContain("invalid feature descriptor");
  });

  it("keeps the nFeatures check after alignment", async () => {
    await expect(engine.predict(capture("input", { ...descriptor, values: [1, 2] }), { ...artifact(), nFeatures: 3 })).rejects.toThrow("expects 3");
    expect(predictPortablePipeline).not.toHaveBeenCalled();
  });

  it("refuses different unit/signal metadata before calling the runner", async () => {
    await expect(engine.predict(capture("input", { ...descriptor, axisUnit: "nm", values: [1, 2] }), artifact())).rejects.toThrow("unit mismatch");
    await expect(engine.predict(capture("input", { ...descriptor, signalType: "absorbance", values: [1, 2] }), artifact())).rejects.toThrow("signal type mismatch");
    expect(predictPortablePipeline).not.toHaveBeenCalled();
  });

  it("passes exact-grid NaNs unchanged to the existing runner", async () => {
    await engine.predict(capture("input", { ...descriptor, values: [Number.NaN, 1] }), artifact());
    expect(Array.from(vi.mocked(predictPortablePipeline).mock.calls[0][1].X as Float64Array)).toEqual([Number.NaN, 1]);
  });

  it("uses the same aligned feature order for envelope, predict, demo and CSV", async () => {
    const reference = capture("reference", { ...descriptor, values: [2.5, 1.5] });
    const wide = capture("wide", { axis: [3, 2, 1], values: [3, 2, 1], axisUnit: "cm-1", signalType: "reflectance" });
    const batch = [reference, wide, { ...wide, id: "third" }, { ...wide, id: "fourth" }];
    const raw = capture("raw only");
    const envelope = await buildSpectrumEnvelope(batch, descriptor, "Project", reference.id);
    expect(envelope.median).toEqual([2.5, 1.5]);
    await engine.predict(wide, artifact());
    expect(Array.from(vi.mocked(predictPortablePipeline).mock.calls[0][1].X as Float64Array)).toEqual([2.5, 1.5]);
    const demo = await engine.fitDemoArtifact([raw, ...batch]);
    const input = vi.mocked(runPortablePipeline).mock.calls[0][1];
    expect(Array.from(input.X as Float64Array)).toEqual([2.5, 1.5, 2.5, 1.5, 2.5, 1.5, 2.5, 1.5]);
    expect(Array.from(input.y as Float64Array)).toEqual([10, 10.7, 11.4, 12.1]);
    expect(input.rows).toBe(4);
    expect(input.cols).toBe(2);
    expect(demo.raw).toMatchObject({
      ...descriptor, targetName: "demo_target", trainingCaptureIds: batch.map((item) => item.id),
      excludedCaptures: [{ captureId: raw.id, reason: "Decoded spectrum unavailable." }],
      demoTarget: { kind: "synthetic", formula: "10 + 0.7 * row index" },
    });
    const definition = vi.mocked(runPortablePipeline).mock.calls[0][0] as { description?: string };
    expect(definition.description).toContain("no measured endpoint or validation result");
    const lines = (await capturesToMatrixCsv(batch)).split("\n");
    expect(lines[0]).toBe("capture_id,sample_id,repetition,axis_unit,signal_type,x_2.5,x_1.5");
    for (const line of lines.slice(1)) expect(line.split(",").slice(-2).map(Number)).toEqual([2.5, 1.5]);
  });

  it("refuses an incompatible decoded demo row before fitting", async () => {
    const good = capture("good", { ...descriptor, values: [1, 2] });
    const bad = capture("bad unit", { ...descriptor, axisUnit: "nm", values: [1, 2] });
    await expect(engine.fitDemoArtifact([good, { ...good, id: "b" }, bad, { ...good, id: "d" }])).rejects.toThrow("Demo fit refused capture bad unit");
    expect(runPortablePipeline).not.toHaveBeenCalled();
  });
});

describe("automatic capture persistence", () => {
  it("saves the capture and its failure reason when prediction refuses", async () => {
    const input = { ...capture("saved", { ...descriptor, values: [1, 2] }), metadata: { repetition: "2", operator: "Ada" } };
    const persist = vi.fn(async (_capture: SpectrumCapture) => {});
    const predict = vi.fn(async () => { throw new Error("nonfinite values on a differing grid are unsupported"); });
    const saved = await saveCaptureWithPrediction(input, artifact(), predict, persist);
    expect(saved.predictionError).toContain("differing grid");
    expect(persist).toHaveBeenCalledExactlyOnceWith(saved.capture);
    expect(saved.capture.spectrum).toBe(input.spectrum);
    expect(saved.capture).toMatchObject({ id: "saved", sampleId: input.sampleId, metadata: { ...input.metadata, prediction_error: saved.predictionError } });
    expect(saved.capture.prediction).toBeUndefined();
  });

  it("still propagates a storage failure", async () => {
    const input = capture("unsaved", { ...descriptor, values: [1, 2] });
    await expect(saveCaptureWithPrediction(input, null, () => Promise.reject(new Error("unused")), () => Promise.reject(new Error("storage failed")))).rejects.toThrow("storage failed");
  });
});
