import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authorizeNodeGovernanceMock, appendGovernanceShadowDecisionMock } = vi.hoisted(() => ({
  authorizeNodeGovernanceMock: vi.fn(),
  appendGovernanceShadowDecisionMock: vi.fn(),
}));

vi.mock("../node-governance.js", () => ({
  authorizeNodeGovernance: authorizeNodeGovernanceMock,
}));
vi.mock("./shadow-sink.js", () => ({
  appendGovernanceShadowDecision: appendGovernanceShadowDecisionMock,
}));

import {
  isNodeInvokeShadowEnabled,
  NODE_INVOKE_SHADOW_ENV,
  recordNodeInvokeShadow,
} from "./node-invoke-shadow.js";

describe("node.invoke scope shadow", () => {
  beforeEach(() => {
    authorizeNodeGovernanceMock.mockReset();
    appendGovernanceShadowDecisionMock.mockReset();
    appendGovernanceShadowDecisionMock.mockResolvedValue(true);
  });

  it("does not read the preflight observe flag", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "node-invoke-shadow.ts"),
      "utf8",
    );
    expect(source).not.toContain("OPENBOT_NODE_INVOKE_PREFLIGHT_OBSERVE");
    expect(isNodeInvokeShadowEnabled({})).toBe(false);
    expect(isNodeInvokeShadowEnabled({ OPENBOT_NODE_INVOKE_PREFLIGHT_OBSERVE: "1" })).toBe(false);
    expect(isNodeInvokeShadowEnabled({ [NODE_INVOKE_SHADOW_ENV]: "1" })).toBe(true);
  });

  it("skips the ownership check when the flag is off", async () => {
    await recordNodeInvokeShadow({
      client: null,
      nodeId: "node-1",
      command: "system.run",
      env: {},
    });
    expect(authorizeNodeGovernanceMock).not.toHaveBeenCalled();
  });

  it("records a would-deny without auditing", async () => {
    authorizeNodeGovernanceMock.mockResolvedValue({
      allowed: false,
      scope: { kind: "self", ownerId: "user-a" },
      ownership: { ownerId: "user-b" },
      reason: "outside-governance-scope",
    });
    await recordNodeInvokeShadow({
      client: null,
      nodeId: "node-1",
      command: "system.run",
      env: { [NODE_INVOKE_SHADOW_ENV]: "1" },
    });
    expect(authorizeNodeGovernanceMock).toHaveBeenCalledWith({
      client: null,
      nodeId: "node-1",
      action: "invoke",
      audit: false,
    });
    expect(appendGovernanceShadowDecisionMock.mock.calls[0]?.[0]).toMatchObject({
      effect: "deny",
      source: "node",
      entry: "E9",
      mode: "shadow",
      reason: "outside-governance-scope",
      shadow: { divergence: "D1" },
    });
  });

  it("classifies unattributed ownership as missing attribution", async () => {
    authorizeNodeGovernanceMock.mockResolvedValue({
      allowed: false,
      scope: { kind: "self", ownerId: "user-a" },
      ownership: {},
      reason: "node-ownership-unattributed",
    });
    await recordNodeInvokeShadow({
      client: null,
      nodeId: "node-1",
      command: "system.run",
      env: { [NODE_INVOKE_SHADOW_ENV]: "1" },
    });
    expect(appendGovernanceShadowDecisionMock.mock.calls[0]?.[0]).toMatchObject({
      effect: "deny",
      reason: "node-ownership-unattributed",
      shadow: { divergence: "D2" },
    });
  });
});
