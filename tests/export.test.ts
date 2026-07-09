import { describe, expect, it } from "vitest";
import { makeSimulatedCapture } from "@/device/simulatedDevice";
import { buildExport } from "@/storage/export";

describe("exports", () => {
  it("builds a single spectrum CSV", () => {
    const file = buildExport([makeSimulatedCapture("s1")], "single-csv");
    expect(file.filename.endsWith(".csv")).toBe(true);
    expect(file.text.split("\n")[0]).toBe("sample_id,capture_id,created_at,axis,value,axis_unit,signal_type");
    expect(file.text).toContain("s1");
  });

  it("builds a matrix CSV", () => {
    const file = buildExport([makeSimulatedCapture("s1"), makeSimulatedCapture("s2")], "matrix-csv");
    const lines = file.text.split("\n");
    expect(lines[0].startsWith("sample_id,x_")).toBe(true);
    expect(lines).toHaveLength(3);
  });

  it("builds a JSON bundle", () => {
    const file = buildExport([makeSimulatedCapture("s1")], "json", {
      project: { id: "project-1", name: "Field", createdAt: "2026-01-01T00:00:00.000Z" },
      sessions: [{ id: "session-1", projectId: "project-1", name: "Morning", createdAt: "2026-01-01T00:00:00.000Z" }],
      pipelines: [],
    });
    const parsed = JSON.parse(file.text) as { schema: string; captures: unknown[] };
    expect(parsed.schema).toBe("nirs4all-device.project.v1");
    expect(parsed.captures).toHaveLength(1);
  });

  it("builds a metadata CSV", () => {
    const capture = { ...makeSimulatedCapture("s1"), metadata: { observation: "leaf ok", repetition: "2" } };
    const file = buildExport([capture], "metadata-csv", {
      project: { id: "project-1", name: "Field", createdAt: "2026-01-01T00:00:00.000Z", metadata: { operator: "Ada" } },
    });
    expect(file.filename.endsWith(".csv")).toBe(true);
    expect(file.text.split("\n")[0]).toContain("record_type,record_id,project_id,session_id,sample_id,repetition");
    expect(file.text).toContain("capture,");
    expect(file.text).toContain(",s1,2,s1,");
    expect(file.text).toContain("operator,Ada");
    expect(file.text).toContain("observation,leaf ok");
  });
});
