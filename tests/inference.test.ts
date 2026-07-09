import { describe, expect, it } from "vitest";
import { PortableNirs4allInferenceEngine } from "@/runtime/inference";

describe("n4a artifact import", () => {
  it("keeps pipeline definitions in context without marking them runnable", () => {
    const artifact = new PortableNirs4allInferenceEngine().importArtifact(
      JSON.stringify({
        name: "Pretreatment only",
        pipeline: [{ class: "nirs4all.operators.transforms.StandardNormalVariate" }],
      }),
      "pretreatment.n4a",
    );

    expect(artifact.runnable).toBe(false);
    expect(artifact.kind).toBe("pipeline_definition");
    expect(artifact.validationMessage).toContain("Pipeline definition loaded");
  });
});
