import { describe, expect, it } from "vitest";
import { nextRepetitionId, nextSampleId } from "@/runtime/sampleIds";

describe("sample id iteration", () => {
  it("increments trailing numeric identifiers while preserving padding", () => {
    expect(nextSampleId("sample-001")).toBe("sample-002");
    expect(nextSampleId("leaf_099")).toBe("leaf_100");
  });

  it("adds a numeric suffix when no trailing number exists", () => {
    expect(nextSampleId("field")).toBe("field-002");
  });

  it("falls back to the first default sample id", () => {
    expect(nextSampleId("")).toBe("sample-001");
  });
});

describe("repetition id iteration", () => {
  it("increments numeric repetition identifiers", () => {
    expect(nextRepetitionId("1")).toBe("2");
    expect(nextRepetitionId("009")).toBe("010");
    expect(nextRepetitionId("rep-03")).toBe("rep-04");
  });

  it("falls back to the first repetition id", () => {
    expect(nextRepetitionId("")).toBe("1");
  });
});
