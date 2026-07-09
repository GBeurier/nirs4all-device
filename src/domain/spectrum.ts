import type { Spectrum, SpectrumCapture, SpectrumEnvelope } from "./types";

export function makeCaptureId(prefix = "cap"): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${stamp}_${suffix}`;
}

export function encodeBytesBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBytesBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function interpolateSpectrum(source: Spectrum, targetAxis: number[]): Spectrum {
  if (source.axis.length === targetAxis.length && source.axis.every((v, i) => v === targetAxis[i])) {
    return source;
  }
  const values = targetAxis.map((x) => interpolatePoint(source.axis, source.values, x));
  return { ...source, axis: targetAxis, values };
}

export function spectrumToCsv(capture: SpectrumCapture): string {
  const rows = [["sample_id", "capture_id", "created_at", "axis", "value", "axis_unit", "signal_type"]];
  if (!capture.spectrum) return rows.map((row) => row.join(",")).join("\n");
  for (let i = 0; i < capture.spectrum.axis.length; i += 1) {
    rows.push([
      csvCell(capture.sampleId),
      csvCell(capture.id),
      csvCell(capture.createdAt),
      String(capture.spectrum.axis[i]),
      String(capture.spectrum.values[i]),
      csvCell(capture.spectrum.axisUnit),
      csvCell(capture.spectrum.signalType),
    ]);
  }
  return rows.map((row) => row.join(",")).join("\n");
}

export function capturesToMatrixCsv(captures: SpectrumCapture[]): string {
  const spectra = captures.filter((capture) => capture.spectrum) as Array<SpectrumCapture & { spectrum: Spectrum }>;
  if (spectra.length === 0) return "sample_id\n";
  const axis = spectra[0].spectrum.axis;
  const header = ["sample_id", ...axis.map((x) => `x_${formatAxis(x)}`)];
  const rows = [header];
  for (const capture of spectra) {
    const spectrum = interpolateSpectrum(capture.spectrum, axis);
    rows.push([csvCell(capture.sampleId), ...spectrum.values.map((value) => String(value))]);
  }
  return rows.map((row) => row.join(",")).join("\n");
}

export function buildSpectrumEnvelope(
  captures: SpectrumCapture[],
  targetAxis: number[],
  label: string,
  lowerQ = 0.1,
  upperQ = 0.9,
): SpectrumEnvelope | null {
  const spectra = captures.filter((capture) => capture.spectrum) as Array<SpectrumCapture & { spectrum: Spectrum }>;
  if (spectra.length < 2 || targetAxis.length === 0) return null;
  const aligned = spectra.map((capture) => interpolateSpectrum(capture.spectrum, targetAxis).values);
  const lower: number[] = [];
  const median: number[] = [];
  const upper: number[] = [];
  for (let col = 0; col < targetAxis.length; col += 1) {
    const values = aligned.map((row) => row[col]).filter(Number.isFinite).sort((a, b) => a - b);
    if (values.length === 0) {
      lower.push(Number.NaN);
      median.push(Number.NaN);
      upper.push(Number.NaN);
    } else {
      lower.push(quantile(values, lowerQ));
      median.push(quantile(values, 0.5));
      upper.push(quantile(values, upperQ));
    }
  }
  return { label, axis: targetAxis, lower, median, upper };
}

function interpolatePoint(axis: number[], values: number[], x: number): number {
  if (axis.length === 0) return Number.NaN;
  if (x <= axis[0]) return values[0];
  if (x >= axis[axis.length - 1]) return values[values.length - 1];
  let hi = 1;
  while (hi < axis.length && axis[hi] < x) hi += 1;
  const lo = hi - 1;
  const span = axis[hi] - axis[lo];
  const t = span === 0 ? 0 : (x - axis[lo]) / span;
  return values[lo] + (values[hi] - values[lo]) * t;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const t = pos - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * t;
}

function formatAxis(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function csvCell(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}
