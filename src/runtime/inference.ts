import { capabilityManifest } from "nirs4all";
import type { DeviceContainerRaw, DevicePipelineArtifact, PipelineArtifact, PredictionResult, SpectrumCapture } from "@/domain/types";
import { alignSpectrum, requireSpectrumDescriptor } from "@/runtime/spectrumAlignment";
import { DEMO_STATEMENT, demoRecipe, fitOwner, replayOwner, trainingCaptures } from "@/runtime/ownerRefit";
import { DEVICE_HOST, readDeviceContainer, writeDeviceContainer, type DeviceHostBundle } from "@/runtime/deviceHostContainer";

export interface InferenceEngine {
  readonly name: string;
  capabilities(): ReturnType<typeof capabilityManifest>;
  importArtifact(bytes: Uint8Array | ArrayBuffer, filename?: string): Promise<PipelineArtifact>;
  exportArtifact(artifact: PipelineArtifact): Promise<Uint8Array>;
  classifyStored(artifact: PipelineArtifact): PipelineArtifact;
  predict(capture: SpectrumCapture, artifact: PipelineArtifact): Promise<PredictionResult>;
  fitDemoArtifact(captures: SpectrumCapture[]): Promise<PipelineArtifact>;
}

export const LEGACY_MODEL_MESSAGE = "Legacy JSON model is readable but not executable in Device. Refit the synthetic demo or import a Device .n4a model.";

export class PortableNirs4allInferenceEngine implements InferenceEngine {
  readonly name = "nirs4all-device-owner-wasm";

  capabilities(): ReturnType<typeof capabilityManifest> {
    return capabilityManifest();
  }

  /** Opaque classification only: never inspect, execute or rewrite historical raw state. */
  classifyStored(artifact: PipelineArtifact): PipelineArtifact {
    return artifact.kind === "device_n4a_container" ? artifact
      : { ...artifact, kind: "legacy_json", runnable: false, validationMessage: LEGACY_MODEL_MESSAGE };
  }

  async importArtifact(bytes: Uint8Array | ArrayBuffer, filename?: string): Promise<DevicePipelineArtifact> {
    const { bundle, raw } = await readDeviceContainer(bytes, filename);
    return this.artifact(bundle, raw);
  }

  async exportArtifact(artifact: PipelineArtifact): Promise<Uint8Array> {
    const { raw } = await this.admitArtifact(artifact);
    return raw.archiveBytes; // Independent copy of the exact imported archive; no reserialization.
  }

  async predict(capture: SpectrumCapture, artifact: PipelineArtifact): Promise<PredictionResult> {
    const { bundle } = await this.admitArtifact(artifact);
    if (!capture.spectrum) throw new Error("Cannot predict without a decoded numeric spectrum.");
    const spectrum = await alignSpectrum(capture.spectrum, bundle.descriptor);
    if (spectrum.values.length !== artifact.nFeatures || artifact.nFeatures !== bundle.nFeatures) {
      throw new Error(`Spectrum has ${spectrum.values.length} features but artifact expects ${artifact.nFeatures}.`);
    }
    if (!spectrum.values.every(Number.isFinite)) throw new Error("Prediction requires a finite numeric spectrum.");
    const value = await replayOwner(bundle.packageJson, bundle.outputId, Float64Array.from(spectrum.values), bundle.descriptor);
    return { pipelineId: artifact.id, pipelineName: artifact.name, value, predictedAt: new Date().toISOString(), engine: this.name };
  }

  async fitDemoArtifact(captures: SpectrumCapture[]): Promise<DevicePipelineArtifact> {
    const decoded = captures.filter((capture): capture is SpectrumCapture & { spectrum: NonNullable<SpectrumCapture["spectrum"]> } => !!capture.spectrum);
    if (decoded.length < 4) throw new Error("At least four decoded captures are required to fit a demo portable pipeline.");
    const descriptor = requireSpectrumDescriptor(decoded[0].spectrum);
    const aligned = await Promise.all(decoded.map(async capture => {
      try {
        const spectrum = await alignSpectrum(capture.spectrum, descriptor);
        if (!spectrum.values.every(Number.isFinite)) throw new Error("Demo fit requires finite numeric spectra.");
        return spectrum;
      } catch (error) {
        throw new Error(`Demo fit refused capture ${capture.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));
    const mapping = trainingCaptures(decoded);
    const fitted = await fitOwner(Float64Array.from(aligned.flatMap(s => s.values)),
      Float64Array.from(decoded, (_, i) => 10 + 0.7 * i), descriptor, mapping);
    const bundle: DeviceHostBundle = {
      schema: DEVICE_HOST.schema, schema_version: 1, profile: DEVICE_HOST.profile,
      name: "Device demo SNV + PLS", description: DEMO_STATEMENT, recipe: demoRecipe(),
      descriptor: { ...descriptor, axis: [...descriptor.axis] }, nFeatures: descriptor.axis.length,
      trainingUnit: "capture", targetGrain: "synthetic per capture", physicalSampleGrouping: "group_id",
      trainingCaptures: mapping,
      excludedCaptures: captures.filter(c => !c.spectrum).map(c => ({ captureId: c.id, reason: "Decoded spectrum unavailable." })),
      demoTarget: { kind: "synthetic", formula: "10 + 0.7 * row index" }, targetName: "demo_target",
      ...fitted, createdAt: new Date().toISOString(),
    };
    return this.artifact(bundle, await writeDeviceContainer(bundle));
  }

  private artifact(bundle: DeviceHostBundle, raw: DeviceContainerRaw): DevicePipelineArtifact {
    return { id: `pipe_${raw.sha256}`, name: bundle.name, importedAt: new Date().toISOString(), engine: this.name,
      nFeatures: bundle.nFeatures, runnable: true, kind: "device_n4a_container", targetName: bundle.targetName, raw };
  }

  private async admitArtifact(artifact: PipelineArtifact) {
    const admitted = this.classifyStored(artifact);
    if (!admitted.runnable) throw new Error(admitted.validationMessage ?? "This Device model is not runnable.");
    const raw = admitted.raw as DeviceContainerRaw | undefined;
    if (!raw || !(raw.archiveBytes instanceof Uint8Array) || typeof raw.sha256 !== "string") {
      throw new Error("Readable but not executable in Device: missing original .n4a archive bytes.");
    }
    const opened = await readDeviceContainer(raw.archiveBytes, raw.filename);
    if (opened.raw.sha256 !== raw.sha256) throw new Error("Device archive fingerprint differs from the persisted model.");
    return opened;
  }
}
