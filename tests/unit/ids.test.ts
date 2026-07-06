import { describe, expect, it } from "vitest";
import { createEventId, createHermesId } from "../../src/core/ids.js";

describe("Hermes IDs", () => {
  it("creates prefixed IDs", () => {
    expect(createHermesId("abc")).toMatch(/^abc_[0-9a-z]+$/);
    expect(createEventId()).toMatch(/^evt_[0-9a-z]+$/);
  });
});
