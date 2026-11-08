// Adapted from Quali app/src/engine/{ownerData,dagEngine,methodsCohort}.ts
// and Web web-app/src/engine/dagml-refit.ts, read 2026-11-08.
// Owners retain data planning, identity derivation, execution and all numerics.
import type { SpectrumCapture, SpectrumDescriptor } from "@/domain/types";
import { initializeSpectrumMethods } from "@/runtime/spectrumAlignment";
import type { MethodsRecipeStep, MethodsRegressionControllerOptions } from "dag-ml-wasm/n4m-controller";

export const DEVICE_NODE = "model:device.demo";
const REQUEST = "device:nir:x";
export const DEMO_STATEMENT = "Synthetic demo only: demo_target = 10 + 0.7 * row index; no measured endpoint or validation result.";
export function demoRecipe(): MethodsRecipeStep[] {
  return [
    { class: "n4m:preprocessing.scatter.snv", params: { with_mean: true, with_std: true, ddof: 0 } },
    { class: "n4m:models.pls.pls_regression", params: { n_components: 2, solver: "simpls", center_x: true, scale_x: true, center_y: true, scale_y: true } },
  ];
}

export interface TrainingCapture {
  captureId: string;
  sampleId: string;
  repetition?: string;
  unit: string;
  group: string;
}
export function trainingCaptures(captures: SpectrumCapture[]): TrainingCapture[] {
  const groups = new Map<string, string>();
  return captures.map((capture, i) => {
    if (!groups.has(capture.sampleId)) groups.set(capture.sampleId, `p${groups.size}`);
    return { captureId: capture.id, sampleId: capture.sampleId,
      ...(capture.metadata?.repetition === undefined ? {} : { repetition: capture.metadata.repetition }),
      unit: `u${i}`, group: groups.get(capture.sampleId)! };
  });
}
export function relationMetadata(capture: TrainingCapture) {
  return { original_capture_id: capture.captureId, original_sample_id: capture.sampleId,
    ...(capture.repetition === undefined ? {} : { original_repetition: capture.repetition }),
    physical_sample_handle: capture.group, identity_basis: "capture_unit" };
}

type Dag = typeof import("dag-ml-wasm");
let dagReady: Promise<Dag> | undefined;
export function loadDag(): Promise<Dag> {
  return dagReady ??= (async () => {
    const dag = await import("dag-ml-wasm");
    await dag.default();
    if (![dag.build_execution_plan_json, dag.execute_initial_full_refit_json, dag.replay_initial_full_refit_json,
      dag.validate_initial_full_refit_package_json, dag.initial_full_refit_predict_envelope_json].every(api => typeof api === "function")) {
      throw new Error("Device requires the staged DAG initial full-refit/replay API; no host fallback is available.");
    }
    return dag;
  })();
}
let hashReady: Promise<typeof import("@nirs4all/datasets-wasm")["sha256"]> | undefined;
export function loadHash() {
  return hashReady ??= import("@nirs4all/datasets-wasm").then(async owner => {
    await owner.default();
    return owner.sha256;
  });
}
let ownersReady: Promise<{
  dag: Dag;
  dmd: typeof import("dag-ml-data-wasm");
  methods: typeof import("@nirs4all/methods");
  Controller: typeof import("dag-ml-wasm/n4m-controller")["N4mWasmRegressionController"];
  hash: Awaited<ReturnType<typeof loadHash>>;
}> | undefined;
export function loadOwners() {
  return ownersReady ??= (async () => {
    // Coalesce with the existing alignment adapter's first Methods load.
    await initializeSpectrumMethods();
    const [dag, dmd, methods, adapter, hash] = await Promise.all([
      loadDag(), import("dag-ml-data-wasm"), import("@nirs4all/methods"), import("dag-ml-wasm/n4m-controller"), loadHash(),
    ]);
    await dmd.default();
    const version = /^(\d+)\.(\d+)\.(\d+)(?:\+[^\s]+)?$/.exec(methods.version())?.slice(1).map(Number);
    const abi = methods.abiVersion();
    if (!version || version[0] !== 1 || !(version[1] > 3 || version[1] === 3 && version[2] >= 15)
      || abi[0] !== 2 || abi[1] < 22) {
      throw new Error("Device requires staged Methods >=1.3.15 <2 with ABI >=2.22 <3.");
    }
    return { dag, dmd, methods, Controller: adapter.N4mWasmRegressionController, hash };
  })();
}
type Owners = Awaited<ReturnType<typeof loadOwners>>;
export function numericFingerprint(hash: Awaited<ReturnType<typeof loadHash>>, values: Float64Array): string {
  return hash(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
}
interface DataEnvelope {
  schema_version: number;
  schema_fingerprint: string;
  plan_fingerprint: string;
  relation_fingerprint: string;
  data_content_fingerprint: string;
  target_content_fingerprint: string;
  plan: { output_representation: string };
  coordinator_relations: unknown;
}
export interface FeatureRows { X: Float64Array; nFeatures: number; sampleIds: string[]; featureNames?: string[] }

/** Capture is the declared target unit; original physical sample stays a group. */
function nativeDataset(deps: Owners, X: Float64Array, y: Float64Array, descriptor: SpectrumDescriptor,
  captures: TrainingCapture[]): { data: FeatureRows; y: Float64Array; envelope: DataEnvelope } {
  const { dmd, hash } = deps, ids = captures.map(c => c.unit), observationIds = captures.map((_, i) => `o${i}`);
  const n = ids.length, p = descriptor.axis.length, featureNames = descriptor.axis.map(String);
  const sampleAxis = { name: "sample", kind: "sample", unit: null, size: n, variable: false };
  const schema = { dataset_id: "device", sample_ids: ids,
    sources: [{ id: "nir", name: "NIR spectrum", type_id: "dense_signal", modality: "spectroscopy",
      native_representation: { id: "signal_1d", type_id: "dense_signal", rank: 2,
        axes: [sampleAxis, { name: "wavelength", kind: "wavelength", unit: descriptor.axisUnit, size: p, variable: false,
          coordinate: { dtype: "numeric", ordered: true, values: { kind: "explicit", values: descriptor.axis } } }],
        container: "ndarray", dtype: "float64", sparse: false, ragged: false },
      sample_key: "sample_id", granularity: "per_sample", schema: {}, tags: {} }],
    targets: { y: { id: "tabular_numeric", type_id: "table", rank: 2,
      axes: [sampleAxis, { name: "target", kind: "target", unit: null, size: 1, variable: false,
        coordinate: { dtype: "categorical", ordered: false, values: { kind: "explicit", values: ["demo_target"] } } }],
      container: "dataframe", dtype: "float64", sparse: false, ragged: false } }, metadata: {} };
  const relations = { rows: captures.map((capture, i) => ({ observation_id: observationIds[i], sample_id: capture.unit,
    source_id: "nir", target_id: "y", group_id: capture.group, origin_id: null, repetition_id: null,
    augmented: false, excluded: false, metadata: relationMetadata(capture) })) };
  const schemaJson = JSON.stringify(schema);
  const plan = dmd.plan_model_input_json(schemaJson, dmd.tabular_numeric_model_input_spec_json(),
    dmd.builtin_adapter_registry_json(), JSON.stringify({ id: REQUEST, source_ids: ["nir"] }));
  const envelope: DataEnvelope = JSON.parse(dmd.build_coordinator_data_plan_envelope_json(schemaJson, plan, JSON.stringify(relations)));
  const targets = [{ target_id: "y", values: ids.map((id, row) => ({ sample_id: id, value: y[row] })) }];
  const provider = dmd.WasmInMemoryProvider.withF64Features(JSON.stringify(envelope), JSON.stringify(targets),
    JSON.stringify({ feature_set_id: "x", representation_id: envelope.plan.output_representation,
      feature_names: featureNames, observation_ids: observationIds }), X);
  let data: string | undefined, view: string | undefined;
  try {
    data = provider.materialize(JSON.stringify({ run_id: "run:device.data", node_id: DEVICE_NODE, input_name: "x",
      phase: "REFIT", request_id: REQUEST, schema_fingerprint: envelope.schema_fingerprint,
      plan_fingerprint: envelope.plan_fingerprint, relation_fingerprint: envelope.relation_fingerprint,
      output_representation: envelope.plan.output_representation, source_ids: ["nir"], require_relations: true }));
    view = provider.make_view(data, JSON.stringify({ sample_ids: ids, include_augmented: false, include_excluded: false }));
    const block = provider.featureBlockF64(view, "x");
    const layout: { observation_ids: string[]; sample_ids: string[]; feature_names: string[]; n_rows: number; n_cols: number } = JSON.parse(block.layout);
    const values = block.into_values(); // Consumes the owned block.
    if (layout.n_rows !== n || layout.n_cols !== p || values.length !== X.length
      || layout.sample_ids.length !== n || new Set(layout.observation_ids).size !== n
      || JSON.stringify(layout.feature_names) !== JSON.stringify(featureNames)) throw new Error("DMD returned incomplete Device feature identities or dimensions.");
    const positions = new Map(layout.observation_ids.map((id, i) => [id, i]));
    const orderedX = new Float64Array(X.length);
    observationIds.forEach((id, row) => {
      const position = positions.get(id);
      if (position === undefined || layout.sample_ids[position] !== ids[row]) throw new Error(`DMD did not preserve capture observation '${id}'.`);
      orderedX.set(values.subarray(position * p, (position + 1) * p), row * p);
    });
    const targetBlock: { sample_ids: string[]; values: number[] } = JSON.parse(provider.target_block(view, "y"));
    if (targetBlock.sample_ids.length !== n || targetBlock.values.length !== n || new Set(targetBlock.sample_ids).size !== n) {
      throw new Error("DMD returned incomplete capture target identities.");
    }
    const byId = new Map(targetBlock.sample_ids.map((id, i) => [id, targetBlock.values[i]]));
    const orderedY = Float64Array.from(ids, (id, row) => {
      const value = byId.get(id);
      if (value === undefined || !Number.isFinite(value) || value !== y[row]) throw new Error(`DMD changed the synthetic target for '${id}'.`);
      return value;
    });
    // Preserve DMD's source relation key S unchanged. DAG derives C itself.
    envelope.data_content_fingerprint = numericFingerprint(hash, orderedX);
    envelope.target_content_fingerprint = numericFingerprint(hash, orderedY);
    return { data: { X: orderedX, nFeatures: p, sampleIds: ids, featureNames }, y: orderedY, envelope };
  } finally {
    if (view !== undefined) provider.release(view);
    if (data !== undefined) provider.release(data);
    provider.free();
  }
}

/** Prediction callers omit training completely; both prohibited reads fail closed. */
export function createDeviceController(deps: Owners, data: FeatureRows,
  training?: { ids: string[]; y: Float64Array }) {
  const positions = new Map(data.sampleIds.map((id, i) => [id, i]));
  const options: MethodsRegressionControllerOptions = {
    controllerVersion: "1.1.0", methods: deps.methods, operators: { [DEVICE_NODE]: { type: "N4mRolePipeline" } },
    digest: deps.hash, targetNames: ["demo_target"],
    resolveFeatures: ({ view }) => {
      if (view.partition === "fold_train" || view.partition === "full_train") {
        if (!training) throw new Error("Prediction must never fit or read training views.");
        if (JSON.stringify(view.sample_ids) !== JSON.stringify(training.ids)) throw new Error("DAG changed the capture training order.");
      }
      const X = new Float64Array(view.sample_ids.length * data.nFeatures);
      view.sample_ids.forEach((id, row) => {
        const position = positions.get(id);
        if (position === undefined) throw new Error(`Unknown capture unit '${id}' in DAG view.`);
        X.set(data.X.subarray(position * data.nFeatures, (position + 1) * data.nFeatures), row * data.nFeatures);
      });
      return { sampleIds: [...view.sample_ids], featureNames: data.featureNames, matrix: { data: X, rows: view.sample_ids.length, cols: data.nFeatures } };
    },
    resolveTargets: ({ sampleIds }) => {
      if (!training) throw new Error("Prediction cannot read targets.");
      const y = Float64Array.from(sampleIds, id => {
        const position = positions.get(id);
        if (position === undefined) throw new Error(`Unknown capture target '${id}'.`);
        return training.y[position];
      });
      return { sampleIds: [...sampleIds], matrix: { data: y, rows: sampleIds.length, cols: 1 } };
    },
  };
  return { controller: new deps.Controller(options), options };
}

export async function fitOwner(X: Float64Array, y: Float64Array, descriptor: SpectrumDescriptor, captures: TrainingCapture[]) {
  const deps = await loadOwners(), served = nativeDataset(deps, X, y, descriptor, captures);
  const input = { name: "x", kind: "data", representation: "tabular_numeric", cardinality: "one", description: "" };
  const output = { name: "oof", kind: "prediction", representation: null, cardinality: "one", description: "" };
  const graph = { id: "graph:device.demo", interface: { inputs: [input], outputs: [output] },
    nodes: [{ id: DEVICE_NODE, kind: "model", operator: { type: "N4mRolePipeline" }, params: { pipeline_steps_v1: demoRecipe() },
      ports: { inputs: [input], outputs: [output] }, metadata: {}, seed_label: null }], edges: [], metadata: {} };
  const e = served.envelope;
  const campaign = { id: "campaign:device.demo", root_seed: 0, split_invocation: null,
    generation: { strategy: "none", dimensions: [], max_variants: 1 }, data_bindings: { [DEVICE_NODE]: [{
      node_id: DEVICE_NODE, input_name: "x", request_id: REQUEST, schema_fingerprint: e.schema_fingerprint,
      plan_fingerprint: e.plan_fingerprint, relation_fingerprint: e.relation_fingerprint,
      output_representation: e.plan.output_representation, feature_set_id: "x", source_ids: ["nir"], require_relations: true,
    }] } };
  const { controller } = createDeviceController(deps, served.data, { ids: served.data.sampleIds, y: served.y });
  try {
    const manifests = JSON.stringify([controller.manifest(deps.dag)]);
    // A builder refusal is an owner finding; there is no alternate graph or fit.
    const plan = deps.dag.build_execution_plan_json("plan:device.demo", JSON.stringify(graph), JSON.stringify(campaign), manifests);
    const result = JSON.parse(deps.dag.execute_initial_full_refit_json(plan, manifests, JSON.stringify(e),
      JSON.stringify(served.data.sampleIds), "package:device.demo", "run:device.demo.refit", "0", controller.callback)) as {
        initial_full_refit_package_json: string; initial_full_refit_package: { outputs: { output_id: string }[] };
      };
    const outputId = result.initial_full_refit_package.outputs[0]?.output_id;
    if (!outputId || typeof result.initial_full_refit_package_json !== "string") throw new Error("DAG returned no exact initial full-refit package.");
    return { packageJson: result.initial_full_refit_package_json, outputId };
  } finally { controller.close(); }
}

export async function replayOwner(packageJson: string, outputId: string, X: Float64Array, descriptor: SpectrumDescriptor): Promise<number> {
  const deps = await loadOwners(), id = "predict:s0";
  const { controller } = createDeviceController(deps, { X, nFeatures: X.length, sampleIds: [id], featureNames: descriptor.axis.map(String) });
  try {
    const envelope = deps.dag.initial_full_refit_predict_envelope_json(packageJson, JSON.stringify({ role: "inference",
      relations: { records: [{ observation_id: id, sample_id: id, source_id: "nir", target_id: null,
        group_id: null, origin_sample_id: null, is_augmented: false }] },
      target_names: ["demo_target"], data_content_fingerprint: numericFingerprint(deps.hash, X) }));
    const result = JSON.parse(deps.dag.replay_initial_full_refit_json(packageJson, envelope, JSON.stringify([outputId]),
      "{}", "run:device.demo.predict", controller.callback)) as {
        replay_outcome: { outputs: { output_id: string; prediction: { sample_ids: string[]; target_names: string[]; values: number[][] } }[] };
      };
    const output = result.replay_outcome.outputs[0], block = output?.prediction;
    if (result.replay_outcome.outputs.length !== 1 || output?.output_id !== outputId
      || JSON.stringify(block?.sample_ids) !== JSON.stringify([id]) || JSON.stringify(block?.target_names) !== '["demo_target"]'
      || block?.values.length !== 1 || block.values[0]?.length !== 1 || !Number.isFinite(block.values[0][0])) {
      throw new Error("DAG returned no finite prediction for the declared capture and target.");
    }
    return block.values[0][0];
  } finally { controller.close(); }
}
