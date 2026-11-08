import {
  capabilityManifest,
  predictPortablePipeline,
  runPortablePipeline,
  type PipelineDefinition,
  type PortableExecutionResult,
} from "nirs4all";
import type { PipelineArtifact, PredictionResult, SpectrumCapture, SpectrumDescriptor } from "@/domain/types";
import { alignSpectrum, initializeSpectrumMethods, requireSpectrumDescriptor } from "@/runtime/spectrumAlignment";

export interface InferenceEngine {
  readonly name: string;
  capabilities(): ReturnType<typeof capabilityManifest>;
  importArtifact(text: string, filename?: string): PipelineArtifact;
  predict(capture: SpectrumCapture, artifact: PipelineArtifact): Promise<PredictionResult>;
  fitDemoArtifact(captures: SpectrumCapture[]): Promise<PipelineArtifact>;
}

export class PortableNirs4allInferenceEngine implements InferenceEngine {
  readonly name = "nirs4all-core-js-wasm";

  capabilities(): ReturnType<typeof capabilityManifest> {
    return capabilityManifest();
  }

  importArtifact(text: string, filename = "pipeline.n4a.json"): PipelineArtifact {
    const raw = JSON.parse(text) as unknown;
    const parsed = parseArtifact(raw, filename);
    return {
      id: parsed.id,
      name: parsed.name,
      importedAt: new Date().toISOString(),
      engine: parsed.engine,
      nFeatures: parsed.nFeatures,
      runnable: parsed.runnable,
      kind: parsed.kind,
      validationMessage: parsed.validationMessage,
      targetName: parsed.targetName,
      raw,
    };
  }

  async predict(capture: SpectrumCapture, artifact: PipelineArtifact): Promise<PredictionResult> {
    if (!artifact.runnable) throw new Error(artifact.validationMessage ?? "This n4a artifact is a pipeline definition, not a fitted portable model.");
    if (!capture.spectrum) throw new Error("Cannot predict without a decoded numeric spectrum.");
    const portable = extractPortableResult(artifact.raw);
    if (!portable.descriptor) throw new Error(portable.descriptorError);
    const spectrum = await alignSpectrum(capture.spectrum, portable.descriptor);
    if (spectrum.values.length !== artifact.nFeatures) {
      throw new Error(`Spectrum has ${spectrum.values.length} features but artifact expects ${artifact.nFeatures}.`);
    }
    await initializeSpectrumMethods();
    const result = await predictPortablePipeline(portable.result, {
      X: Float64Array.from(spectrum.values),
      rows: 1,
      cols: spectrum.values.length,
    });
    const value = result.data[0] ?? Number.NaN;
    return {
      pipelineId: artifact.id,
      pipelineName: artifact.name,
      value,
      predictedAt: new Date().toISOString(),
      engine: this.name,
    };
  }

  async fitDemoArtifact(captures: SpectrumCapture[]): Promise<PipelineArtifact> {
    const decoded = captures.filter((capture) => capture.spectrum) as Array<SpectrumCapture & { spectrum: NonNullable<SpectrumCapture["spectrum"]> }>;
    if (decoded.length < 4) throw new Error("At least four decoded captures are required to fit a demo portable pipeline.");
    // Core 0.4.5 demo path: decoded[0] is the explicit feature reference.
    const descriptor = requireSpectrumDescriptor(decoded[0].spectrum);
    const aligned = await Promise.all(decoded.map(async (capture) => {
      try {
        return await alignSpectrum(capture.spectrum, descriptor);
      } catch (error) {
        throw new Error(`Demo fit refused capture ${capture.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));
    const X = aligned.flatMap((spectrum) => spectrum.values);
    const y = decoded.map((_, index) => 10 + index * 0.7);
    const pipeline: PipelineDefinition = {
      name: "Device demo SNV + PLS",
      description: "Synthetic demo only: demo_target = 10 + 0.7 * row index; no measured endpoint or validation result.",
      pipeline: [
        { class: "nirs4all.operators.transforms.StandardNormalVariate" },
        { model: { class: "sklearn.cross_decomposition.PLSRegression", params: { n_components: 2 } } },
      ],
    };
    await initializeSpectrumMethods();
    const result = await runPortablePipeline(pipeline, {
      X: Float64Array.from(X),
      y: Float64Array.from(y),
      rows: decoded.length,
      cols: descriptor.axis.length,
    });
    const raw = {
      format: "nirs4all-device.portable-pipeline.v1",
      pipeline,
      axis: [...descriptor.axis],
      axisUnit: descriptor.axisUnit,
      signalType: descriptor.signalType,
      trainingCaptureIds: decoded.map((capture) => capture.id),
      excludedCaptures: captures.filter((capture) => !capture.spectrum).map((capture) => ({ captureId: capture.id, reason: "Decoded spectrum unavailable." })),
      demoTarget: { kind: "synthetic", formula: "10 + 0.7 * row index" },
      result,
      targetName: "demo_target",
      createdAt: new Date().toISOString(),
    };
    return {
      id: `demo_${Date.now()}`,
      name: pipeline.name,
      importedAt: new Date().toISOString(),
      engine: this.name,
      nFeatures: descriptor.axis.length,
      runnable: true,
      kind: "portable_result",
      targetName: "demo_target",
      raw,
    };
  }
}

function parseArtifact(raw: unknown, filename: string): {
  id: string;
  name: string;
  engine: string;
  nFeatures: number;
  runnable: boolean;
  kind: PipelineArtifact["kind"];
  validationMessage?: string;
  targetName?: string;
} {
  try {
    const portable = extractPortableResult(raw);
    return {
      id: stableId(filename),
      name: portable.name,
      engine: "nirs4all-core-js-wasm",
      nFeatures: portable.result.cols,
      runnable: portable.descriptor !== undefined,
      kind: "portable_result",
      validationMessage: portable.descriptorError,
      targetName: portable.targetName,
    };
  } catch (error) {
    const definition = extractPipelineDefinition(raw);
    if (!definition) throw error;
    return {
      id: stableId(filename),
      name: definition.name,
      engine: "nirs4all-core-js-wasm",
      nFeatures: 0,
      runnable: false,
      kind: "pipeline_definition",
      validationMessage: "Pipeline definition loaded. Import a fitted portable execution result to enable automatic prediction.",
      targetName: definition.targetName,
    };
  }
}

function extractPortableResult(raw: unknown): {
  name: string;
  descriptor?: SpectrumDescriptor;
  descriptorError?: string;
  result: PortableExecutionResult;
  targetName?: string;
} {
  if (!raw || typeof raw !== "object") throw new Error("Invalid nirs4all pipeline artifact.");
  const obj = raw as Record<string, unknown>;
  const result = (obj.result ?? obj.execution_result ?? obj.model) as PortableExecutionResult | undefined;
  if (!result || typeof result !== "object" || !("model" in result) || typeof result.cols !== "number") {
    throw new Error("Artifact must contain a portable nirs4all execution result.");
  }
  let descriptor: SpectrumDescriptor | undefined;
  let descriptorError: string | undefined;
  if (obj.axis === undefined || obj.axisUnit === undefined || obj.signalType === undefined) {
    descriptorError = "unavailable — feature descriptor missing";
  } else {
    try {
      descriptor = requireSpectrumDescriptor(obj);
    } catch (error) {
      descriptorError = `unavailable — invalid feature descriptor: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return {
    name: String(obj.pipelineName ?? obj.pipeline ?? result.name ?? "portable pipeline"),
    descriptor,
    descriptorError,
    result,
    targetName: typeof obj.targetName === "string" ? obj.targetName : undefined,
  };
}

function extractPipelineDefinition(raw: unknown): { name: string; targetName?: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const pipeline = obj.pipeline;
  const hasPipelineDefinition =
    Array.isArray(pipeline) ||
    (pipeline != null && typeof pipeline === "object") ||
    typeof obj.class === "string" ||
    typeof obj.name === "string";
  if (!hasPipelineDefinition) return null;
  const candidate = pipeline && typeof pipeline === "object" && !Array.isArray(pipeline) ? (pipeline as Record<string, unknown>) : obj;
  return {
    name: String(obj.pipelineName ?? candidate.name ?? obj.name ?? "n4a pipeline definition"),
    targetName: typeof obj.targetName === "string" ? obj.targetName : undefined,
  };
}

function stableId(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  return `pipe_${hash.toString(16)}`;
}
