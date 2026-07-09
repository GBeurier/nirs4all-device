import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { Capacitor } from "@capacitor/core";
import type { CaptureSession, PipelineArtifact, Project, SpectrumCapture } from "@/domain/types";
import { capturesToMatrixCsv, spectrumToCsv } from "@/domain/spectrum";

export type ExportKind = "single-csv" | "matrix-csv" | "metadata-csv" | "json";

export interface ExportContext {
  project?: Project | null;
  sessions?: CaptureSession[];
  pipelines?: PipelineArtifact[];
}

export function buildExport(captures: SpectrumCapture[], kind: ExportKind, context: ExportContext = {}): { filename: string; mime: string; text: string } {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  if (kind === "json") {
    return {
      filename: `nirs4all-device-project-${stamp}.json`,
      mime: "application/json",
      text: JSON.stringify(
        {
          schema: "nirs4all-device.project.v1",
          project: context.project ?? null,
          sessions: context.sessions ?? [],
          captures,
          pipelines: (context.pipelines ?? []).map((pipeline) => ({
            id: pipeline.id,
            projectId: pipeline.projectId,
            name: pipeline.name,
            importedAt: pipeline.importedAt,
            engine: pipeline.engine,
            nFeatures: pipeline.nFeatures,
            runnable: pipeline.runnable,
            kind: pipeline.kind,
            validationMessage: pipeline.validationMessage,
            targetName: pipeline.targetName,
          })),
        },
        null,
        2,
      ),
    };
  }
  if (kind === "matrix-csv") {
    return {
      filename: `nirs4all-device-matrix-${stamp}.csv`,
      mime: "text/csv",
      text: capturesToMatrixCsv(captures),
    };
  }
  if (kind === "metadata-csv") {
    return {
      filename: `nirs4all-device-metadata-${stamp}.csv`,
      mime: "text/csv",
      text: metadataToCsv(captures, context),
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

function metadataToCsv(captures: SpectrumCapture[], context: ExportContext): string {
  const sessions = new Map((context.sessions ?? []).map((session) => [session.id, session]));
  const rows = [
    [
      "record_type",
      "record_id",
      "project_id",
      "session_id",
      "sample_id",
      "name",
      "created_at",
      "quality_status",
      "quality_score",
      "prediction_value",
      "metadata_key",
      "metadata_value",
    ],
  ];

  if (context.project) {
    pushMetadataRows(rows, {
      recordType: "project",
      recordId: context.project.id,
      projectId: context.project.id,
      sessionId: "",
      sampleId: "",
      name: context.project.name,
      createdAt: context.project.createdAt,
      metadata: context.project.metadata,
    });
  }

  for (const session of context.sessions ?? []) {
    pushMetadataRows(rows, {
      recordType: "session",
      recordId: session.id,
      projectId: session.projectId,
      sessionId: session.id,
      sampleId: "",
      name: session.name,
      createdAt: session.createdAt,
      metadata: session.metadata,
    });
  }

  for (const capture of captures) {
    const session = capture.sessionId ? sessions.get(capture.sessionId) : undefined;
    pushMetadataRows(rows, {
      recordType: "capture",
      recordId: capture.id,
      projectId: capture.projectId ?? session?.projectId ?? "",
      sessionId: capture.sessionId ?? "",
      sampleId: capture.sampleId,
      name: capture.sampleId,
      createdAt: capture.createdAt,
      qualityStatus: capture.quality?.status ?? "",
      qualityScore: capture.quality ? String(capture.quality.score) : "",
      predictionValue: capture.prediction ? String(capture.prediction.value) : "",
      metadata: capture.metadata,
    });
  }

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function pushMetadataRows(
  rows: string[][],
  item: {
    recordType: string;
    recordId: string;
    projectId: string;
    sessionId: string;
    sampleId: string;
    name: string;
    createdAt: string;
    qualityStatus?: string;
    qualityScore?: string;
    predictionValue?: string;
    metadata?: Record<string, string>;
  },
): void {
  const metadata = Object.entries(item.metadata ?? {}).filter(([, value]) => value.trim().length > 0);
  const entries = metadata.length > 0 ? metadata : [["", ""]];
  for (const [key, value] of entries) {
    rows.push([
      item.recordType,
      item.recordId,
      item.projectId,
      item.sessionId,
      item.sampleId,
      item.name,
      item.createdAt,
      item.qualityStatus ?? "",
      item.qualityScore ?? "",
      item.predictionValue ?? "",
      key,
      value,
    ]);
  }
}

function csvCell(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}
