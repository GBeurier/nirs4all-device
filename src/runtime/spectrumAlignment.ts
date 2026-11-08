import type { Spectrum, SpectrumDescriptor } from "@/domain/types";

// loadModule caches only the resolved module; coalesce concurrent first callers here.
let methodsReady: Promise<typeof import("@nirs4all/methods")> | undefined;
function methods(): Promise<typeof import("@nirs4all/methods")> {
  return methodsReady ??= import("@nirs4all/methods").then(async (owner) => {
    await owner.loadModule();
    return owner;
  });
}

/** Resolve the shared loader before a Core runner can initiate its own first load. */
export async function initializeSpectrumMethods(): Promise<void> {
  await methods();
}

/** Declared feature identity only; never infer a unit or signal from coordinates. */
export function requireSpectrumDescriptor(input: unknown): SpectrumDescriptor {
  if (!input || typeof input !== "object") throw new Error("Feature descriptor missing.");
  const descriptor = input as Record<string, unknown>;
  const { axis, axisUnit, signalType } = descriptor;
  if (axisUnit !== "nm" && axisUnit !== "cm-1") throw new Error("Feature axis unit must be nm or cm-1.");
  if (signalType !== "intensity" && signalType !== "reflectance" && signalType !== "absorbance") {
    throw new Error("Feature signal type must be known (intensity, reflectance or absorbance).");
  }
  if (!Array.isArray(axis) || axis.length < 2 || !Array.from(axis).every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("Feature axis must contain at least two finite numeric nodes.");
  }
  const ascending = axis[1] > axis[0];
  for (let i = 1; i < axis.length; i += 1) {
    if (!(ascending ? axis[i] > axis[i - 1] : axis[i] < axis[i - 1])) {
      throw new Error("Feature axis must be strictly monotone without duplicate nodes.");
    }
  }
  return { axis, axisUnit, signalType };
}

/** Target order is authoritative; source reversal is a paired coordinate permutation. */
export async function alignSpectrum(source: Spectrum, reference: SpectrumDescriptor): Promise<Spectrum> {
  const from = requireSpectrumDescriptor(source);
  const target = requireSpectrumDescriptor(reference);
  if (from.axisUnit !== target.axisUnit) throw new Error("Feature axis unit mismatch; unit conversion is unsupported.");
  if (from.signalType !== target.signalType) throw new Error("Feature signal type mismatch; signal conversion is unsupported.");
  if (!Array.isArray(source.values) || source.values.length !== from.axis.length || !Array.from(source.values).every((value) => typeof value === "number")) {
    throw new Error("Spectrum values must be numeric and paired with every source axis node.");
  }
  if (from.axis.length === target.axis.length && from.axis.every((value, index) => value === target.axis[index])) {
    return source; // Preserve exact node values, including NaN and signed zero.
  }
  if (!source.values.every(Number.isFinite)) {
    throw new Error("nonfinite values on a differing grid are unsupported");
  }
  const descending = from.axis[0] > from.axis[from.axis.length - 1];
  const axis = descending ? [...from.axis].reverse() : from.axis;
  const values = descending ? [...source.values].reverse() : source.values;
  if (target.axis.some((value) => value < axis[0] || value > axis[axis.length - 1])) {
    throw new Error("Target axis outside source domain; extrapolation is unsupported.");
  }
  // Public Resampler construction requires an ascending target axis.
  const targetDescending = target.axis[0] > target.axis[target.axis.length - 1];
  const targetAxis = targetDescending ? [...target.axis].reverse() : target.axis;
  const owner = await methods();
  const resampler = new owner.Resampler({
    target_wavelengths: [...targetAxis],
    method: "linear",
    use_crop: false,
    bounds_error: true,
    extrapolate: false,
  });
  const X = { data: Float64Array.from(values), rows: 1, cols: axis.length };
  try {
    resampler.fit(X, undefined, { axis });
    const result = resampler.transform(X);
    const alignedValues = Array.from(result.data);
    if (targetDescending) alignedValues.reverse();
    return { ...source, axis: [...target.axis], values: alignedValues };
  } finally {
    resampler.dispose();
  }
}

/** Thin M1 marshaling; finite filtering and type-7 arithmetic belong to Methods. */
export async function finiteColumnQuantiles(rows: number[][], cols: number): Promise<{
  lower: number[];
  median: number[];
  upper: number[];
  finiteCounts: number[];
}> {
  if (rows.length === 0 || cols < 1 || rows.some((row) => row.length !== cols)) {
    throw new Error("Quantiles require a non-empty rectangular capture matrix.");
  }
  const owner = await methods();
  const outputs = new owner.FiniteColumnQuantiles({ probabilities: [0.1, 0.5, 0.9] }).run({
    data: Float64Array.from(rows.flat()), rows: rows.length, cols,
  });
  const quantiles = outputs.quantiles;
  const finiteCounts = outputs.finite_counts;
  // ProcedureOutput is Matrix | number[] | number. Narrow the generic owner result.
  if (typeof quantiles !== "object" || Array.isArray(quantiles) || quantiles === null ||
      quantiles.rows !== 3 || quantiles.cols !== cols || quantiles.data.length !== 3 * cols ||
      !Array.isArray(finiteCounts) || finiteCounts.length !== cols ||
      !finiteCounts.every((count) => Number.isInteger(count) && count >= 0 && count <= rows.length)) {
    throw new Error("Methods finite-column quantiles returned an invalid result shape.");
  }
  return {
    lower: Array.from(quantiles.data.slice(0, cols)),
    median: Array.from(quantiles.data.slice(cols, 2 * cols)),
    upper: Array.from(quantiles.data.slice(2 * cols, 3 * cols)),
    finiteCounts: [...finiteCounts],
  };
}
