import { describe, expect, it } from "vitest";
import { replaceCliName, resolveCliName } from "./cli-name.js";

describe("cli name helpers", () => {
  it("resolves all known binaries to the unified openbot display name", () => {
    expect(resolveCliName(["node"])).toBe("openbot");
    expect(resolveCliName(["node", "/tmp/openbot.mjs"])).toBe("openbot");
    // Legacy openclaw binary still works, but presents as the unified "openbot".
    expect(resolveCliName(["node", "/tmp/openclaw.js"])).toBe("openbot");
    expect(resolveCliName(["node", "/tmp/custom-runner"])).toBe("openbot");
  });

  it("rewrites both direct and runner-prefixed legacy commands", () => {
    expect(replaceCliName("openclaw gateway", "openbot")).toBe("openbot gateway");
    expect(replaceCliName("pnpm openclaw gateway", "openbot")).toBe("pnpm openbot gateway");
    expect(replaceCliName("openbot gateway", "openclaw")).toBe("openclaw gateway");
  });
});
