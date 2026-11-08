import { useEffect, useState } from "react";
import { buildSpectrumEnvelope } from "@/domain/spectrum";
import type { SpectrumCapture, SpectrumEnvelope } from "@/domain/types";

/** Hide the previous result on the first render of a new selection, then discard stale completions. */
export function useSpectrumEnvelope(captures: SpectrumCapture[], selected: SpectrumCapture | null, label: string): SpectrumEnvelope | null {
  const [completed, setCompleted] = useState<{
    captures: SpectrumCapture[];
    selected: SpectrumCapture;
    label: string;
    envelope: SpectrumEnvelope;
  } | null>(null);
  useEffect(() => {
    let active = true;
    if (selected) {
      // Spectrum can declare an unknown signal; the domain entrypoint reports that refusal.
      void buildSpectrumEnvelope(captures, selected.spectrum, label, selected.id).then((envelope) => {
        if (active) setCompleted({ captures, selected, label, envelope });
      }, (error: unknown) => {
        if (!active) return;
        const reason = `Envelope unavailable: ${error instanceof Error ? error.message : String(error)}`;
        setCompleted({ captures, selected, label, envelope: {
          label, axis: [], lower: [], median: [], upper: [], count: 0,
          diagnostics: { status: "unavailable", totalCount: captures.length, includedCaptureIds: [], excluded: [],
            refused: captures.map((capture) => ({ captureId: capture.id, reason })), finiteCounts: null, unavailableReason: reason },
        } });
      });
    }
    return () => { active = false; };
  }, [captures, selected, label]);
  return completed?.captures === captures && completed.selected === selected && completed.label === label ? completed.envelope : null;
}
