import { describe, expect, it } from "vitest";

describe("@openbot/collaboration-openbot-adapter package", () => {
  it("resolves through the package name", async () => {
    const mod = await import("@openbot/collaboration-openbot-adapter");
    expect(mod.COLLABORATION_OPENBOT_ADAPTER_VERSION).toBe("0.1.0");
  });
});
