import { describe, expect, it } from "vitest";
import { createMemoryHealthProbe } from "./health-probe.factory.js";

describe("health-probe.factory DI boundary", () => {
  it("exports a probe with read-only surface methods", () => {
    const probe = createMemoryHealthProbe();
    expect(typeof probe.probeAgent).toBe("function");
    expect(typeof probe.collectSnapshot).toBe("function");
    expect(typeof probe.runIntegrityCheck).toBe("function");
    expect(probe).not.toHaveProperty("sync");
    expect(probe).not.toHaveProperty("search");
  });
});
