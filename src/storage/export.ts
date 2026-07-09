import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { Capacitor } from "@capacitor/core";
import type { SpectrumCapture } from "@/domain/types";
import { capturesToMatrixCsv, spectrumToCsv } from "@/domain/spectrum";

export type ExportKind = "single-csv" | "matrix-csv" | "json";

export function buildExport(captures: SpectrumCapture[], kind: ExportKind): { filename: string; mime: string; text: string } {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  if (kind === "json") {
    return {
      filename: `nirs4all-device-captures-${stamp}.json`,
      mime: "application/json",
      text: JSON.stringify({ schema: "nirs4all-device.captures.v1", captures }, null, 2),
    };
  }
  if (kind === "matrix-csv") {
    return {
      filename: `nirs4all-device-matrix-${stamp}.csv`,
      mime: "text/csv",
      text: capturesToMatrixCsv(captures),
    };
  }
  return {
    filename: `nirs4all-device-spectrum-${stamp}.csv`,
    mime: "text/csv",
    text: captures.length > 0 ? spectrumToCsv(captures[0]) : "sample_id,capture_id,created_at,axis,value,axis_unit,signal_type\n",
  };
}

export async function exportTextFile(file: { filename: string; mime: string; text: string }): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Filesystem.writeFile({
      path: file.filename,
      data: file.text,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    });
    await Share.share({ title: file.filename, text: file.filename });
    return;
  }
  const blob = new Blob([file.text], { type: file.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  a.click();
  URL.revokeObjectURL(url);
}
