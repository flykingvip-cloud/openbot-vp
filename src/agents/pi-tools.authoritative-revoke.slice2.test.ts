import { describe, expect, it } from "vitest";
import {
  isBoundTenantAuthorityStillGranted,
  wrapToolWithAuthoritativeWriteRecheck,
} from "./authoritative-write-recheck.js";
import { applyInboundToolCeiling, type InboundToolCeiling } from "./inbound-tool-policy.js";
import { wrapToolWithBeforeToolCallHook } from "./pi-tools.before-tool-call.js";
import { isToolAllowedByPolicies } from "./pi-tools.policy.js";
import type { SandboxToolPolicy } from "./sandbox.js";
import { ToolAuthorizationError } from "./tools/common.js";
import type { AnyAgentTool } from "./tools/common.js";
import { decideWriteSideRetry, WRITE_SIDE_OUTCOME_UNKNOWN } from "./write-side-retry-gate.js";

/**
 * WP-B slice 2: mid-execution authority revoke on the chat.send coding-tools
 * execute path. The wrapper below mirrors createOpenClawCodingTools in
 * pi-tools.ts (always wrapToolWithBeforeToolCallHook, then applyInboundToolCeiling
 * only when inboundToolCeiling is set, with isStillAllowed reading the
 * tool-list policy snapshot). A mutable authority flag stands in for live
 * membership and is consulted at execute time by wrapToolWithAuthoritativeWriteRecheck.
 */

type Authority = { granted: boolean };

const ALLOW_WRITE_SNAPSHOT: Array<SandboxToolPolicy | undefined> = [];

/** Act-depth ceiling keeps write tools listed and still rechecks isStillAllowed. */
const ACT_CEILING: InboundToolCeiling = {
  depth: "act",
  maxToolMode: "write",
  maxSideEffectLevel: "irreversible_external",
};

function createWriteTool(state: { writeCalls: number }): AnyAgentTool {
  return {
    name: "write",
    execute: async () => {
      state.writeCalls += 1;
      return { content: [{ type: "text" as const, text: "written" }], details: {} };
    },
  } as unknown as AnyAgentTool;
}

function createReadTool(state: { readCalls: number }): AnyAgentTool {
  return {
    name: "read",
    execute: async () => {
      state.readCalls += 1;
      return { content: [{ type: "text" as const, text: "read" }], details: {} };
    },
  } as unknown as AnyAgentTool;
}

/**
 * Same execute-time wrapping as createOpenClawCodingTools (pi-tools.ts).
 * `authority` is the live membership stand-in, consulted at execute time by
 * wrapToolWithAuthoritativeWriteRecheck.
 */
function wrapLikeChatSendCodingTools(
  tool: AnyAgentTool,
  _authority: Authority,
  opts?: {
    inboundToolCeiling?: InboundToolCeiling;
    inboundAclPolicies?: Array<SandboxToolPolicy | undefined>;
  },
): AnyAgentTool {
  const withHooks = wrapToolWithBeforeToolCallHook(tool, {
    agentId: "test-agent",
    runId: "test-run",
  });
  const withAuthority = wrapToolWithAuthoritativeWriteRecheck(withHooks, {
    isAuthorityStillGranted: () => _authority.granted,
  });
  if (!opts?.inboundToolCeiling) {
    return withAuthority;
  }
  const [wrapped] = applyInboundToolCeiling({
    tools: [withAuthority],
    ceiling: opts.inboundToolCeiling,
    isStillAllowed: (toolName) =>
      isToolAllowedByPolicies(toolName, opts.inboundAclPolicies ?? ALLOW_WRITE_SNAPSHOT),
  });
  if (!wrapped) {
    throw new Error("applyInboundToolCeiling dropped the write tool");
  }
  return wrapped;
}

async function executeWrite(tool: AnyAgentTool, callId: string): Promise<unknown> {
  if (!tool.execute) {
    throw new Error("missing execute");
  }
  return tool.execute(callId, { path: "out.txt", content: "x" }, undefined, undefined);
}

describe("WP-B slice 2: revoke after start blocks the next chat.send write", () => {
  it("unrevoked control still performs the next external write", async () => {
    const authority: Authority = { granted: true };
    const state = { writeCalls: 0 };
    const tool = wrapLikeChatSendCodingTools(createWriteTool(state), authority);

    await executeWrite(tool, "call-1");
    expect(authority.granted).toBe(true);
    expect(state.writeCalls).toBe(1);

    await executeWrite(tool, "call-2");
    expect(state.writeCalls).toBe(2);
  });

  it("revoking authority after the first write blocks the next write", async () => {
    const authority: Authority = { granted: true };
    const state = { writeCalls: 0 };
    const tool = wrapLikeChatSendCodingTools(createWriteTool(state), authority);

    await executeWrite(tool, "call-1");
    expect(state.writeCalls).toBe(1);

    authority.granted = false;
    await expect(executeWrite(tool, "call-2")).rejects.toBeInstanceOf(ToolAuthorizationError);

    expect(authority.granted).toBe(false);
    expect(state.writeCalls).toBe(1);
  });

  it("frozen inbound ceiling snapshot still blocks the next write after revoke", async () => {
    const authority: Authority = { granted: true };
    const state = { writeCalls: 0 };
    const tool = wrapLikeChatSendCodingTools(createWriteTool(state), authority, {
      inboundToolCeiling: ACT_CEILING,
      inboundAclPolicies: ALLOW_WRITE_SNAPSHOT,
    });

    await executeWrite(tool, "call-1");
    expect(state.writeCalls).toBe(1);

    authority.granted = false;
    await expect(executeWrite(tool, "call-2")).rejects.toBeInstanceOf(ToolAuthorizationError);

    expect(authority.granted).toBe(false);
    expect(state.writeCalls).toBe(1);
  });

  it("revoke does not recode an already-issued unknown write as failed or ok", () => {
    const recorded = { status: WRITE_SIDE_OUTCOME_UNKNOWN };
    const afterRevoke = decideWriteSideRetry({
      sideEffectLevel: "reversible",
      outcomeStatus: recorded.status,
    });
    expect(afterRevoke.status).toBe(WRITE_SIDE_OUTCOME_UNKNOWN);
    expect(afterRevoke.status).not.toBe("failed");
    expect(afterRevoke.status).not.toBe("ok");
    expect(afterRevoke.allowAutomaticRetry).toBe(false);
  });

  it("read-only tools still execute after authority is revoked", async () => {
    const authority: Authority = { granted: true };
    const state = { readCalls: 0 };
    const tool = wrapLikeChatSendCodingTools(createReadTool(state), authority);

    await executeWrite(tool, "call-1");
    expect(state.readCalls).toBe(1);

    authority.granted = false;
    await executeWrite(tool, "call-2");
    expect(authority.granted).toBe(false);
    expect(state.readCalls).toBe(2);
  });

  it("isBoundTenantAuthorityStillGranted allows the matching tenant and denies null or another tenant", async () => {
    await expect(
      isBoundTenantAuthorityStillGranted({
        boundEnterpriseId: "ent-1",
        resolveAuthority: async () => ({ tenantId: "ent-1" }),
      }),
    ).resolves.toBe(true);

    await expect(
      isBoundTenantAuthorityStillGranted({
        boundEnterpriseId: "ent-1",
        resolveAuthority: async () => ({ tenantId: null }),
      }),
    ).resolves.toBe(false);

    await expect(
      isBoundTenantAuthorityStillGranted({
        boundEnterpriseId: "ent-1",
        resolveAuthority: async () => ({ tenantId: "ent-other" }),
      }),
    ).resolves.toBe(false);
  });
});
