import { describe, expect, it } from "vitest";
import { validateConfigObject } from "./config.js";

describe("gateway.supervisor schema", () => {
  it("accepts gateway.supervisor.enabled for supervisor.feature.set persistence", () => {
    const res = validateConfigObject({
      gateway: {
        supervisor: {
          enabled: true,
          runner: { enabled: true, maxConcurrency: 4 },
        },
      },
    });
    expect(res.ok).toBe(true);
  });
});
