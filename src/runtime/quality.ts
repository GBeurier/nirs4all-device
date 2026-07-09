import type { QualityMetric, QualityReport, SpectrumCapture } from "@/domain/types";

export interface QualityEngine {
  readonly name: string;
  evaluate(capture: SpectrumCapture): Promise<QualityReport>;
}

export class LocalQualityEngine implements QualityEngine {
  readonly name = "local-spectrum-qc";

  async evaluate(capture: SpectrumCapture): Promise<QualityReport> {
    if (!capture.spectrum) {
      return {
        status: "warn",
        score: 35,
        metrics: [],
        flags: ["raw_payload_only"],
        evaluatedAt: new Date().toISOString(),
        engine: this.name,
      };
    }

    const values = capture.spectrum.values;
    const finite = values.filter(Number.isFinite);
    const span = max(finite) - min(finite);
    const variance = sampleVariance(finite);
    const diffNoise = meanAbsDiff(finite);
    const saturationShare = finite.length === 0 ? 1 : finite.filter((v) => v >= max(finite) * 0.99).length / finite.length;
    const negativeShare = finite.length === 0 ? 1 : finite.filter((v) => v < 0).length / finite.length;
    const finiteShare = values.length === 0 ? 0 : finite.length / values.length;

    const metrics: QualityMetric[] = [
      { id: "finite", label: "Finite points", value: finiteShare, threshold: 0.995, pass: finiteShare >= 0.995 },
      { id: "variance", label: "Spectral variance", value: variance, threshold: 1e-8, pass: variance >= 1e-8 },
      { id: "span", label: "Dynamic span", value: span, threshold: 0.01, pass: span >= 0.01 },
      { id: "diff_noise", label: "First-difference noise", value: diffNoise, threshold: 0.06, pass: diffNoise <= 0.06 },
      { id: "saturation", label: "Saturated band share", value: saturationShare, threshold: 0.08, pass: saturationShare <= 0.08 },
      { id: "negative", label: "Negative value share", value: negativeShare, threshold: 0.04, pass: negativeShare <= 0.04 },
    ];
    const failures = metrics.filter((metric) => !metric.pass);
    const score = Math.max(0, Math.round(100 - failures.length * 18 - Math.min(30, diffNoise * 120)));
    return {
      status: failures.length === 0 ? "pass" : failures.length <= 2 ? "warn" : "fail",
      score,
      metrics,
      flags: failures.map((metric) => metric.id),
      evaluatedAt: new Date().toISOString(),
      engine: this.name,
    };
  }
}

function min(values: number[]): number {
  return values.length === 0 ? 0 : Math.min(...values);
}

function max(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function sampleVariance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
}

function meanAbsDiff(values: number[]): number {
  if (values.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < values.length; i += 1) sum += Math.abs(values[i] - values[i - 1]);
  return sum / (values.length - 1);
}
