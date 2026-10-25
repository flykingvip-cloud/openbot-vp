import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { considerDispatch, considerReadonlyInvoke } from "./dispatch.js";
import { ORCH_READONLY_INVOKE_ENV, isReadonlyInvokeEnabled } from "./feature.js";
import { observeOrchestrationConsider } from "./gateway-hook.js";
import { ORCH_READONLY_PATH_PILOT_ENV, clearReadonlyPathBindingsForTests } from "./path-binding.js";
import { invokeReadonlySurface } from "./readonly-invoke.js";
import { ORCH_REASON } from "./reason-codes.js";
import {
  ORCHESTRATION_LIVE_INVOKE,
  emptyOrchestrationFlags,
  shadowOrchestrationFlags,
} from "./types.js";

const adapters = vi.hoisted(() => {
  const memoryExecute = vi.fn(async () => ({
    content: [{ type: "text", text: "memory-hit" }],
  }));
  const fetchExecute = vi.fn(async () => ({
    content: [{ type: "text", text: "fetched-page" }],
  }));
  const searchExecute = vi.fn(async () => ({
    content: [{ type: "text", text: "search-hit" }],
  }));
  return {
    memoryExecute,
    fetchExecute,
    searchExecute,
    createMemorySearchTool: vi.fn(() => ({ name: "memory_search", execute: memoryExecute })),
    createWebFetchTool: vi.fn(() => ({ name: "web_fetch", execute: fetchExecute })),
    createWebSearchTool: vi.fn(() => ({ name: "web_search", execute: searchExecute })),
    resolveCronSkillsSnapshot: vi.fn(() => ({
      prompt: "skill demo-skill\nInstalled skill body",
      skills: [{ name: "demo-skill" }],
    })),
  };
});

vi.mock("../agents/tools/memory-tool.js", () => ({
  createMemorySearchTool: adapters.createMemorySearchTool,
}));

vi.mock("../agents/tools/web-fetch.js", () => ({
  createWebFetchTool: adapters.createWebFetchTool,
}));

vi.mock("../agents/tools/web-search.js", () => ({
  createWebSearchTool: adapters.createWebSearchTool,
}));

vi.mock("../cron/isolated-agent/skills-snapshot.js", () => ({
  resolveCronSkillsSnapshot: adapters.resolveCronSkillsSnapshot,
}));

const here = dirname(fileURLToPath(import.meta.url));
const onEnv = { [ORCH_READONLY_INVOKE_ENV]: "1" } as NodeJS.ProcessEnv;

function resetAdapters() {
  adapters.memoryExecute.mockClear();
  adapters.fetchExecute.mockClear();
  adapters.searchExecute.mockClear();
  adapters.createMemorySearchTool.mockReset();
  adapters.createWebFetchTool.mockReset();
  adapters.createWebSearchTool.mockReset();
  adapters.resolveCronSkillsSnapshot.mockReset();
  adapters.createMemorySearchTool.mockImplementation(() => ({
    name: "memory_search",
    execute: adapters.memoryExecute,
  }));
  adapters.createWebFetchTool.mockImplementation(() => ({
    name: "web_fetch",
    execute: adapters.fetchExecute,
  }));
  adapters.createWebSearchTool.mockImplementation(() => ({
    name: "web_search",
    execute: adapters.searchExecute,
  }));
  adapters.resolveCronSkillsSnapshot.mockImplementation(() => ({
    prompt: "skill demo-skill\nInstalled skill body",
    skills: [{ name: "demo-skill" }],
  }));
}

describe("OPENBOT_ORCH_READONLY_INVOKE", () => {
  beforeEach(() => {
    clearReadonlyPathBindingsForTests();
    resetAdapters();
  });

  afterEach(() => {
    delete process.env[ORCH_READONLY_INVOKE_ENV];
  });

  it("defaults on and calls the read-only adapter without an env var", async () => {
    expect(isReadonlyInvokeEnabled({})).toBe(true);
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
    const dispatch = considerDispatch({
      intent: "recall_memory",
      flags: shadowOrchestrationFlags(),
      ctrActivationEnabled: false,
      allowlistEmpty: true,
    });
    expect(dispatch.invokedTool).toBe(false);
    expect(dispatch.decision.invoke).toBe(false);
    expect(dispatch.decision.reasonCodes).not.toContain(ORCH_REASON.LIVE_PATH_ARMED);
    const dormant = considerDispatch({
      intent: "read_web",
      flags: emptyOrchestrationFlags(),
      ctrActivationEnabled: true,
      allowlistEmpty: false,
    });
    expect(dormant.invokedTool).toBe(false);

    const readonly = await considerReadonlyInvoke({
      intent: "recall_memory",
      query: "step title",
      env: {},
      config: {} as OpenBotConfig,
    });
    expect(readonly.invokedTool).toBe(true);
    expect(readonly.invoke).toBe(true);
    expect(readonly.kind).toBe("selected");
    expect(readonly.toolName).toBe("memory_search");
    expect(readonly.wroteLedger).toBe(false);
    expect(adapters.createMemorySearchTool).toHaveBeenCalledTimes(1);
    expect(adapters.createWebFetchTool).not.toHaveBeenCalled();
    expect(adapters.createWebSearchTool).not.toHaveBeenCalled();
    expect(adapters.resolveCronSkillsSnapshot).not.toHaveBeenCalled();
  });

  it("stays off when the env var explicitly disables it and does not call a tool", async () => {
    expect(isReadonlyInvokeEnabled({ [ORCH_READONLY_INVOKE_ENV]: "0" })).toBe(false);
    const readonly = await considerReadonlyInvoke({
      intent: "recall_memory",
      query: "step title",
      env: { [ORCH_READONLY_INVOKE_ENV]: "0" },
    });
    expect(readonly.invokedTool).toBe(false);
    expect(readonly.kind).toBe("noop");
    expect(adapters.createMemorySearchTool).not.toHaveBeenCalled();
  });

  it("accepts the same truthy spellings as the other orchestration flags", () => {
    for (const value of ["1", "true", "TRUE", "yes", "on"]) {
      expect(isReadonlyInvokeEnabled({ [ORCH_READONLY_INVOKE_ENV]: value })).toBe(true);
    }
    for (const value of ["0", "false", "off", "no"]) {
      expect(isReadonlyInvokeEnabled({ [ORCH_READONLY_INVOKE_ENV]: value })).toBe(false);
    }
    expect(isReadonlyInvokeEnabled({ [ORCH_READONLY_INVOKE_ENV]: "" })).toBe(true);
  });

  it("calls memory_search when the flag is on and leaves considerDispatch fail-closed", async () => {
    const result = await considerReadonlyInvoke({
      intent: "recall_memory",
      query: "写下仓库 README 的第一行",
      env: { [ORCH_READONLY_INVOKE_ENV]: "true" },
      config: {} as OpenBotConfig,
    });
    expect(result.invokedTool).toBe(true);
    expect(result.invoke).toBe(true);
    expect(result.kind).toBe("selected");
    expect(result.surface).toBe("memory");
    expect(result.toolName).toBe("memory_search");
    expect(result.wroteLedger).toBe(false);
    expect(result.untrustedText).toContain("memory-hit");
    expect(result.promptAppendix).toContain("Not completion evidence");
    expect(adapters.createMemorySearchTool).toHaveBeenCalledTimes(1);
    expect(adapters.memoryExecute).toHaveBeenCalledWith("orch-readonly-memory", {
      query: "写下仓库 README 的第一行",
    });
    expect(adapters.createWebFetchTool).not.toHaveBeenCalled();
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
    const dispatch = considerDispatch({
      intent: "recall_memory",
      flags: shadowOrchestrationFlags(),
      ctrActivationEnabled: false,
      allowlistEmpty: true,
    });
    expect(dispatch.invokedTool).toBe(false);
    expect(dispatch.decision.reasonCodes).not.toContain(ORCH_REASON.LIVE_PATH_ARMED);
  });

  it("does not fall back to web when memory search is unavailable", async () => {
    adapters.createMemorySearchTool.mockReturnValueOnce(null as never);
    const result = await considerReadonlyInvoke({
      intent: "recall_memory",
      query: "prior decision",
      env: onEnv,
    });
    expect(result.invokedTool).toBe(false);
    expect(result.invoke).toBe(false);
    expect(result.reason).toBe("memory_search_unavailable");
    expect(adapters.memoryExecute).not.toHaveBeenCalled();
    expect(adapters.createWebFetchTool).not.toHaveBeenCalled();
    expect(adapters.createWebSearchTool).not.toHaveBeenCalled();
  });

  it("fetches an http(s) query and searches otherwise, never the browser", async () => {
    const fetched = await considerReadonlyInvoke({
      intent: "read_web",
      query: "https://example.com/readme",
      env: { [ORCH_READONLY_INVOKE_ENV]: "yes" },
    });
    expect(fetched.invokedTool).toBe(true);
    expect(fetched.surface).toBe("web_read");
    expect(fetched.toolName).toBe("web_fetch");
    expect(adapters.fetchExecute).toHaveBeenCalledWith("orch-readonly-web-fetch", {
      url: "https://example.com/readme",
    });
    expect(adapters.searchExecute).not.toHaveBeenCalled();

    adapters.fetchExecute.mockClear();
    const searched = await considerReadonlyInvoke({
      intent: "read_web",
      query: "openbot ledger evidence",
      env: { [ORCH_READONLY_INVOKE_ENV]: "on" },
    });
    expect(searched.invokedTool).toBe(true);
    expect(searched.toolName).toBe("web_search");
    expect(adapters.searchExecute).toHaveBeenCalledWith("orch-readonly-web-search", {
      query: "openbot ledger evidence",
    });
    expect(adapters.fetchExecute).not.toHaveBeenCalled();
  });

  it("does not downgrade a missing web factory to another tool", async () => {
    adapters.createWebFetchTool.mockReturnValueOnce(null as never);
    const result = await considerReadonlyInvoke({
      intent: "read_web",
      query: "https://example.com/a",
      env: onEnv,
    });
    expect(result.invokedTool).toBe(false);
    expect(result.reason).toBe("web_read_unavailable");
    expect(adapters.createWebSearchTool).not.toHaveBeenCalled();
    expect(adapters.fetchExecute).not.toHaveBeenCalled();
  });

  it("keeps send_message on the human gate and does not call adapters", async () => {
    const result = await considerReadonlyInvoke({
      intent: "send_message",
      query: "ping",
      env: onEnv,
    });
    expect(result.kind).toBe("human_gate");
    expect(result.surface).toBe("outbound_message");
    expect(result.invoke).toBe(false);
    expect(result.invokedTool).toBe(false);
    expect(adapters.createMemorySearchTool).not.toHaveBeenCalled();
    expect(adapters.createWebFetchTool).not.toHaveBeenCalled();
    expect(adapters.createWebSearchTool).not.toHaveBeenCalled();
    expect(adapters.resolveCronSkillsSnapshot).not.toHaveBeenCalled();
  });

  it("does not invoke write, broadcast, browser, or node exec", async () => {
    const write = await considerReadonlyInvoke({
      intent: "write_external",
      query: "https://example.com",
      env: onEnv,
    });
    const broadcast = await considerReadonlyInvoke({
      intent: "broadcast",
      query: "hello",
      env: onEnv,
    });
    const browser = await considerReadonlyInvoke({
      intent: "interact_web",
      query: "https://example.com",
      env: onEnv,
    });
    const nodeExec = await considerReadonlyInvoke({
      intent: "exec_user_machine",
      query: "uname",
      env: onEnv,
    });
    const blockedBrowser = await considerReadonlyInvoke({
      intent: "read_web",
      query: "https://example.com",
      requestedSurface: "browser",
      env: onEnv,
    });
    expect(write.kind).toBe("human_gate");
    expect(write.surface).toBe("external_write");
    expect(write.invoke).toBe(false);
    expect(broadcast.kind).toBe("human_gate");
    expect(broadcast.surface).toBe("broadcast");
    expect(broadcast.invoke).toBe(false);
    expect(browser.kind).toBe("human_gate");
    expect(browser.invoke).toBe(false);
    expect(nodeExec.kind).toBe("skip");
    expect(nodeExec.invoke).toBe(false);
    expect(blockedBrowser.kind).toBe("blocked_policy");
    expect(blockedBrowser.invoke).toBe(false);
    expect(adapters.createWebFetchTool).not.toHaveBeenCalled();
    expect(adapters.createWebSearchTool).not.toHaveBeenCalled();
    expect(adapters.memoryExecute).not.toHaveBeenCalled();

    const direct = await invokeReadonlySurface({ surface: "node_exec", query: "ls" });
    expect(direct.invokedTool).toBe(false);
    expect(direct.reason).toBe("readonly_invoke_refused");
  });

  it("reads a skill snapshot by skillId and does not treat connector as invoked", async () => {
    const skill = await considerReadonlyInvoke({
      intent: "apply_skill",
      skillId: "demo-skill",
      query: "demo-skill",
      env: onEnv,
      config: {} as OpenBotConfig,
      workspaceDir: "/tmp/ws",
      agentId: "agent-1",
      isFastTestEnv: true,
    });
    expect(skill.invokedTool).toBe(true);
    expect(skill.surface).toBe("skill");
    expect(skill.toolName).toBe("skill_snapshot");
    expect(skill.untrustedText).toContain("demo-skill");
    expect(skill.untrustedText).toContain("Installed skill body");
    expect(skill.wroteLedger).toBe(false);
    expect(adapters.resolveCronSkillsSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceDir: "/tmp/ws",
        agentId: "agent-1",
        isFastTestEnv: true,
      }),
    );

    adapters.resolveCronSkillsSnapshot.mockClear();
    const missingSkill = await considerReadonlyInvoke({
      intent: "apply_skill",
      query: "no id",
      env: onEnv,
    });
    expect(missingSkill.kind).toBe("human_gate");
    expect(missingSkill.invokedTool).toBe(false);
    expect(adapters.resolveCronSkillsSnapshot).not.toHaveBeenCalled();

    const connector = await considerReadonlyInvoke({
      intent: "use_connector",
      connectedConnectorIds: ["gmail"],
      env: onEnv,
    });
    expect(connector.kind).toBe("selected");
    expect(connector.surface).toBe("connector");
    expect(connector.invokedTool).toBe(false);
    expect(connector.reason).toBe("connector_readonly_unavailable");
  });

  it("does not copy DISPATCH, NODE, or BROWSER onto the process environment", async () => {
    const env: NodeJS.ProcessEnv = {
      [ORCH_READONLY_INVOKE_ENV]: "1",
      OPENBOT_CONVERSATION_TASK_ORCH_DISPATCH: "1",
      OPENBOT_CONVERSATION_TASK_ORCH_NODE: "1",
      OPENBOT_CONVERSATION_TASK_ORCH_BROWSER: "1",
    };
    const before = { ...env };
    const result = await considerReadonlyInvoke({
      intent: "read_web",
      query: "https://example.com/doc",
      env,
    });
    expect(env).toEqual(before);
    expect(result.surface).toBe("web_read");
    expect(result.toolName).toBe("web_fetch");
    expect(process.env.OPENBOT_CONVERSATION_TASK_ORCH_DISPATCH).toBeUndefined();
  });

  it("does not invoke from the chat observe hook when the flag is on", () => {
    process.env[ORCH_READONLY_INVOKE_ENV] = "1";
    observeOrchestrationConsider({ messageId: "m1" });
    expect(adapters.createMemorySearchTool).not.toHaveBeenCalled();
    expect(adapters.createWebFetchTool).not.toHaveBeenCalled();
    expect(adapters.createWebSearchTool).not.toHaveBeenCalled();
  });

  it("keeps forbidden tools out of the read-only module and live invoke frozen", () => {
    const source = readFileSync(join(here, "readonly-invoke.ts"), "utf8");
    expect(source).toMatch(/createMemorySearchTool/);
    expect(source).toMatch(/createWebFetchTool/);
    expect(source).toMatch(/createWebSearchTool/);
    expect(source).toMatch(/resolveCronSkillsSnapshot/);
    expect(source).not.toMatch(/createBrowserTool/);
    expect(source).not.toMatch(/createNodesTool/);
    expect(source).not.toMatch(/listNodes/);
    expect(source).not.toMatch(/system\.run/);
    expect(source).not.toMatch(/sessions_spawn/);
    expect(source).not.toMatch(/env-overrides/);
    const dispatchSource = readFileSync(join(here, "dispatch.ts"), "utf8");
    expect(dispatchSource).toMatch(/if \(ORCHESTRATION_LIVE_INVOKE\)/);
    expect(dispatchSource).toMatch(/LIVE_PATH_ARMED/);
    expect(dispatchSource).toMatch(/invokedTool: false/);
    expect(dispatchSource).not.toMatch(/from ["'].*web-search/);
    expect(dispatchSource).not.toMatch(/from ["'].*web-fetch/);
    expect(dispatchSource).not.toMatch(/from ["'].*memory-tool/);
    expect(dispatchSource).not.toMatch(/ORCHESTRATION_LIVE_INVOKE\s*=\s*true/);
    const bindingSource = readFileSync(join(here, "surface-binding.ts"), "utf8");
    expect(bindingSource).not.toMatch(/from ["'].*web-search/);
    expect(bindingSource).not.toMatch(/from ["'].*memory-tool/);
    const hookSource = readFileSync(join(here, "gateway-hook.ts"), "utf8");
    expect(hookSource).toMatch(/resolveOrchestrationObserve/);
    expect(hookSource).toMatch(/allowlistEmpty: observed\.allowlistEmpty/);
    expect(hookSource).not.toMatch(/intent:\s*"recall_memory"/);
    expect(hookSource).not.toMatch(/considerReadonlyInvoke/);
    const gateSource = readFileSync(join(here, "observe-gate.ts"), "utf8");
    expect(gateSource).toMatch(/intent: "recall_memory"/);
    expect(gateSource).toMatch(/allowlistEmpty = !\(explicit && allowlisted\)/);
  });
});

describe("WP-05 readonly single-path pilot", () => {
  beforeEach(() => {
    clearReadonlyPathBindingsForTests();
    resetAdapters();
  });
  afterEach(() => {
    clearReadonlyPathBindingsForTests();
  });

  it("default legacy path invokes memory_search once and returns binding", async () => {
    const result = await invokeReadonlySurface({
      surface: "memory",
      query: "hello",
      actionId: "act-legacy-1",
      env: {},
      deps: {
        createMemorySearchTool: adapters.createMemorySearchTool,
      },
    });
    expect(result.invokedTool).toBe(true);
    expect(result.toolName).toBe("memory_search");
    expect(result.pathBinding?.path).toBe("legacy");
    expect(result.pathBinding?.actionId).toBe("act-legacy-1");
    expect(adapters.memoryExecute).toHaveBeenCalledTimes(1);
  });

  it("refuses dual-exec for the same actionId", async () => {
    await invokeReadonlySurface({
      surface: "memory",
      query: "hello",
      actionId: "act-dual-1",
      env: {},
      deps: { createMemorySearchTool: adapters.createMemorySearchTool },
    });
    const second = await invokeReadonlySurface({
      surface: "memory",
      query: "hello-again",
      actionId: "act-dual-1",
      env: {},
      deps: { createMemorySearchTool: adapters.createMemorySearchTool },
    });
    expect(second.invokedTool).toBe(false);
    expect(second.reason).toBe("dual_exec_refused");
    expect(adapters.memoryExecute).toHaveBeenCalledTimes(1);
  });

  it("fabric path without policyCheck refuses and does not execute", async () => {
    const result = await invokeReadonlySurface({
      surface: "memory",
      query: "hello",
      actionId: "act-fabric-no-check",
      env: { [ORCH_READONLY_PATH_PILOT_ENV]: "fabric" },
      deps: { createMemorySearchTool: adapters.createMemorySearchTool },
    });
    expect(result.invokedTool).toBe(false);
    expect(result.reason).toBe("fabric_path_requires_policy_check");
    expect(adapters.memoryExecute).not.toHaveBeenCalled();
  });

  it("fabric path DENY skips tool; ALLOW executes once", async () => {
    const denied = await invokeReadonlySurface({
      surface: "memory",
      query: "hello",
      actionId: "act-fabric-deny",
      env: { [ORCH_READONLY_PATH_PILOT_ENV]: "fabric" },
      deps: {
        createMemorySearchTool: adapters.createMemorySearchTool,
        policyCheck: async () => ({ decision: "DENY", reason: "shadow_deny" }),
      },
    });
    expect(denied.invokedTool).toBe(false);
    expect(denied.reason).toBe("shadow_deny");
    expect(adapters.memoryExecute).not.toHaveBeenCalled();

    const allowed = await invokeReadonlySurface({
      surface: "memory",
      query: "hello",
      actionId: "act-fabric-allow",
      env: { [ORCH_READONLY_PATH_PILOT_ENV]: "fabric" },
      deps: {
        createMemorySearchTool: adapters.createMemorySearchTool,
        policyCheck: async () => ({ decision: "ALLOW" }),
      },
    });
    expect(allowed.invokedTool).toBe(true);
    expect(allowed.pathBinding?.path).toBe("fabric");
    expect(adapters.memoryExecute).toHaveBeenCalledTimes(1);
  });

  it("fabric path MODIFY is refused (unsupported) and does not execute", async () => {
    const modified = await invokeReadonlySurface({
      surface: "memory",
      query: "hello",
      actionId: "act-fabric-modify",
      env: { [ORCH_READONLY_PATH_PILOT_ENV]: "fabric" },
      deps: {
        createMemorySearchTool: adapters.createMemorySearchTool,
        policyCheck: async () => ({ decision: "MODIFY", reason: "shadow_modify" }),
      },
    });
    expect(modified.invokedTool).toBe(false);
    expect(modified.reason).toBe("shadow_modify");
    expect(adapters.memoryExecute).not.toHaveBeenCalled();

    const modifiedDefaultReason = await invokeReadonlySurface({
      surface: "memory",
      query: "hello",
      actionId: "act-fabric-modify-default",
      env: { [ORCH_READONLY_PATH_PILOT_ENV]: "fabric" },
      deps: {
        createMemorySearchTool: adapters.createMemorySearchTool,
        policyCheck: async () => ({ decision: "MODIFY" }),
      },
    });
    expect(modifiedDefaultReason.invokedTool).toBe(false);
    expect(modifiedDefaultReason.reason).toBe("fabric_modify_unsupported");
    expect(adapters.memoryExecute).not.toHaveBeenCalled();
  });
});
