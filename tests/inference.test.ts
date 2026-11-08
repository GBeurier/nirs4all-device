// @vitest-environment node
// Root runs this single real-WASM fit after staging the qualified owner cohort.
// No runner or estimator is substituted. Blocking spies prove cold replay cannot fit.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as dag from "dag-ml-wasm";
import * as dmd from "dag-ml-data-wasm";
import * as datasets from "@nirs4all/datasets-wasm";
import type { RolePipeline } from "@nirs4all/methods";
import { openN4aContainer, writeN4aContainer } from "nirs4all";
import { LEGACY_MODEL_MESSAGE, PortableNirs4allInferenceEngine } from "@/runtime/inference";
import { DEVICE_HOST, deviceHostManifest, readDeviceContainer, type DeviceHostBundle } from "@/runtime/deviceHostContainer";
import { createDeviceController, demoRecipe, loadOwners, relationMetadata, trainingCaptures } from "@/runtime/ownerRefit";
import type { DevicePipelineArtifact, PipelineArtifact, SpectrumCapture, SpectrumDescriptor } from "@/domain/types";
import { saveCaptureWithPrediction } from "@/app/App";

const require = createRequire(import.meta.url);
// Exact Root-frozen fixture, copied without reserialization or recapture.
const witnessBytes = readFileSync(new URL("./fixtures/legacy-demo-witness.json", import.meta.url));
interface FrozenLegacyWitness {
  schema: string;
  meaning: string;
  source_commit: string;
  runner_calls: number;
  packages: Record<string, { version: string; package_json_sha256: string; entry: string; entry_sha256: string }>;
  recipe: { name: string; description: string; pipeline: unknown[] };
  descriptor: SpectrumDescriptor;
  captures: Array<Omit<SpectrumCapture, "source" | "device" | "tags"> & {
    source: "simulator";
    device: Omit<SpectrumCapture["device"], "model">;
  }>;
  aligned_matrix: { rows: number; cols: number; data: number[] };
  y: number[];
  snv_ddof: number;
  snv_rows: number[];
  predictions: number[];
  prediction_tolerance: { relative: number; absolute: number };
  snv_absolute_tolerance: number;
}
const witness = JSON.parse(witnessBytes.toString("utf8")) as FrozenLegacyWitness;
const descriptor = witness.descriptor, axis = descriptor.axis;
const rows = Array.from({ length: witness.aligned_matrix.rows }, (_, i) =>
  witness.aligned_matrix.data.slice(i * witness.aligned_matrix.cols, (i + 1) * witness.aligned_matrix.cols));
const y = witness.y;
// Historical records use source "simulator" and omit UI-only model/tags fields.
// This type assertion changes no runtime bytes, records or scientific inputs.
const allCaptures = witness.captures as unknown as SpectrumCapture[];
const captures = allCaptures.filter(capture => capture.spectrum);
const undecoded = allCaptures.find(capture => !capture.spectrum)!;
const engine = new PortableNirs4allInferenceEngine();
let artifact: DevicePipelineArtifact, bundle: DeviceHostBundle, pkg: any;
let firstPrediction: number;

beforeAll(async () => {
  expect(createHash("sha256").update(witnessBytes).digest("hex")).toBe("e7d13869f0bb55d476671da72240dac906d84dae1705c5b44aba3be72c424885");
  // Initialize the actual installed packages from their own bytes. Production
  // default() calls then reuse these wasm-bindgen modules, without a fetch stub.
  dag.initSync({ module: readFileSync(resolve(dirname(require.resolve("dag-ml-wasm")), "dag_ml_wasm_bg.wasm")) });
  dmd.initSync({ module: readFileSync(resolve(dirname(require.resolve("dag-ml-data-wasm")), "dag_ml_data_wasm_bg.wasm")) });
  datasets.initSync({ module: readFileSync(resolve(dirname(require.resolve("@nirs4all/datasets-wasm")), "nirs4all_datasets_wasm_bg.wasm")) });
  artifact = await engine.fitDemoArtifact(allCaptures); // The sole model fit; exact frozen capture order.
  bundle = (await readDeviceContainer(artifact.raw.archiveBytes)).bundle;
  pkg = JSON.parse(bundle.packageJson);
  firstPrediction = (await engine.predict(captures[0], artifact)).value;
  const artifactDir = process.env.N4A_DEVICE_TEST_ARTIFACT_DIR;
  if (artifactDir) {
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(resolve(artifactDir, "device-demo.n4a"), artifact.raw.archiveBytes);
    writeFileSync(resolve(artifactDir, "device-demo.expected.json"), `${JSON.stringify({
      archiveSha256: artifact.raw.sha256, fixtureSha256: createHash("sha256").update(witnessBytes).digest("hex"),
      captureId: captures[0].id, expectedPrediction: firstPrediction,
    }, null, 2)}\n`);
  }
});

async function repack(value: unknown, alterManifest?: (manifest: Record<string, any>) => void): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const manifest = deviceHostManifest(datasets.sha256(bytes));
  alterManifest?.(manifest);
  return (await writeN4aContainer(manifest, [{ path: DEVICE_HOST.path, bytes }])).archiveBytes;
}

function historical(): PipelineArtifact {
  return { id: "historical", name: "Old model", engine: "old-core", importedAt: "2026-11-01T00:00:00Z",
    kind: "portable_result", runnable: true, nFeatures: axis.length, raw: { deliberatelyOpaque: true } };
}

describe("Device Core V1 / DAG initial full refit", () => {
  it("preserves route B, repetitions, fit order, exact recipe and synthetic statement without scores", () => {
    expect(bundle).toMatchObject({ profile: "demo-snv-pls2.v1", descriptor, nFeatures: axis.length, targetName: "demo_target",
      trainingUnit: "capture", targetGrain: "synthetic per capture", physicalSampleGrouping: "group_id",
      demoTarget: { kind: "synthetic", formula: "10 + 0.7 * row index" },
      excludedCaptures: [{ captureId: undecoded.id, reason: "Decoded spectrum unavailable." }] });
    expect(bundle.description).toContain("no measured endpoint or validation result");
    expect(bundle.recipe).toEqual(demoRecipe());
    expect(bundle).not.toHaveProperty("scores");
    expect(bundle).not.toHaveProperty("quality");
    const mapping = trainingCaptures(captures);
    expect(bundle.trainingCaptures).toEqual(mapping);
    expect(mapping.map(c => c.unit)).toEqual(["u0", "u1", "u2", "u3", "u4", "u5"]);
    expect(mapping.map(c => c.group)).toEqual(["p0", "p0", "p1", "p1", "p2", "p2"]);
    expect(mapping.map(c => c.repetition)).toEqual(["1", "2", "1", "2", "1", "2"]);
    expect(mapping[1]).toEqual({ captureId: "witness:capture:1", sampleId: "physical sample 0", repetition: "2", unit: "u1", group: "p0" });
    expect(captures[2].spectrum?.axis).toEqual([...axis].reverse());
    const withoutRepetition = trainingCaptures([{ ...captures[0], metadata: undefined }])[0];
    expect(withoutRepetition).not.toHaveProperty("repetition");
    expect(relationMetadata(withoutRepetition)).not.toHaveProperty("original_repetition");
    expect(pkg.training_sample_ids).toEqual(mapping.map(c => c.unit));
    const records = new Map(pkg.training_relations.records.map((r: any) => [r.observation_id, r]));
    mapping.forEach((c, i) => expect(records.get(`o${i}`)).toMatchObject({ observation_id: `o${i}`, sample_id: c.unit,
      group_id: c.group, source_id: "nir", target_id: "y", is_augmented: false, metadata: relationMetadata(c) }));
    const sourceRows = { rows: mapping.map((c, i) => ({ observation_id: `o${i}`, sample_id: c.unit, source_id: "nir",
      target_id: "y", group_id: c.group, origin_id: null, repetition_id: null, augmented: false, excluded: false, metadata: relationMetadata(c) })) };
    const S = dmd.sample_relation_table_fingerprint_json(JSON.stringify(sourceRows));
    const C = dag.sample_relation_set_fingerprint_json(JSON.stringify(pkg.training_relations));
    expect(pkg.training_envelope.relation_fingerprint).toBe(S);
    expect(S).not.toBe(C);
    expect(pkg.training_envelope.data_content_fingerprint).toBe(datasets.sha256(new Uint8Array(Float64Array.from(rows.flat()).buffer)));
    expect(pkg.training_envelope.target_content_fingerprint).toBe(datasets.sha256(new Uint8Array(Float64Array.from(y).buffer)));
    expect(pkg.effective_plan.graph_plan.graph.nodes[0]).toMatchObject({ kind: "model", operator: { type: "N4mRolePipeline" }, params: { pipeline_steps_v1: demoRecipe() } });
    expect(pkg.effective_plan.campaign).toMatchObject({ split_invocation: null, generation: { strategy: "none", dimensions: [], max_variants: 1 } });
    expect(pkg.effective_plan.fold_set).toBeNull();
    expect(pkg.effective_plan.campaign.shape_plans).toEqual({});
  });

  it("round-trips exact bytes/package and predicts cold without a fit, training views or target reads", async () => {
    const bytes = await engine.exportArtifact(artifact);
    const opened = await openN4aContainer(bytes);
    try {
      expect(opened.view().executability).toBe("not_evaluated");
      const member = await opened.readMember(DEVICE_HOST.path);
      expect(JSON.parse(new TextDecoder().decode(member)).packageJson).toBe(bundle.packageJson);
    } finally { opened.close(); }
    const deps = await loadOwners();
    const fit = vi.spyOn(deps.methods.RolePipeline.prototype, "fit").mockImplementation(() => { throw new Error("Cold prediction must not fit."); });
    const provider = vi.spyOn(deps.dmd.WasmInMemoryProvider, "withF64Features").mockImplementation(() => { throw new Error("Cold prediction must not create a training provider."); });
    try {
      const cold = new PortableNirs4allInferenceEngine();
      const imported = await cold.importArtifact(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, "cold.n4a");
      expect((await cold.predict(captures[0], imported)).value).toBe(firstPrediction);
      expect(await cold.exportArtifact(imported)).toEqual(bytes);
      const guards = createDeviceController(deps, { X: Float64Array.from(rows[0]), nFeatures: axis.length, sampleIds: ["predict:s0"] });
      try {
        for (const partition of ["fold_train", "full_train"]) {
          expect(() => guards.options.resolveFeatures({ key: "x", view: { sample_ids: ["predict:s0"], partition }, task: {} })).toThrow("never fit");
        }
        expect(() => guards.options.resolveTargets({ sampleIds: ["predict:s0"], targetNames: ["demo_target"], task: {} })).toThrow("cannot read targets");
      } finally { guards.controller.close(); }
      expect(fit).not.toHaveBeenCalled();
      expect(provider).not.toHaveBeenCalled();
    } finally { fit.mockRestore(); provider.mockRestore(); }
  });

  it("matches Root's single frozen old-Core witness at the predeclared tolerance", async () => {
    expect(witness.schema).toBe("nirs4all.device.demo-parity-witness/v1");
    expect(witness.source_commit).toBe("7016b3a94b7af9903a3b481682912474b3bd8eea");
    expect(witness.runner_calls).toBe(1);
    expect(witness.meaning).toContain("no validation or quality claim");
    expect(witness.aligned_matrix).toMatchObject({ rows: 6, cols: 9 });
    expect(witness.captures).toHaveLength(7);
    expect(captures).toHaveLength(6);
    expect(witness.y).toEqual(captures.map((_, i) => 10 + 0.7 * i));
    expect(witness.packages.nirs4all).toEqual({ version: "0.4.5",
      package_json_sha256: "b0d8da2f80863dfa21e6c5357b8685988552dc13702e50cfcc65fd00ed2d0758",
      entry: "src/execution.js", entry_sha256: "dcc35fbe1a741764864c75786172362949e79815c862a014a08eafe535bee962" });
    expect(witness.packages["@nirs4all/methods"]).toEqual({ version: "1.3.15+local.20261108.1",
      package_json_sha256: "527074aacd8bc32db5424088c92dca5b5c8878753e7b9d008379fcc1d9a90b41",
      entry: "dist/n4m.wasm", entry_sha256: "9928b323aae24b84a199a98ea53f6d0638f017adffe82d1b112b581f88bb0313" });
    expect(witness.recipe).toEqual({ name: bundle.name, description: bundle.description, pipeline: [
      { class: "nirs4all.operators.transforms.StandardNormalVariate" },
      { model: { class: "sklearn.cross_decomposition.PLSRegression", params: { n_components: 2 } } },
    ] });
    expect(witness.prediction_tolerance).toEqual({ relative: 1e-9, absolute: 1e-9 });
    expect(witness.snv_ddof).toBe(0);
    expect(witness.snv_absolute_tolerance).toBe(1e-12);
    expect(witness.predictions).toHaveLength(captures.length);
    for (let i = 0; i < captures.length; i++) {
      const predicted = (await engine.predict(captures[i], artifact)).value;
      const expected = witness.predictions[i];
      expect(Math.abs(predicted - expected)).toBeLessThanOrEqual(
        witness.prediction_tolerance.absolute + witness.prediction_tolerance.relative * Math.abs(expected));
    }
    const deps = await loadOwners(), snv = new deps.methods.SNV({ with_mean: true, with_std: true, ddof: witness.snv_ddof });
    try {
      const X = { data: Float64Array.from(witness.aligned_matrix.data), rows: witness.aligned_matrix.rows, cols: witness.aligned_matrix.cols };
      snv.fit(X);
      const actual = snv.transform(X).data;
      expect(witness.snv_rows).toHaveLength(actual.length);
      actual.forEach((value, i) => expect(Math.abs(value - witness.snv_rows[i])).toBeLessThanOrEqual(witness.snv_absolute_tolerance));
    } finally { snv.dispose(); }
  });

  it("refuses corruption, raw JSON and foreign host declarations", async () => {
    const corrupted = artifact.raw.archiveBytes.slice();
    corrupted[Math.floor(corrupted.length / 2)] ^= 1;
    await expect(engine.importArtifact(corrupted)).rejects.toBeDefined();
    await expect(engine.importArtifact(new TextEncoder().encode(JSON.stringify(bundle)))).rejects.toBeDefined();
    for (const change of [
      (m: any) => { m.required_features = ["unknown@1"]; },
      (m: any) => { m.artifacts[0].owner = "nirs4all.quali-host"; m.artifacts[0].identity.owner = "nirs4all.quali-host"; },
      (m: any) => { m.entrypoints[0].operation = "other.predict"; },
    ]) await expect(engine.importArtifact(await repack(bundle, change))).rejects.toThrow(/not executable in Device/i);
    for (const extra of [{ profile: "ridge.v1" }, { schema_version: 2 }, { descriptor: undefined },
      { trainingUnit: "physical sample", targetGrain: "measured per sample" }, { nFeatures: 5 }]) {
      await expect(engine.importArtifact(await repack({ ...bundle, ...extra }))).rejects.toThrow();
    }
    // A foreign Quali bundle cannot gain Device admission by copying the manifest.
    await expect(engine.importArtifact(await repack({ schema: "nirs4all.quali-host.bundle", schema_version: 1, model: {} }))).rejects.toThrow(/not executable in Device/i);
  });

  it("refuses nonfinite/incompatible spectra before fit or replay", async () => {
    const deps = await loadOwners();
    const fit = vi.spyOn(deps.methods.RolePipeline.prototype, "fit");
    try {
      for (const spectrum of [
        { ...captures[0].spectrum!, axisUnit: "cm-1" as const },
        { ...captures[0].spectrum!, signalType: "absorbance" as const },
        { ...captures[0].spectrum!, values: [NaN, ...rows[0].slice(1)] },
        { ...captures[0].spectrum!, axis: [850, ...axis.slice(1)], values: [NaN, ...rows[0].slice(1)] },
      ]) {
        const bad = { ...captures[0], id: "bad", spectrum };
        await expect(engine.predict(bad, artifact)).rejects.toThrow();
        await expect(engine.fitDemoArtifact([bad, ...captures.slice(1)])).rejects.toThrow();
      }
      expect(fit).not.toHaveBeenCalled();
    } finally { fit.mockRestore(); }
    await expect(engine.predict(captures[0], { ...artifact, nFeatures: 5 })).rejects.toThrow("expects 5");
  });

  it("refuses nonfinite owner prediction output after a genuine native prediction", async () => {
    const deps = await loadOwners(), original = deps.methods.RolePipeline.prototype.predict;
    // Boundary corruption only: the genuine native prediction executes first.
    const corrupt = vi.spyOn(deps.methods.RolePipeline.prototype, "predict").mockImplementation(function (this: RolePipeline, ...args) {
      const result = original.apply(this, args);
      result.data[0] = Infinity;
      return result;
    });
    try { await expect(engine.predict(captures[0], artifact)).rejects.toThrow(/finite|Predictions/); }
    finally { corrupt.mockRestore(); }
  });

  it("classifies historical rows opaquely in memory and never mutates their raw state", async () => {
    const saved = historical(), before = structuredClone(saved);
    const raw = new Proxy(saved.raw as object, { get() { throw new Error("Legacy raw must remain opaque."); } });
    const classified = engine.classifyStored({ ...saved, raw });
    expect(classified).toMatchObject({ kind: "legacy_json", runnable: false, validationMessage: LEGACY_MODEL_MESSAGE });
    expect(classified.raw).toBe(raw);
    expect(saved).toEqual(before);
    await expect(engine.predict(captures[0], saved)).rejects.toThrow(LEGACY_MODEL_MESSAGE);
    await expect(engine.exportArtifact(saved)).rejects.toThrow(LEGACY_MODEL_MESSAGE);
  });
});

describe("automatic capture persistence", () => {
  it("preserves capture/sample/repetition and stores an explicit current-model prediction refusal", async () => {
    const input = captures[0];
    const persist = vi.fn(async (_capture: SpectrumCapture) => {});
    const predict = vi.fn(async () => { throw new Error("Prediction requires a finite numeric spectrum."); });
    const saved = await saveCaptureWithPrediction(input, artifact, predict, persist);
    expect(saved.predictionError).toContain("finite numeric spectrum");
    expect(persist).toHaveBeenCalledExactlyOnceWith(saved.capture);
    expect(saved.capture.spectrum).toBe(input.spectrum);
    expect(saved.capture).toMatchObject({ id: input.id, sampleId: input.sampleId,
      metadata: { ...input.metadata, prediction_error: saved.predictionError } });
    expect(saved.capture.prediction).toBeUndefined();
  });

  it("propagates storage failure", async () => {
    await expect(saveCaptureWithPrediction(captures[0], null, () => Promise.reject(new Error("unused")),
      () => Promise.reject(new Error("storage failed")))).rejects.toThrow("storage failed");
  });
});
