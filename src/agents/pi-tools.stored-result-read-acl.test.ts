/**
 * S-07: production stored-result read ACL on the indicated replay path
 * (wrapToolWithBeforeToolCallHook → toToolDefinitions / splitSdkTools).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it } from "vitest";
import {
  getToolStoredResultHostReadBinding,
  wrapToolWithBeforeToolCallHook,
} from "../agent-runtime/capabilities/index.js";
import { resolveStoredResultReadHook } from "../agent-runtime/capabilities/invocation/authorize-stored-result-read.js";
import { splitSdkTools } from "./pi-embedded-runner/tool-split.js";
import { createOpenClawCodingTools } from "./pi-tools.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function tool(
  name: string,
  run: () => Promise<AgentToolResult<unknown>> | AgentToolResult<unknown>,
): AgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: Type.Object({}),
    execute: async () => await run(),
  };
}

type ToolExecute = ReturnType<typeof splitSdkTools>["customTools"][number]["execute"];
const extensionContext = {} as Parameters<ToolExecute>[4];

async function execute(def: { execute: ToolExecute }, callId: string) {
  return await def.execute(callId, {}, undefined, undefined, extensionContext);
}

describe("production stored-result read ACL", () => {
  it("wires a host read binding on createOpenClawCodingTools and ignores membership-only construction", () => {
    const withoutIdentity = createOpenClawCodingTools();
    const withoutBinding =
      withoutIdentity.find((entry) => entry.name === "read") ?? withoutIdentity[0];
    expect(getToolStoredResultHostReadBinding(withoutBinding)).toBeUndefined();

    const withBinding = createOpenClawCodingTools({
      sessionKey: "sess-wire",
      sessionId: "sid-wire",
      runId: "run-wire",
      executionIdentity: {
        user: "ceo",
        platformUserId: "u1",
        sessionDomain: "enterprise",
        enterpriseId: "ent-1",
        membershipId: "mem-1",
      },
    });
    const wired = withBinding.find((entry) => entry.name === "read") ?? withBinding[0];
    const binding = getToolStoredResultHostReadBinding(wired);
    expect(binding).toContain("stored-result-read:v1:");
    expect(binding).toContain("sess-wire");
    expect(binding).toContain("run-wire");
    expect(binding).not.toContain("ent-1");
    expect(binding).not.toContain("mem-1");
  });

  it("allows same-binding replay of a stored receipt and does not leak it across bindings", async () => {
    const ledgerDir = await fs.mkdtemp(path.join(os.tmpdir(), "stored-result-read-acl-"));
    tempDirs.push(ledgerDir);
    let effects = 0;
    const owner = resolveStoredResultReadHook({
      sessionKey: "sess-acl",
      runId: "run-1",
      taskId: "private",
      executionAttempt: "attempt-1",
    });
    const other = resolveStoredResultReadHook({
      sessionKey: "sess-acl",
      runId: "run-2",
      taskId: "private",
      executionAttempt: "attempt-1",
    });
    const makeWrapped = (hook: ReturnType<typeof resolveStoredResultReadHook>) =>
      wrapToolWithBeforeToolCallHook(
        tool("message", () => {
          effects++;
          return {
            content: [{ type: "text", text: "PRIVATE_RECEIPT" }],
            details: { status: "ok" },
          };
        }),
        {
          hostReadBinding: hook.hostReadBinding,
          authorizeStoredResultRead: hook.authorizeStoredResultRead,
        },
      );

    const ownerTools = splitSdkTools({
      tools: [makeWrapped(owner)],
      sandboxEnabled: false,
      deliveryToolSideEffect: { ledgerDir, taskId: "private", boardItemId: "item", stepId: "step" },
    }).customTools;
    const first = JSON.stringify(await execute(ownerTools[0], "first"));
    expect(first).toContain("PRIVATE_RECEIPT");
    expect(effects).toBe(1);

    const replay = JSON.stringify(await execute(ownerTools[0], "replay"));
    expect(replay).toContain("PRIVATE_RECEIPT");
    expect(replay).not.toContain("Stored result read authorization");
    expect(effects).toBe(1);

    const otherTools = splitSdkTools({
      tools: [makeWrapped(other)],
      sandboxEnabled: false,
      deliveryToolSideEffect: { ledgerDir, taskId: "private", boardItemId: "item", stepId: "step" },
    }).customTools;
    const cross = JSON.stringify(await execute(otherTools[0], "cross-run"));
    expect(cross).not.toContain("PRIVATE_RECEIPT");
    expect(cross).toContain("Stored result read authorization");
    expect(effects).toBe(1);
  });

  it("keeps unstamped historical receipts fail-closed even under a current host binding", async () => {
    const ledgerDir = await fs.mkdtemp(path.join(os.tmpdir(), "stored-result-read-unstamped-"));
    tempDirs.push(ledgerDir);
    let effects = 0;
    const wrapped = wrapToolWithBeforeToolCallHook(
      tool("message", () => {
        effects++;
        return { content: [{ type: "text", text: "PRIVATE_RECEIPT" }], details: { status: "ok" } };
      }),
      { authorizeStoredResultRead: () => "allowed" },
    );
    const { customTools } = splitSdkTools({
      tools: [wrapped],
      sandboxEnabled: false,
      deliveryToolSideEffect: { ledgerDir, taskId: "private", boardItemId: "item", stepId: "step" },
    });
    expect(JSON.stringify(await execute(customTools[0], "seed"))).toContain("PRIVATE_RECEIPT");
    expect(effects).toBe(1);

    const later = resolveStoredResultReadHook({ sessionKey: "sess", runId: "run" });
    const reread = splitSdkTools({
      tools: [
        wrapToolWithBeforeToolCallHook(
          tool("message", () => {
            effects++;
            return {
              content: [{ type: "text", text: "SHOULD_NOT_RUN" }],
              details: { status: "ok" },
            };
          }),
          {
            hostReadBinding: later.hostReadBinding,
            authorizeStoredResultRead: later.authorizeStoredResultRead,
          },
        ),
      ],
      sandboxEnabled: false,
      deliveryToolSideEffect: { ledgerDir, taskId: "private", boardItemId: "item", stepId: "step" },
    }).customTools;
    const replay = JSON.stringify(await execute(reread[0], "unstamped"));
    expect(replay).not.toContain("PRIVATE_RECEIPT");
    expect(replay).toContain("Stored result read authorization");
    expect(effects).toBe(1);
  });
});
