import type { Spectrum, SpectrumCapture, SpectrumDescriptor, SpectrumEnvelope, SpectrumEnvelopeDiagnostics } from "./types";
import { alignSpectrum, finiteColumnQuantiles, requireSpectrumDescriptor } from "@/runtime/spectrumAlignment";

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

/** The first decoded capture defines the full reference descriptor. No rows are silently omitted. */
export async function capturesToMatrixCsv(captures: SpectrumCapture[]): Promise<string> {
  const identityHeader = ["capture_id", "sample_id", "repetition", "axis_unit", "signal_type"];
  if (captures.length === 0) return `${identityHeader.join(",")}\n`;
  const referenceCapture = captures.find((capture) => capture.spectrum);
  if (!referenceCapture?.spectrum) throw new Error("Matrix CSV unavailable: no decoded captures.");
  const raw = captures.filter((capture) => !capture.spectrum);
  if (raw.length > 0) throw new Error(`Matrix CSV unavailable: decoded spectrum missing for ${raw.map((capture) => capture.id).join(", ")}.`);
  const reference = requireSpectrumDescriptor(referenceCapture.spectrum);
  // Complete every alignment before constructing or handing off any file.
  const aligned = await Promise.all(captures.map(async (capture) => {
    try {
      return await alignSpectrum(capture.spectrum!, reference);
    } catch (error) {
      throw new Error(`Matrix CSV refused capture ${capture.id}: ${errorMessage(error)}`);
    }
  }));
  const rows = [[...identityHeader, ...reference.axis.map((value) => `x_${String(value)}`)]];
  for (let i = 0; i < captures.length; i += 1) {
    const capture = captures[i];
    rows.push([
      capture.id, capture.sampleId, capture.metadata?.repetition ?? "", reference.axisUnit, reference.signalType,
      ...aligned[i].values.map(String),
    ]);
  }
  return rows.map((row) => row.map(matrixCsvCell).join(",")).join("\n");
}

/** Align companions to the selected descriptor, with one accounting entry per input capture. */
export async function buildSpectrumEnvelope(
  captures: SpectrumCapture[],
  reference: SpectrumDescriptor | Spectrum | undefined,
  label: string,
  excludeCaptureId?: string,
): Promise<SpectrumEnvelope> {
  const diagnostics: SpectrumEnvelopeDiagnostics = {
    status: "unavailable", totalCount: captures.length, includedCaptureIds: [], excluded: [], refused: [], finiteCounts: null,
  };
  const candidates = captures.filter((capture) => {
    if (capture.id === excludeCaptureId || !capture.spectrum) {
      diagnostics.excluded.push({ captureId: capture.id, reason: capture.id === excludeCaptureId ? "Selected capture excluded by capture ID." : "Decoded spectrum unavailable." });
      return false;
    }
    return true;
  });
  let target: SpectrumDescriptor;
  try {
    target = requireSpectrumDescriptor(reference);
  } catch (error) {
    const reason = `Reference descriptor unavailable: ${errorMessage(error)}`;
    diagnostics.refused = candidates.map((capture) => ({ captureId: capture.id, reason }));
    return unavailableEnvelope(label, [], diagnostics, reason);
  }
  const rows: number[][] = [];
  for (const capture of candidates) {
    try {
      rows.push((await alignSpectrum(capture.spectrum!, target)).values);
      diagnostics.includedCaptureIds.push(capture.id);
    } catch (error) {
      diagnostics.refused.push({ captureId: capture.id, reason: errorMessage(error) });
    }
  }
  if (rows.length === 0) return unavailableEnvelope(label, target.axis, diagnostics, "No compatible decoded companion captures.");
  try {
    const { lower, median, upper, finiteCounts } = await finiteColumnQuantiles(rows, target.axis.length);
    diagnostics.status = "ready";
    diagnostics.finiteCounts = finiteCounts;
    return { label, axis: [...target.axis], lower, median, upper, count: rows.length, diagnostics };
  } catch (error) {
    return unavailableEnvelope(label, target.axis, diagnostics, `Methods quantiles unavailable: ${errorMessage(error)}`);
  }
}

function unavailableEnvelope(label: string, axis: number[], diagnostics: SpectrumEnvelopeDiagnostics, reason: string): SpectrumEnvelope {
  diagnostics.unavailableReason = reason;
  const missing = () => axis.map(() => Number.NaN);
  return { label, axis: [...axis], lower: missing(), median: missing(), upper: missing(), count: 0, diagnostics };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function matrixCsvCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function csvCell(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}
