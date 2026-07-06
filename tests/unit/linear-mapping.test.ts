import { describe, expect, it } from "vitest";
import { shouldExportToLinear } from "../../src/adapters/linear/mapping.js";

describe("Linear export policy", () => {
  it("exports only candidates", () => {
    expect(shouldExportToLinear("local_only")).toBe(false);
    expect(shouldExportToLinear("linear_candidate")).toBe(true);
    expect(shouldExportToLinear("linear_exported")).toBe(false);
  });
});
