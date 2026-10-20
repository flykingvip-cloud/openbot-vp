import { afterEach, describe, expect, it } from "vitest";
import { buildRemoteGatewayEnvironmentPrompt } from "./runtime-environment-hint.js";

describe("buildRemoteGatewayEnvironmentPrompt", () => {
  afterEach(() => {
    delete process.env.OPENBOT_CLOUD_GATEWAY;
  });

  it("returns guidance for cloud workspace roots", () => {
    const prompt = buildRemoteGatewayEnvironmentPrompt("/root/.openbot/agents/main/workspace");
    expect(prompt).toContain("remote OpenBot gateway");
    expect(prompt).toContain("/Users/");
  });

  it("returns undefined for local user workspaces", () => {
    expect(
      buildRemoteGatewayEnvironmentPrompt("/Users/test/.openbot/agents/main/workspace"),
    ).toBeUndefined();
  });
});
