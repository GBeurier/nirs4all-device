import type { SpectrumCapture } from "@/domain/types";

export interface SpectrumStats {
  bands: number;
  finiteShare: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  std: number | null;
  range: number | null;
}

export function summarizeSpectrum(capture: SpectrumCapture | null): SpectrumStats | null {
  if (!capture?.spectrum) return null;
  const values = capture.spectrum.values;
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) {
    return {
      bands: values.length,
      finiteShare: values.length === 0 ? 0 : finite.length / values.length,
      min: null,
      max: null,
      mean: null,
      std: null,
      range: null,
    };
  }
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const variance = finite.length < 2 ? 0 : finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (finite.length - 1);
  return {
    bands: values.length,
    finiteShare: values.length === 0 ? 0 : finite.length / values.length,
    min,
    max,
    mean,
    std: Math.sqrt(variance),
    range: max - min,
  };
}
