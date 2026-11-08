import { useState } from "react";
import { Maximize2 } from "lucide-react";
import { SpectraPlot, type SpectraBand } from "nirs4all-ui/viz";
import type { Spectrum, SpectrumCapture, SpectrumEnvelope } from "@/domain/types";

export interface SpectrumPlotViewProps {
  capture: SpectrumCapture | null;
  captureLabel: string;
  overlays?: readonly SpectrumEnvelope[];
  onInspect?: () => void;
}

const signalLabels: Record<Spectrum["signalType"], string> = {
  intensity: "Intensity",
  reflectance: "Reflectance",
  absorbance: "Absorbance",
  unknown: "Unknown",
};

function axisLabel(spectrum: Spectrum): string {
  return spectrum.axisUnit === "nm" ? "Wavelength (nm)" : "Wavenumber (cm⁻¹)";
}

function overlayStyle(overlay: SpectrumEnvelope) {
  return overlay.label.toLowerCase() === "session"
    ? { color: "var(--brand-indigo)", opacity: 0.18, medianDash: "7 3", dashLabel: "long-dashed median" }
    : { color: "var(--brand-cyan)", opacity: 0.20, medianDash: "3 3", dashLabel: "short-dashed median" };
}

function overlayLabel(overlay: SpectrumEnvelope): string {
  const count = overlay.count == null ? "capture/repetition count unavailable" : `${overlay.count} captures/repetitions`;
  return `${overlay.label} q10-q90 + median (${count})`;
}

/** Owner diagnostics are optional: without them the overlay is a plain, known-ready envelope. */
function isUnavailable(overlay: SpectrumEnvelope): boolean {
  return overlay.diagnostics?.status === "unavailable";
}

/** Status and considered population, separate from the per-position finite observation counts. */
function statusNote(overlay: SpectrumEnvelope): string | null {
  const diagnostics = overlay.diagnostics;
  if (!diagnostics) return null;
  if (diagnostics.status === "unavailable") {
    const reason = diagnostics.unavailableReason?.trim() || "no reason supplied by the owner";
    return `${overlay.label} envelope unavailable: ${reason}; considered ${diagnostics.totalCount} captures/repetitions`;
  }
  return `${overlay.label} status: ready; considered ${diagnostics.totalCount} captures/repetitions`;
}

function finiteCountNote(overlay: SpectrumEnvelope): string | null {
  const diagnostics = overlay.diagnostics;
  if (!diagnostics) return null;
  return diagnostics.finiteCounts
    ? `${overlay.label} finite observations per axis position are listed in the point details`
    : `${overlay.label} finite observation counts unavailable`;
}

function ownerListNotes(overlay: SpectrumEnvelope): string[] {
  const diagnostics = overlay.diagnostics;
  if (!diagnostics) return [];
  const list = (items: ReadonlyArray<{ captureId: string; reason: string }>) =>
    items.map((item) => `${item.captureId} (${item.reason})`).join(", ");
  return [
    ...(diagnostics.excluded.length > 0 ? [`${overlay.label} excluded by the owner: ${list(diagnostics.excluded)}`] : []),
    ...(diagnostics.refused.length > 0 ? [`${overlay.label} refused by the owner: ${list(diagnostics.refused)}`] : []),
  ];
}

function missingLabel(axis: readonly number[], values: readonly number[]): string {
  if (values.length !== axis.length) return "unaligned array (unavailable in plot)";
  const missing = axis.reduce((count, x, index) => count + (!Number.isFinite(x) || !Number.isFinite(values[index]) ? 1 : 0), 0);
  return `${missing} missing coordinate positions`;
}

function cellValue(value: number | undefined): string {
  return value != null && Number.isFinite(value) ? String(value) : "missing";
}

export function SpectrumPlotView({ capture, captureLabel, overlays = [], onInspect }: SpectrumPlotViewProps) {
  if (!capture?.spectrum) {
    return <div className="empty-state">{capture?.rawPayloadBase64 ? "Raw Nano payload captured." : "No decoded spectrum selected."}</div>;
  }
  const { axis, values, axisUnit, signalType } = capture.spectrum;
  const repetition = capture.metadata?.repetition?.trim();
  // Only ready envelopes become bands; an unavailable envelope has empty quantile arrays and is never drawn.
  const readyOverlays = overlays.filter((overlay) => !isUnavailable(overlay));
  const bands: SpectraBand[] = readyOverlays.map((overlay) => {
    const { color, opacity, medianDash } = overlayStyle(overlay);
    return {
      lower: overlay.lower,
      upper: overlay.upper,
      median: overlay.median,
      label: overlayLabel(overlay),
      color,
      opacity,
      medianDash,
    };
  });
  const diagnosticNotes = overlays.flatMap((overlay) => [statusNote(overlay), finiteCountNote(overlay), ...ownerListNotes(overlay)]).filter((note): note is string => note != null);
  const description = [
    `Selected capture ${captureLabel}; capture ID ${capture.id}; physical sample ID ${capture.sampleId}.`,
    `${axisLabel(capture.spectrum)}; signal ${signalLabels[signalType]}; ${axis.length} axis positions.`,
    `Capture: ${missingLabel(axis, values)}.`,
    ...readyOverlays.map((overlay) => `${overlayLabel(overlay)}; ${overlayStyle(overlay).dashLabel}; lower: ${missingLabel(axis, overlay.lower)}; upper: ${missingLabel(axis, overlay.upper)}; median: ${missingLabel(axis, overlay.median)}.`),
    ...diagnosticNotes.map((note) => `${note}.`),
    "Missing coordinates are gaps, never zero or interpolated. Isolated finite values remain available in point details.",
  ].join(" ");

  return (
    <div className="spectrum-view">
      <div className="spectrum-plot">
        <SpectraPlot
          wavelengths={axis}
          series={[{ id: capture.id, label: captureLabel, values, color: "var(--brand-teal)", opacity: 1 }]}
          bands={bands}
          unit={axisUnit}
          xLabel={axisLabel(capture.spectrum)}
          yLabel={signalLabels[signalType]}
          title={`Spectrum ${captureLabel}`}
          description={description}
        />
        {onInspect && (
          <button className="spectrum-inspect icon-button" title="Inspect spectrum" aria-label="Inspect spectrum" onClick={onInspect}>
            <Maximize2 size={17} />
          </button>
        )}
      </div>
      <p className="spectrum-summary">{description}</p>
      <div className="spectrum-meta">
        <span>{cellValue(axis[0])}-{cellValue(axis.at(-1))} {axisUnit}</span>
        {repetition && <span>rep {repetition}</span>}
        <span>{values.length} bands</span>
        <span>{signalType}</span>
        {readyOverlays.map((overlay) => (
          <span key={overlay.label}>{overlayLabel(overlay)}; {overlayStyle(overlay).dashLabel}</span>
        ))}
        {overlays.map((overlay) => {
          const note = statusNote(overlay);
          return note ? <span key={`${overlay.label}-status`}>{note}</span> : null;
        })}
      </div>
    </div>
  );
}

export function SpectrumPointTable({
  capture,
  captureLabel,
  overlays = [],
}: {
  capture: SpectrumCapture;
  captureLabel: string;
  overlays?: readonly SpectrumEnvelope[];
}) {
  const [open, setOpen] = useState(false);
  if (!capture.spectrum) return null;
  const { axis, values, signalType } = capture.spectrum;
  return (
    <details className="spectrum-point-details" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>View point values</summary>
      {open && (
        <div className="spectrum-point-scroll" role="region" aria-label="Spectrum point values, scrollable" tabIndex={0}>
          <table>
            <caption>
              {captureLabel} — capture ID {capture.id}; physical sample ID {capture.sampleId}; signal {signalLabels[signalType]}.
              {" "}Original axis order; non-finite or absent values are marked missing.
            </caption>
            <thead>
              <tr>
                <th scope="col">{axisLabel(capture.spectrum)}</th>
                <th scope="col">{captureLabel} ({signalLabels[signalType]})</th>
                {overlays.flatMap((overlay) => [
                  ...(isUnavailable(overlay)
                    ? []
                    : [
                        <th scope="col" key={`${overlay.label}-lower`}>{overlay.label} q10</th>,
                        <th scope="col" key={`${overlay.label}-upper`}>{overlay.label} q90</th>,
                        <th scope="col" key={`${overlay.label}-median`}>{overlay.label} median</th>,
                      ]),
                  ...(overlay.diagnostics?.finiteCounts
                    ? [<th scope="col" key={`${overlay.label}-finite`}>{overlay.label} finite count</th>]
                    : []),
                ])}
              </tr>
            </thead>
            <tbody>
              {axis.map((x, index) => (
                <tr key={index}>
                  <th scope="row">{cellValue(x)}</th>
                  <td>{cellValue(values[index])}</td>
                  {overlays.flatMap((overlay) => [
                    ...(isUnavailable(overlay)
                      ? []
                      : [
                          <td key={`${overlay.label}-lower`}>{cellValue(overlay.lower[index])}</td>,
                          <td key={`${overlay.label}-upper`}>{cellValue(overlay.upper[index])}</td>,
                          <td key={`${overlay.label}-median`}>{cellValue(overlay.median[index])}</td>,
                        ]),
                    // An owner count of 0 is a real count and is shown as 0 (cellValue only marks non-finite/absent as missing).
                    ...(overlay.diagnostics?.finiteCounts
                      ? [<td key={`${overlay.label}-finite`}>{cellValue(overlay.diagnostics.finiteCounts[index])}</td>]
                      : []),
                  ])}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
