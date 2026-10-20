import { describe, expect, it } from "vitest";
import { resolveMeshLifetimeUsageDateRange, resolveMeshUsageDateRange } from "./mesh-shell.ts";

describe("resolveMeshUsageDateRange", () => {
  it("covers the current calendar month through today", () => {
    const now = new Date(2026, 7, 10, 12, 0, 0); // local Aug 10, 2026
    expect(resolveMeshUsageDateRange(now)).toEqual({
      startDate: "2026-08-01",
      endDate: "2026-08-10",
    });
  });
});

describe("resolveMeshLifetimeUsageDateRange", () => {
  it("covers lifetime window through today", () => {
    const now = new Date(2026, 7, 10, 12, 0, 0);
    expect(resolveMeshLifetimeUsageDateRange(now)).toEqual({
      startDate: "2020-01-01",
      endDate: "2026-08-10",
    });
  });
});
