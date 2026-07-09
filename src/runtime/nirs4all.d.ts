declare module "nirs4all" {
  export interface PipelineDefinition {
    name: string;
    description: string;
    random_state?: number;
    pipeline: unknown[];
  }

  export interface PortableExecutionResult {
    name: string;
    rows: number;
    cols: number;
    preprocessing: { type: string; params: number[] }[];
    selected: { n_components: number; rmse: number; predictions: number[] };
    model: unknown;
    targets: number[];
  }

  export interface CapabilityManifest {
    schema: string;
    aggregate: string;
    runtimeSurfaces: readonly string[];
    controllers: readonly unknown[];
  }

  export function capabilityManifest(): CapabilityManifest;
  export function runPortablePipeline(
    source: string | PipelineDefinition | unknown[] | Record<string, unknown>,
    dataset: { X: Float64Array | number[]; y: Float64Array | number[]; rows: number; cols: number },
    options?: { methods?: unknown },
  ): Promise<PortableExecutionResult>;
  export function predictPortablePipeline(
    fitted: PortableExecutionResult | { preprocessing?: { type: string; params: number[] }[]; model?: unknown },
    dataset: { X: Float64Array | number[]; rows: number; cols: number },
    options?: { methods?: unknown },
  ): Promise<{ data: number[]; rows: number; cols: number }>;
}
