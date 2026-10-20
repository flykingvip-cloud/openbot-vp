import { describe, expect, it } from "vitest";
import { normalizeCapabilityInstallPreflight } from "./capability-install-preflight.ts";

describe("capability install preflight", () => {
  it("reads employee next steps without exposing runtime fields", () => {
    const blocked = normalizeCapabilityInstallPreflight({
      capabilityId: "openai-whisper-api",
      status: "needs_setup",
      nextStep: "需要先完成服务配置",
      canInstall: false,
    });
    expect(blocked).toEqual({
      capabilityId: "openai-whisper-api",
      status: "needs_setup",
      nextStep: "需要先完成服务配置",
      canInstall: false,
    });
    expect(JSON.stringify(blocked)).not.toContain("provider");
    expect(JSON.stringify(blocked)).not.toContain("runtimeDefinition");
  });

  it("ignores payloads that have no employee next step", () => {
    expect(normalizeCapabilityInstallPreflight({ canInstall: false })).toBeNull();
    expect(normalizeCapabilityInstallPreflight(null)).toBeNull();
  });
});
