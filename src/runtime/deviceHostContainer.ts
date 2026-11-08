// Core V1 host-container pattern adapted from Quali app/src/lib/modelIo.ts,
// read 2026-11-08. Storage admission is separate from DAG executability (S != C).
import { openN4aContainer, writeN4aContainer } from "nirs4all";
import type { DeviceContainerRaw, SpectrumDescriptor } from "@/domain/types";
import { requireSpectrumDescriptor } from "@/runtime/spectrumAlignment";
import { DEMO_STATEMENT, DEVICE_NODE, demoRecipe, loadDag, loadHash, relationMetadata, type TrainingCapture } from "@/runtime/ownerRefit";

export const DEVICE_HOST = { owner: "nirs4all.device-host", feature: "nirs4all-device-host@1",
  schema: "nirs4all.device-host.bundle", version: 1, path: "host/bundle.json", profile: "demo-snv-pls2.v1",
  entrypoint: "host-predict", operation: "host.predict", fingerprintProfile: "sha256.raw.v1" } as const;
export interface DeviceHostBundle {
  schema: typeof DEVICE_HOST.schema;
  schema_version: 1;
  profile: typeof DEVICE_HOST.profile;
  name: string;
  description: typeof DEMO_STATEMENT;
  recipe: ReturnType<typeof demoRecipe>;
  descriptor: SpectrumDescriptor;
  nFeatures: number;
  trainingUnit: "capture";
  targetGrain: "synthetic per capture";
  physicalSampleGrouping: "group_id";
  trainingCaptures: TrainingCapture[];
  excludedCaptures: Array<{ captureId: string; reason: string }>;
  demoTarget: { kind: "synthetic"; formula: "10 + 0.7 * row index" };
  targetName: "demo_target";
  packageJson: string;
  outputId: string;
  createdAt: string;
}
const requireValue: (ok: unknown, message: string) => asserts ok = (ok, message) => {
  if (!ok) throw new Error(`Readable but not executable in Device: ${message}`);
};
function same(a: unknown, b: unknown): boolean {
  const ordered = (_key: string, value: unknown) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value;
  return JSON.stringify(a, ordered) === JSON.stringify(b, ordered);
}

/** This admits one named host profile. DAG validates its own sealed package. */
async function admitBundle(value: unknown): Promise<DeviceHostBundle> {
  requireValue(value && typeof value === "object" && !Array.isArray(value), "Device host bundle missing.");
  const bundle = value as DeviceHostBundle;
  requireValue(bundle.schema === DEVICE_HOST.schema && bundle.schema_version === 1 && bundle.profile === DEVICE_HOST.profile,
    "Unsupported Device host schema or model profile; only demo-snv-pls2.v1 is supported.");
  requireValue(same(Object.keys(bundle).sort(), ["schema", "schema_version", "profile", "name", "description", "recipe", "descriptor",
    "nFeatures", "trainingUnit", "targetGrain", "physicalSampleGrouping", "trainingCaptures", "excludedCaptures", "demoTarget",
    "targetName", "packageJson", "outputId", "createdAt"].sort()), "Unsupported Device host fields.");
  requireValue(typeof bundle.name === "string" && bundle.name.length > 0 && typeof bundle.createdAt === "string"
    && bundle.description === DEMO_STATEMENT && bundle.targetName === "demo_target"
    && same(bundle.demoTarget, { kind: "synthetic", formula: "10 + 0.7 * row index" })
    && same(bundle.recipe, demoRecipe()), "Unsupported recipe or synthetic target declaration.");
  const descriptor = requireSpectrumDescriptor(bundle.descriptor);
  requireValue(bundle.nFeatures === descriptor.axis.length, "Feature descriptor width differs from nFeatures.");
  requireValue(bundle.trainingUnit === "capture" && bundle.targetGrain === "synthetic per capture"
    && bundle.physicalSampleGrouping === "group_id", "Unsupported target grain or training unit; physical-sample targets with repeated scans are unsupported.");
  requireValue(Array.isArray(bundle.trainingCaptures) && bundle.trainingCaptures.length >= 4
    && Array.isArray(bundle.excludedCaptures) && bundle.excludedCaptures.every(c => c && typeof c.captureId === "string" && typeof c.reason === "string"),
  "Missing capture provenance.");
  const groups = new Map<string, string>();
  bundle.trainingCaptures.forEach((capture, i) => {
    requireValue(capture && typeof capture.captureId === "string" && typeof capture.sampleId === "string"
      && (capture.repetition === undefined || typeof capture.repetition === "string"), "Invalid original capture/sample/repetition identity.");
    if (!groups.has(capture.sampleId)) groups.set(capture.sampleId, `p${groups.size}`);
    requireValue(capture.unit === `u${i}` && capture.group === groups.get(capture.sampleId), "Capture-unit or physical-sample group mapping differs from route B.");
  });
  requireValue(new Set(bundle.trainingCaptures.map(c => c.captureId)).size === bundle.trainingCaptures.length, "Duplicate original capture identity.");
  requireValue(typeof bundle.packageJson === "string" && typeof bundle.outputId === "string", "Missing exact owner package/output binding.");
  const dag = await loadDag();
  dag.validate_initial_full_refit_package_json(bundle.packageJson);
  // Read-only inspection; never serialize the parsed package back for execution.
  const pkg = JSON.parse(bundle.packageJson);
  const graph = pkg.effective_plan?.graph_plan?.graph, node = graph?.nodes?.[0], campaign = pkg.effective_plan?.campaign;
  requireValue(pkg.schema_version === 1 && same(pkg.training_sample_ids, bundle.trainingCaptures.map(c => c.unit))
    && graph?.nodes?.length === 1 && same(graph.edges, []) && node.id === DEVICE_NODE && node.kind === "model"
    && same(node.operator, { type: "N4mRolePipeline" }) && same(node.params, { pipeline_steps_v1: demoRecipe() })
    && node.ports?.inputs?.length === 1 && node.ports.inputs[0].name === "x" && node.ports.inputs[0].kind === "data"
    && node.ports.inputs[0].representation === "tabular_numeric" && node.ports.inputs[0].cardinality === "one"
    && node.ports?.outputs?.length === 1 && node.ports.outputs[0].name === "oof" && node.ports.outputs[0].kind === "prediction"
    && node.ports.outputs[0].representation === null && node.ports.outputs[0].cardinality === "one"
    && campaign?.split_invocation === null && campaign.generation?.strategy === "none"
    && same(campaign.generation.dimensions, []) && campaign.generation.max_variants === 1
    && (!campaign.shape_plans || same(campaign.shape_plans, {}))
    && pkg.outputs?.length === 1 && same(pkg.outputs[0], { output_id: bundle.outputId, node_id: DEVICE_NODE, port_name: "oof" }),
  "Owner graph, recipe, output or no-splitter scope differs from demo-snv-pls2.v1.");
  const records = pkg.training_relations?.records;
  requireValue(Array.isArray(records) && records.length === bundle.trainingCaptures.length, "Incomplete owner capture relations.");
  const byObservation = new Map(records.map((row: { observation_id: string }) => [row.observation_id, row]));
  bundle.trainingCaptures.forEach((capture, i) => {
    const row = byObservation.get(`o${i}`) as Record<string, unknown> | undefined;
    requireValue(row && row.sample_id === capture.unit && row.group_id === capture.group && row.source_id === "nir"
      && row.target_id === "y" && row.rep_id == null && row.origin_sample_id == null && row.is_augmented === false
      && !row.excluded && same(row.metadata, relationMetadata(capture)), "Owner relation lost the original capture/sample/repetition mapping.");
  });
  return bundle;
}

export function deviceHostManifest(fingerprint: string): Record<string, unknown> {
  const h = DEVICE_HOST;
  return { schema: "nirs4all.n4a.container.v1", schema_version: 1, minimum_reader_version: 1,
    container_id: `container:device.${crypto.randomUUID()}`, physical_profile: "zip-stored.v1", required_features: [h.feature], links: [],
    members: [{ path: h.path, byte_length: 0, sha256: "0".repeat(64) }],
    artifacts: [{ id: h.path, kind: "model", owner: h.owner, content_type: { id: h.schema, version: 1 },
      identity: { owner: h.owner, schema: h.schema, schema_version: 1, fingerprint_profile: h.fingerprintProfile, fingerprint },
      storage: { kind: "embedded", root_member: h.path, member_paths: [h.path] }, requirements: null }],
    entrypoints: [{ id: h.entrypoint, owner: h.owner, operation: h.operation, root_artifact: h.path,
      input_artifacts: [], required_features: [h.feature], requirements: null }] };
}

export async function writeDeviceContainer(bundle: DeviceHostBundle): Promise<DeviceContainerRaw> {
  await admitBundle(bundle);
  const hash = await loadHash(), payload = new TextEncoder().encode(JSON.stringify(bundle)), fingerprint = hash(payload);
  const { archiveBytes, receipt } = await writeN4aContainer(deviceHostManifest(fingerprint), [{ path: DEVICE_HOST.path, bytes: payload }]);
  requireValue(receipt.members.length === 1 && receipt.members[0]?.path === DEVICE_HOST.path
    && receipt.members[0]?.sha256 === fingerprint, "Core member receipt differs from the host payload; export discarded.");
  return { archiveBytes, sha256: receipt.container_sha256 };
}

export async function readDeviceContainer(source: Uint8Array | ArrayBuffer, filename?: string): Promise<{ raw: DeviceContainerRaw; bundle: DeviceHostBundle }> {
  // Core refuses text/ZIP corruption before any host JSON or runtime admission.
  const container = await openN4aContainer(source);
  try {
    const view = container.view(), m = view.readability.manifest, h = DEVICE_HOST;
    const artifact = m.artifacts?.[0], member = m.members?.[0];
    requireValue(m.schema === "nirs4all.n4a.container.v1" && m.schema_version === 1 && m.minimum_reader_version === 1
      && m.physical_profile === "zip-stored.v1" && same(m.required_features, [h.feature]) && same(m.links, [])
      && m.members?.length === 1 && member?.path === h.path && m.artifacts?.length === 1 && artifact?.id === h.path
      && artifact.kind === "model" && artifact.owner === h.owner && same(artifact.content_type, { id: h.schema, version: 1 })
      && same(artifact.identity, { owner: h.owner, schema: h.schema, schema_version: 1,
        fingerprint_profile: h.fingerprintProfile, fingerprint: member.sha256 })
      && same(artifact.storage, { kind: "embedded", root_member: h.path, member_paths: [h.path] }) && artifact.requirements === null
      && same(m.entrypoints, [{ id: h.entrypoint, owner: h.owner, operation: h.operation, root_artifact: h.path,
        input_artifacts: [], required_features: [h.feature], requirements: null }]), "Unsupported host owner, feature, content type or operation.");
    const bytes = await container.readMember(h.path);
    requireValue(bytes, "Device host member missing.");
    const bundle = await admitBundle(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    return { bundle, raw: { archiveBytes: container.archiveBytes(), sha256: view.readability.container_sha256,
      ...(filename === undefined ? {} : { filename }) } };
  } finally { container.close(); }
}
