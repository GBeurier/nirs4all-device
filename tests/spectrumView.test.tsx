import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpectraPlotProps } from "nirs4all-ui/viz";
import type { SpectrumCapture, SpectrumEnvelope } from "@/domain/types";
import { SpectrumPlotView } from "@/app/SpectrumPlotView";
import { SpectrumDetailDialog } from "@/app/App";

const { plotProps } = vi.hoisted(() => ({ plotProps: vi.fn() }));

// Observe the public boundary while retaining the real staged UI renderer.
vi.mock("nirs4all-ui/viz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("nirs4all-ui/viz")>();
  return {
    ...actual,
    SpectraPlot: (props: SpectraPlotProps) => {
      plotProps(props);
      return <actual.SpectraPlot {...props} />;
    },
  };
});

// Import only the real dialog from App; its unused host services stay inert.
vi.mock("@/runtime/inference", () => ({ PortableNirs4allInferenceEngine: class {} }));
vi.mock("@/device/capacitorBleTransport", () => ({ CapacitorBleTransport: class {} }));
vi.mock("@/device/nano/nanoDevice", () => ({ DlpNirscanNanoDevice: class {} }));

function fixture() {
  const capture: SpectrumCapture = {
    id: "capture-42",
    sampleId: "physical-sample-7",
    metadata: { repetition: "2" },
    createdAt: "2026-11-08T12:00:00.000Z",
    source: "simulated",
    device: { id: "sim", name: "Simulator", model: "Simulator", transport: "simulator" },
    tags: [],
    spectrum: {
      axis: [901, 903, 910, 940, 1010],
      values: [0.2, 0.25, Number.NaN, 0.4, 0.45],
      axisUnit: "nm",
      signalType: "reflectance",
    },
  };
  const overlays: SpectrumEnvelope[] = [
    { label: "Project", axis: capture.spectrum!.axis, lower: [0.1, 0.15, Number.NaN, 0.3, 0.35], upper: [0.3, 0.35, Number.NaN, 0.5, 0.55], median: [0.2, 0.23, 0.3, 0.4, 0.45], count: 3 },
    { label: "Session", axis: capture.spectrum!.axis, lower: [0.2, 0.25, 0.3, 0.35, 0.4], upper: [0.4, 0.45, 0.5, 0.55, 0.6], median: [0.3, 0.33, 0.4, 0.45, 0.5], count: 2 },
  ];
  return { capture, overlays, captureLabel: "physical-sample-7 rep 2" };
}

describe("Device spectrum presentation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => {
    plotProps.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(node: ReactNode) {
    await act(async () => root.render(node));
  }

  async function click(selector: string) {
    const target = container.querySelector<HTMLButtonElement>(selector);
    expect(target).not.toBeNull();
    await act(async () => target!.click());
  }

  function lastPlot(): SpectraPlotProps {
    expect(plotProps).toHaveBeenCalled();
    return plotProps.mock.lastCall![0] as SpectraPlotProps;
  }

  function expectFiniteGeometry() {
    for (const path of container.querySelectorAll("svg path[d]")) {
      expect(path.getAttribute("d")).not.toMatch(/NaN|Infinity/);
    }
  }

  it("preserves empty and raw Nano states without fabricating a decoded plot", async () => {
    const { capture, captureLabel } = fixture();
    await render(<SpectrumPlotView capture={null} captureLabel="" onInspect={vi.fn()} />);
    expect(container.textContent).toBe("No decoded spectrum selected.");
    await render(<SpectrumPlotView capture={{ ...capture, spectrum: undefined, rawPayloadBase64: "AQID" }} captureLabel={captureLabel} onInspect={vi.fn()} />);
    expect(container.textContent).toBe("Raw Nano payload captured.");
    expect(plotProps).not.toHaveBeenCalled();
    expect(container.querySelector("button, table, svg")).toBeNull();
  });

  it("passes original axes, capture identity and two medians through the shared public contract", async () => {
    const props = fixture();
    const before = structuredClone(props);
    Object.freeze(props.capture.spectrum!.axis);
    Object.freeze(props.capture.spectrum!.values);
    Object.freeze(props.capture.spectrum);
    Object.freeze(props.capture.metadata);
    Object.freeze(props.capture);
    for (const overlay of props.overlays) {
      Object.freeze(overlay.lower);
      Object.freeze(overlay.upper);
      Object.freeze(overlay.median);
      Object.freeze(overlay);
    }
    Object.freeze(props.overlays);
    await render(<SpectrumPlotView {...props} />);
    const plot = lastPlot();
    expect(plot.wavelengths).toBe(props.capture.spectrum!.axis);
    expect(plot.series).toHaveLength(1);
    expect(plot.series![0].id).toBe(props.capture.id);
    expect(plot.series![0].id).not.toBe(props.capture.sampleId);
    expect(plot.series![0].label).toBe(props.captureLabel);
    expect(plot.series![0].values).toBe(props.capture.spectrum!.values);
    expect(plot.unit).toBe("nm");
    expect(plot.xLabel).toBe("Wavelength (nm)");
    expect(plot.yLabel).toBe("Reflectance");
    expect(plot.bands).toHaveLength(2);
    for (const [index, overlay] of props.overlays.entries()) {
      expect(plot.bands![index].lower).toBe(overlay.lower);
      expect(plot.bands![index].upper).toBe(overlay.upper);
      expect(plot.bands![index].median).toBe(overlay.median);
      expect(plot.bands![index].label).toContain(`${overlay.count} captures/repetitions`);
    }
    expect(plot.bands!.map((band) => band.color)).toEqual(["var(--brand-cyan)", "var(--brand-indigo)"]);
    expect(plot.bands!.map((band) => band.medianDash)).toEqual(["3 3", "7 3"]);
    expect(plot.mean).toBeUndefined();
    expect(plot.meanColor).toBeUndefined();
    expect(container.querySelector('path[stroke-dasharray="3 3"]')).not.toBeNull();
    expect(container.querySelector('path[stroke-dasharray="7 3"]')).not.toBeNull();
    expect(container.querySelector("svg desc")?.textContent).toBe(plot.description);
    expect(container.querySelector(".spectrum-summary")?.textContent).toBe(plot.description);
    expect(plot.description).toContain("physical sample ID physical-sample-7");
    expect(plot.description).toContain("Capture: 1 missing coordinate positions");
    expect(container.querySelector(".spectrum-meta")?.textContent).toContain("Project q10-q90 + median (3 captures/repetitions)");
    expect(container.querySelector(".spectrum-meta")?.textContent).toContain("Session q10-q90 + median (2 captures/repetitions)");
    expect(container.querySelector("table, details")).toBeNull();
    expectFiniteGeometry();
    expect(props).toEqual(before);
  });

  it("updates a descending nonuniform wavenumber axis and never guesses the signal or population", async () => {
    const props = fixture();
    const spectrum = { ...props.capture.spectrum!, axis: [11120, 11090, Number.NaN, 10800, 10200], axisUnit: "cm-1" as const, signalType: "intensity" as const };
    const capture = { ...props.capture, id: "capture-43", metadata: { repetition: "3" }, spectrum };
    const overlays = [{ ...props.overlays[0], count: undefined }, { ...props.overlays[1], count: 0 }];
    await render(<SpectrumPlotView {...props} />);
    await render(<SpectrumPlotView capture={capture} captureLabel="physical-sample-7 rep 3" overlays={overlays} />);
    expect(lastPlot().wavelengths).toBe(spectrum.axis);
    expect(lastPlot().series![0].id).toBe("capture-43");
    expect(lastPlot().unit).toBe("cm-1");
    expect(lastPlot().xLabel).toBe("Wavenumber (cm⁻¹)");
    expect(lastPlot().yLabel).toBe("Intensity");
    expect(container.textContent).toContain("capture/repetition count unavailable");
    expect(container.textContent).toContain("0 captures/repetitions");
    await render(<SpectrumPlotView capture={{ ...capture, spectrum: { ...spectrum, signalType: "unknown" } }} captureLabel="physical-sample-7 rep 3" overlays={overlays} />);
    expect(lastPlot().yLabel).toBe("Unknown");
    expect(lastPlot().description).toContain("signal Unknown");
    expect(lastPlot().description).not.toContain("Absorbance");
    expectFiniteGeometry();
  });

  it("provides original point positions and independent bounds/medians only through detail disclosure", async () => {
    const { capture, overlays } = fixture();
    await render(<SpectrumDetailDialog capture={capture} overlays={overlays} onClose={vi.fn()} />);
    expect(container.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Spectrum physical-sample-7 rep 2");
    expect(container.querySelector("table")).toBeNull();
    const details = container.querySelector("details")!;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    const table = container.querySelector("table")!;
    expect(table).not.toBeNull();
    expect(table.querySelector("caption")?.textContent).toContain("capture ID capture-42; physical sample ID physical-sample-7");
    expect([...table.querySelectorAll("thead th")].map((cell) => cell.textContent)).toEqual([
      "Wavelength (nm)", "physical-sample-7 rep 2 (Reflectance)", "Project q10", "Project q90", "Project median", "Session q10", "Session q90", "Session median",
    ]);
    const rows = table.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(5);
    expect([...rows[2].children].map((cell) => cell.textContent)).toEqual(["910", "missing", "missing", "missing", "0.3", "0.3", "0.5", "0.4"]);
    expect([...table.querySelectorAll('tbody th[scope="row"]')].map((cell) => cell.textContent)).toEqual(["901", "903", "910", "940", "1010"]);
    await act(async () => {
      details.open = false;
      details.dispatchEvent(new Event("toggle"));
    });
    expect(container.querySelector("table")).toBeNull();
  });

  // ---- owner diagnostics (optional additive SpectrumEnvelope.diagnostics) ----
  const NAN = Number.NaN;
  function diagnosticOverlays() {
    const { capture, overlays } = fixture();
    const project: SpectrumEnvelope = {
      label: "Project",
      axis: capture.spectrum!.axis,
      lower: [0.1, 0.15, NAN, 0.3, 0.35],
      upper: [0.3, 0.35, NAN, 0.5, 0.55],
      median: [0.2, 0.23, NAN, 0.4, 0.45],
      count: 3,
      diagnostics: { status: "ready", totalCount: 4, includedCaptureIds: ["a", "b", "c"], excluded: [{ captureId: "capture-42", reason: "selected capture" }], refused: [], finiteCounts: [3, 3, 0, 3, 3] },
    };
    const session: SpectrumEnvelope = {
      ...overlays[1],
      diagnostics: { status: "ready", totalCount: 2, includedCaptureIds: ["d", "e"], excluded: [], refused: [], finiteCounts: [2, 2, 2, 2, 2] },
    };
    return { capture, project, session };
  }

  it("never describes or draws an unavailable owner envelope as computed and shows the owner reasons", async () => {
    const { capture, project } = diagnosticOverlays();
    const unavailable: SpectrumEnvelope = {
      label: "Session",
      axis: capture.spectrum!.axis,
      lower: [],
      upper: [],
      median: [],
      count: 0,
      diagnostics: {
        status: "unavailable",
        totalCount: 2,
        includedCaptureIds: [],
        excluded: [{ captureId: "excluded-1", reason: "selected capture" }],
        refused: [{ captureId: "refused-1", reason: "axis unit mismatch" }],
        finiteCounts: null,
        unavailableReason: "owner reduction unavailable",
      },
    };
    await render(<SpectrumPlotView capture={capture} captureLabel="physical-sample-7 rep 2" overlays={[project, unavailable]} />);
    const plot = lastPlot();
    expect(plot.bands).toHaveLength(1);
    expect(plot.bands![0].lower).toBe(project.lower);
    expect(plot.bands![0].label).toContain("Project q10-q90 + median (3 captures/repetitions)");
    const text = container.textContent ?? "";
    expect(plot.description).toContain("Session envelope unavailable: owner reduction unavailable; considered 2 captures/repetitions");
    expect(plot.description).toContain("Session finite observation counts unavailable");
    expect(plot.description).toContain("excluded by the owner: excluded-1 (selected capture)");
    expect(plot.description).toContain("refused by the owner: refused-1 (axis unit mismatch)");
    expect(text).not.toContain("Session q10-q90");
    expect(text).not.toMatch(/Session[^.]*median/);
    expect(text).not.toContain("long-dashed");
    expect(container.querySelector('path[stroke-dasharray="7 3"]')).toBeNull();
    expect(container.querySelector(".spectrum-meta")?.textContent).toContain("Project status: ready; considered 4 captures/repetitions");
    expect(container.querySelector(".spectrum-meta")?.textContent).toContain("Project q10-q90 + median (3 captures/repetitions)");
    expectFiniteGeometry();
  });

  it("shows owner finite counts, including a real 0, beside exact missing quantile cells in the detail table", async () => {
    const { capture, project, session } = diagnosticOverlays();
    await render(<SpectrumDetailDialog capture={capture} overlays={[project, session]} onClose={vi.fn()} />);
    const details = container.querySelector("details")!;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    const table = container.querySelector("table")!;
    expect([...table.querySelectorAll("thead th")].map((cell) => cell.textContent)).toEqual([
      "Wavelength (nm)", "physical-sample-7 rep 2 (Reflectance)",
      "Project q10", "Project q90", "Project median", "Project finite count",
      "Session q10", "Session q90", "Session median", "Session finite count",
    ]);
    const rows = [...table.querySelectorAll("tbody tr")].map((row) => [...row.children].map((cell) => cell.textContent));
    expect(rows).toHaveLength(5);
    expect(rows[2]).toEqual(["910", "missing", "missing", "missing", "missing", "0", "0.3", "0.5", "0.4", "2"]);
    expect(rows.map((row) => row[0])).toEqual(["901", "903", "910", "940", "1010"]);
    expect(rows.map((row) => row[1])).toEqual(["0.2", "0.25", "missing", "0.4", "0.45"]);
    expect(rows.map((row) => row[5])).toEqual(["3", "3", "0", "3", "3"]);
    expect(rows.map((row) => row[9])).toEqual(["2", "2", "2", "2", "2"]);
    expect(rows[0]).toEqual(["901", "0.2", "0.1", "0.3", "0.2", "3", "0.2", "0.4", "0.3", "2"]);
    expect(container.querySelector(".spectrum-summary")?.textContent).toContain("Project finite observations per axis position are listed in the point details");
    // Considered population is reported apart from per-position finite counts.
    expect(container.querySelector(".spectrum-summary")?.textContent).toContain("Project status: ready; considered 4 captures/repetitions");
    expect(container.querySelector(".spectrum-summary")?.textContent).toContain("Project excluded by the owner: capture-42 (selected capture)");
    // The plot receives the owner arrays by reference, with the true gap preserved.
    expect(lastPlot().bands![0].median).toBe(project.median);
  });

  it("adds no finite-count column and never fabricates 0 when the owner supplies no counts", async () => {
    const { capture, project, session } = diagnosticOverlays();
    const noCounts: SpectrumEnvelope = { ...project, diagnostics: { ...project.diagnostics!, finiteCounts: null } };
    await render(<SpectrumDetailDialog capture={capture} overlays={[noCounts, session]} onClose={vi.fn()} />);
    const details = container.querySelector("details")!;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    const headers = [...container.querySelectorAll("thead th")].map((cell) => cell.textContent);
    expect(headers).not.toContain("Project finite count");
    expect(headers).toContain("Session finite count");
    expect(container.querySelector(".spectrum-summary")?.textContent).toContain("Project finite observation counts unavailable");
    expect([...container.querySelectorAll("tbody tr")][2].children).toHaveLength(2 + 3 + 3 + 1);
  });

  it("retains selection updates, inspect, and the existing dialog close/Escape/backdrop actions", async () => {
    const { capture, overlays, captureLabel } = fixture();
    const second = { ...capture, id: "capture-43", metadata: { repetition: "3" } };
    function Host() {
      const [selected, setSelected] = useState(capture);
      const [inspected, setInspected] = useState(false);
      return (
        <>
          <button onClick={() => setSelected(second)}>Select repetition 3</button>
          <SpectrumPlotView capture={selected} captureLabel={selected === capture ? captureLabel : "physical-sample-7 rep 3"} overlays={overlays} onInspect={() => setInspected(true)} />
          {inspected && <SpectrumDetailDialog capture={selected} overlays={overlays} onClose={() => setInspected(false)} />}
        </>
      );
    }
    await render(<Host />);
    await click("button");
    expect(lastPlot().series![0].id).toBe("capture-43");
    await click('[aria-label="Inspect spectrum"]');
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("physical-sample-7 rep 3");
    await click('[aria-label="Close spectrum detail"]');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await click('[aria-label="Inspect spectrum"]');
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await click('[aria-label="Inspect spectrum"]');
    await act(async () => { container.querySelector(".modal-backdrop")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(lastPlot().series![0].id).toBe("capture-43");
    expect(container.querySelector("table")).toBeNull();
  });
});
