import type { CaptureSession, QualityReport, Spectrum, SpectrumCapture } from "@/domain/types";

export interface DatasetQualitySummary {
  captureCount: number;
  decodedCount: number;
  rawOnlyCount: number;
  sessionCount: number;
  passCount: number;
  warnCount: number;
  failCount: number;
  unevaluatedCount: number;
  medianScore: number | null;
  meanScore: number | null;
  predictionCount: number;
  predictionCoverage: number;
  repsPerSample: { min: number; max: number; mean: number } | null;
  axisRange: { start: number; end: number; unit: Spectrum["axisUnit"]; bands: number } | null;
  flagCounts: Array<{ flag: string; count: number }>;
  metricProtocol: string[];
}

export function summarizeDatasetQuality(captures: SpectrumCapture[], sessions: CaptureSession[]): DatasetQualitySummary {
  const decoded = captures.filter((capture) => capture.spectrum);
  const qualityReports = captures.map((capture) => capture.quality).filter(isQualityReport);
  const scores = qualityReports.map((report) => report.score).filter(Number.isFinite).sort((a, b) => a - b);
  const flagCounts = new Map<string, number>();

  for (const report of qualityReports) {
    for (const flag of report.flags) flagCounts.set(flag, (flagCounts.get(flag) ?? 0) + 1);
  }

  return {
    captureCount: captures.length,
    decodedCount: decoded.length,
    rawOnlyCount: captures.length - decoded.length,
    sessionCount: sessions.length,
    passCount: captures.filter((capture) => capture.quality?.status === "pass").length,
    warnCount: captures.filter((capture) => capture.quality?.status === "warn").length,
    failCount: captures.filter((capture) => capture.quality?.status === "fail").length,
    unevaluatedCount: captures.filter((capture) => !capture.quality).length,
    medianScore: median(scores),
    meanScore: scores.length === 0 ? null : scores.reduce((sum, score) => sum + score, 0) / scores.length,
    predictionCount: captures.filter((capture) => capture.prediction).length,
    predictionCoverage: captures.length === 0 ? 0 : captures.filter((capture) => capture.prediction).length / captures.length,
    repsPerSample: repsPerSample(captures),
    axisRange: axisRange(decoded),
    flagCounts: [...flagCounts.entries()].map(([flag, count]) => ({ flag, count })).sort((a, b) => b.count - a.count || a.flag.localeCompare(b.flag)),
    metricProtocol: ["spectral_quality", "spectral_profile", "reps_per_sample"],
  };
}

function isQualityReport(report: QualityReport | undefined): report is QualityReport {
  return report != null;
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function repsPerSample(captures: SpectrumCapture[]): DatasetQualitySummary["repsPerSample"] {
  const counts = new Map<string, number>();
  for (const capture of captures) counts.set(capture.sampleId, (counts.get(capture.sampleId) ?? 0) + 1);
  const values = [...counts.values()].filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) return null;
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}

function axisRange(captures: SpectrumCapture[]): DatasetQualitySummary["axisRange"] {
  const spectrum = captures.find((capture) => capture.spectrum)?.spectrum;
  if (!spectrum || spectrum.axis.length === 0) return null;
  return {
    start: spectrum.axis[0],
    end: spectrum.axis[spectrum.axis.length - 1],
    unit: spectrum.axisUnit,
    bands: spectrum.axis.length,
  };
}
