import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSimulatedCapture } from "@/device/simulatedDevice";
import { buildExport, exportBinaryFile, exportTextFile } from "@/storage/export";
import type { Spectrum, SpectrumCapture } from "@/domain/types";

const writes = vi.hoisted(() => ({ file: vi.fn(), share: vi.fn(), native: true }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => writes.native } }));
vi.mock("@capacitor/filesystem", () => ({ Filesystem: { writeFile: writes.file }, Directory: { Documents: "documents" }, Encoding: { UTF8: "utf8" } }));
vi.mock("@capacitor/share", () => ({ Share: { share: writes.share } }));

beforeEach(() => {
  vi.clearAllMocks();
  writes.native = true;
});
function capture(id: string, spectrum?: Spectrum): SpectrumCapture {
  return { id, sampleId: "same sample", createdAt: "2026-11-08T00:00:00Z", source: "simulated", tags: [], spectrum,
    device: { id: "sim", name: "Simulator", model: "sim", transport: "simulator" } };
}

// Test-only CSV reader to verify actual serialized fields, including quoted line breaks.
function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) { row.push(cell); cell = ""; }
    else if (ch === "\n" && !quoted) { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

describe("exports", () => {
  it("keeps single-spectrum CSV columns and text unchanged", async () => {
    const input = capture("single", { axis: [3, 1], values: [Number.NaN, 2.5], axisUnit: "cm-1", signalType: "absorbance" });
    const file = await buildExport([input], "single-csv");
    expect(file.filename.endsWith(".csv")).toBe(true);
    expect(file.text).toBe("sample_id,capture_id,created_at,axis,value,axis_unit,signal_type\nsame sample,single,2026-11-08T00:00:00Z,3,NaN,cm-1,absorbance\nsame sample,single,2026-11-08T00:00:00Z,1,2.5,cm-1,absorbance");
  });

  it("builds a matrix CSV for the simulator", async () => {
    const file = await buildExport([makeSimulatedCapture("s1"), makeSimulatedCapture("s2")], "matrix-csv");
    expect(file.text.split("\n")[0].startsWith("capture_id,sample_id,repetition,axis_unit,signal_type,x_")).toBe(true);
    expect(file.text.split("\n")).toHaveLength(3);
  });

  it("round-trips close coordinates, values and repeated sample identities with metadata", async () => {
    const axis = [1.0001, 1.0002, 1.0003];
    const values = [1.0000000000000002, Number.NaN, -1.2345678901234567];
    const spectrum: Spectrum = { axis, values, axisUnit: "nm", signalType: "reflectance" };
    const first = { ...capture('cap,"one"\nline', spectrum), sampleId: 'leaf,"quoted"\nline\rreturn', metadata: { repetition: "01" } };
    const second = { ...capture("cap two", spectrum), sampleId: first.sampleId, metadata: { repetition: '"02"\nrepeat' } };
    const before = structuredClone([first, second]);
    const file = await buildExport([first, second], "matrix-csv");
    const [header, ...rows] = readCsv(file.text);
    expect(header.slice(0, 5)).toEqual(["capture_id", "sample_id", "repetition", "axis_unit", "signal_type"]);
    expect(new Set(header).size).toBe(header.length);
    expect(header.slice(5).map((value) => Number(value.slice(2)))).toEqual(axis);
    expect(rows.map((row) => row.slice(0, 5))).toEqual([
      [first.id, first.sampleId, "01", "nm", "reflectance"],
      [second.id, second.sampleId, second.metadata.repetition, "nm", "reflectance"],
    ]);
    expect(rows.map((row) => row.slice(5).map(Number))).toEqual([values, values]);
    expect([first, second]).toEqual(before);
  });

  it("uses the first decoded descriptor and keeps descending target columns", async () => {
    const first = capture("reference", { axis: [2.5, 1.5], values: [2.5, 1.5], axisUnit: "cm-1", signalType: "intensity" });
    const second = capture("resampled", { axis: [1, 2, 3], values: [1, 2, 3], axisUnit: "cm-1", signalType: "intensity" });
    const [header, ...rows] = readCsv((await buildExport([first, second], "matrix-csv")).text);
    expect(header.slice(5)).toEqual(["x_2.5", "x_1.5"]);
    expect(rows.map((row) => row.slice(3))).toEqual([["cm-1", "intensity", "2.5", "1.5"], ["cm-1", "intensity", "2.5", "1.5"]]);
  });

  it.each([
    { axisUnit: "cm-1" as const },
    { signalType: "absorbance" as const },
    { signalType: "unknown" as const },
    { axis: [1.25, 2.25] },
    { axis: [1, 1] },
    { axis: [1.25, 1.75], values: [Number.NaN, 1] },
  ])("rejects incompatible batches before any write or share (%j)", async (patch) => {
    const good: Spectrum = { axis: [1, 2], values: [1, 2], axisUnit: "nm", signalType: "reflectance" };
    const captures = [capture("good", good), capture("bad", { ...good, ...patch })];
    // Same awaited build -> write boundary as App.exportProject; all I/O is mocked.
    await expect(buildExport(captures, "matrix-csv").then(exportTextFile)).rejects.toThrow();
    expect(writes.file).not.toHaveBeenCalled();
    expect(writes.share).not.toHaveBeenCalled();
  });

  it("refuses raw captures rather than silently dropping rows", async () => {
    const decoded = capture("decoded", { axis: [1, 2], values: [1, 2], axisUnit: "nm", signalType: "reflectance" });
    await expect(buildExport([capture("raw"), decoded], "matrix-csv").then(exportTextFile)).rejects.toThrow("raw");
    expect(writes.file).not.toHaveBeenCalled();
    expect(writes.share).not.toHaveBeenCalled();
  });

  it("builds a JSON bundle with the same host schema and content", async () => {
    const file = await buildExport([makeSimulatedCapture("s1")], "json", {
      project: { id: "project-1", name: "Field", createdAt: "2026-01-01T00:00:00.000Z" },
      sessions: [{ id: "session-1", projectId: "project-1", name: "Morning", createdAt: "2026-01-01T00:00:00.000Z" }], pipelines: [],
    });
    const parsed = JSON.parse(file.text) as { schema: string; captures: unknown[] };
    expect(parsed.schema).toBe("nirs4all-device.project.v1");
    expect(parsed.captures).toHaveLength(1);
  });

  it("builds a metadata CSV", async () => {
    const input = { ...makeSimulatedCapture("s1"), metadata: { observation: "leaf ok", repetition: "2" } };
    const file = await buildExport([input], "metadata-csv", {
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

describe("binary model export", () => {
  it("writes the exact byte view as base64 on native, without UTF-8 encoding, and shares the file URI", async () => {
    // A subarray with a non-zero offset: only bytes 0, 128, 255, 1 may be written.
    const backing = Uint8Array.of(7, 7, 0, 128, 255, 1, 7, 7);
    const bytes = backing.subarray(2, 6);
    expect(bytes.byteOffset).toBe(2);
    writes.file.mockResolvedValue({ uri: "file:///documents/model.n4a" });
    await exportBinaryFile({ filename: "model.n4a", mime: "application/octet-stream", bytes });
    expect(writes.file).toHaveBeenCalledOnce();
    const call = writes.file.mock.calls[0][0] as { path: string; data: string; directory: string };
    expect(call).not.toHaveProperty("encoding");
    expect(call.path).toBe("model.n4a");
    expect(call.directory).toBe("documents");
    expect(call.data).toBe("AID/AQ==");
    expect([...Buffer.from(call.data, "base64")]).toEqual([0, 128, 255, 1]);
    expect(writes.share).toHaveBeenCalledExactlyOnceWith({ title: "model.n4a", url: "file:///documents/model.n4a" });
    expect(writes.share.mock.calls[0][0]).not.toHaveProperty("text");
  });

  it("encodes arbitrary lengths across chunk boundaries without altering a byte", async () => {
    writes.file.mockResolvedValue({ uri: "file:///documents/big.n4a" });
    for (const length of [0, 1, 2, 3, 24576, 24577, 2 * 24576 + 5]) {
      writes.file.mockClear();
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + (i >> 8)) % 256);
      await exportBinaryFile({ filename: "big.n4a", mime: "application/octet-stream", bytes });
      const data = (writes.file.mock.calls[0][0] as { data: string }).data;
      expect(new Uint8Array(Buffer.from(data, "base64"))).toEqual(bytes);
    }
  });

  it("downloads the exact byte view as a Blob in the browser", async () => {
    writes.native = false;
    const bytes = Uint8Array.of(9, 9, 0, 128, 255, 1, 9).subarray(2, 6);
    let blob: Blob | undefined;
    const create = vi.fn((value: Blob) => { blob = value; return "blob:model"; });
    const revoke = vi.fn();
    // jsdom has no object-URL support; install and then restore the two members only.
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = create as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revoke;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      await exportBinaryFile({ filename: "model.n4a", mime: "application/octet-stream", bytes });
      expect(click).toHaveBeenCalledOnce();
      expect(revoke).toHaveBeenCalledWith("blob:model");
      expect(blob!.type).toBe("application/octet-stream");
      const read = await new Promise<Uint8Array>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob!);
      });
      expect([...read]).toEqual([0, 128, 255, 1]);
      expect(writes.file).not.toHaveBeenCalled();
    } finally {
      click.mockRestore();
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
    }
  });

  it("keeps the text export on UTF-8 and leaves model bytes out of the dataset JSON", async () => {
    await exportTextFile({ filename: "a.csv", mime: "text/csv", text: "x" });
    expect(writes.file).toHaveBeenCalledExactlyOnceWith({ path: "a.csv", data: "x", directory: "documents", encoding: "utf8" });
    expect(writes.share).toHaveBeenCalledExactlyOnceWith({ title: "a.csv", text: "a.csv" });
    const pipeline = {
      id: "p1", projectId: "project-1", name: "Demo", importedAt: "2026-11-08T00:00:00.000Z", engine: "owner", nFeatures: 3,
      runnable: true, kind: "portable_result" as const, validationMessage: "ok", targetName: "demo_target",
      raw: { archiveBytes: Uint8Array.of(1, 2, 3), sha256: "00" },
    };
    const file = await buildExport([], "json", { pipelines: [pipeline] });
    const parsed = JSON.parse(file.text) as { pipelines: Record<string, unknown>[] };
    expect(Object.keys(parsed.pipelines[0]).sort()).toEqual(
      ["engine", "id", "importedAt", "kind", "nFeatures", "name", "projectId", "runnable", "targetName", "validationMessage"],
    );
    expect(file.text).not.toContain("archiveBytes");
    expect(file.text).not.toContain("raw");
  });
});
