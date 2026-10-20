import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseGovernanceMode,
  resolveGovernanceModeForCommercialGate,
  resolveGovernanceModeFromEnv,
} from "./mode.js";

describe("governance mode", () => {
  it("parses known modes case-insensitively", () => {
    expect(parseGovernanceMode("legacy")).toBe("legacy");
    expect(parseGovernanceMode(" Shadow ")).toBe("shadow");
    expect(parseGovernanceMode("ENFORCED")).toBe("enforced");
    expect(parseGovernanceMode("enforce")).toBeUndefined();
    expect(parseGovernanceMode("")).toBeUndefined();
    expect(parseGovernanceMode(undefined)).toBeUndefined();
  });

  it("falls back to the non-enforced default", () => {
    expect(
      resolveGovernanceModeFromEnv({ envName: "X_MODE", defaultMode: "shadow", env: {} }),
    ).toBe("shadow");
    expect(
      resolveGovernanceModeFromEnv({
        envName: "X_MODE",
        defaultMode: "shadow",
        env: { X_MODE: "bogus" },
      }),
    ).toBe("shadow");
    expect(
      resolveGovernanceModeFromEnv({
        envName: "X_MODE",
        defaultMode: "shadow",
        env: { X_MODE: "enforced" },
      }),
    ).toBe("enforced");
  });

  it("legacy only when the commercial gate is skipped", () => {
    expect(
      resolveGovernanceModeForCommercialGate({ gateStatus: "skipped", configuredMode: "shadow" }),
    ).toBe("legacy");
    expect(
      resolveGovernanceModeForCommercialGate({ gateStatus: "skipped", configuredMode: "enforced" }),
    ).toBe("legacy");
    expect(
      resolveGovernanceModeForCommercialGate({ gateStatus: "acquired", configuredMode: "shadow" }),
    ).toBe("shadow");
    expect(
      resolveGovernanceModeForCommercialGate({ gateStatus: "acquired", configuredMode: "legacy" }),
    ).toBe("legacy");
  });

  it("does not derive the mode from the security profile", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(dir, "mode.ts"), "utf8");
    const code = source.replace(/\/\*\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/resolveSecurityProfile|personal_local|managed_enterprise/);
    expect(code).not.toMatch(/security-profile/);
  });
});
