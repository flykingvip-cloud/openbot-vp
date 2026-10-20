import { describe, expect, it } from "vitest";

describe("@openbot/collaboration-runtime package", () => {
  it("resolves through the package name", async () => {
    const mod = await import("./index.js");
    expect(mod.COLLABORATION_RUNTIME_VERSION).toBe("0.1.0");
  });
});
