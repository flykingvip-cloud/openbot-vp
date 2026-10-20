import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-skill-slice-${process.pid}-${Date.now()}`);
vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const { skillLifecycleHandlers } = await import("./skill-lifecycle.js");
const { employeeInstallHandlers } = await import("./employee-install.js");
const { resolveEmbeddedRunSkillEntries } =
  await import("../../agents/pi-embedded-runner/skills-runtime.js");
const {
  ensureSkillExecutionBindingHooksRegistered,
  resetSkillExecutionBindingHooksForTests,
  skillExecutionSkillName,
} = await import("../skill-execution-binding/index.js");

type HandlerResponse = {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: unknown;
};

async function invokeHandler(
  handlers: Record<string, (opts: GatewayRequestHandlerOptions) => Promise<void> | void>,
  method: string,
  params: Record<string, unknown>,
  user: string | null,
): Promise<HandlerResponse> {
  const handler = handlers[method];
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: HandlerResponse | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: {
      connect: {
        minProtocol: 1,
        maxProtocol: 1,
        client: {
          id: "openbot-control-ui",
          version: "2026.3.9",
          platform: "macos",
          mode: "control-ui",
        },
      } as never,
      user,
    } as GatewayRequestHandlerOptions["client"],
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = {
        ok,
        payload:
          payload && typeof payload === "object" ? (payload as Record<string, unknown>) : undefined,
        error,
      };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error(`handler ${method} did not respond`);
  }
  return response;
}

function nextLoaderSkills(agentId: string): Array<{ name: string; source?: string }> {
  const workspaceDir = path.join(tmpDir, "workspace");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const loaded = resolveEmbeddedRunSkillEntries({ workspaceDir, agentId });
  return loaded.skillEntries.map((entry) => {
    const skill = entry.skill as {
      name: string;
      source?: string;
      sourceInfo?: { source?: string };
    };
    return {
      name: skill.name,
      source: skill.sourceInfo?.source ?? skill.source,
    };
  });
}

async function saveSkill(params: {
  agentId: string;
  name: string;
  lifecycle?: string;
  assetType?: string;
}): Promise<string> {
  const saved = await invokeHandler(
    skillLifecycleHandlers,
    "skill-lifecycle.save",
    {
      sourceAgentId: params.agentId,
      lifecycle: params.lifecycle,
      profile: {
        name: params.name,
        summary: "Vertical slice skill",
        assetType: params.assetType ?? "capability",
        visibility: "private",
      },
    },
    "alice@example.com",
  );
  expect(saved.ok).toBe(true);
  const skillId = saved.payload?.skillId;
  expect(typeof skillId).toBe("string");
  return skillId as string;
}

describe("employee skill lifecycle vertical slice", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    resetSkillExecutionBindingHooksForTests();
    ensureSkillExecutionBindingHooksRegistered();
  });

  afterEach(() => {
    resetSkillExecutionBindingHooksForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not show a non-executable projection on the next loader", async () => {
    const agentId = "robot-slice-draft";
    const skillId = await saveSkill({
      agentId,
      name: "Draft only",
      lifecycle: "draft",
    });

    const installed = await invokeHandler(
      skillLifecycleHandlers,
      "robot-skills.install",
      { agentId, skillId },
      null,
    );
    expect(installed.ok).toBe(true);
    const projection = installed.payload?.projection as { action?: string; reason?: string };
    expect(projection?.action).toBe("removed");
    expect(projection?.reason).toBe("non-executable-lifecycle");
    expect(installed.payload?.relation).toEqual({ state: "linked" });
    expect(installed.payload?.runtimeBinding).toMatchObject({
      role: "not_required",
      synced: false,
      reason: "missing-user",
    });

    const seen = nextLoaderSkills(agentId);
    expect(seen.map((entry) => entry.name)).not.toContain(skillExecutionSkillName(skillId));
  });

  it("shows a materialised lifecycle skill on the next loader", async () => {
    const agentId = "robot-slice-live";
    const skillId = await saveSkill({
      agentId,
      name: "Runnable brief",
      lifecycle: "private",
    });
    const expectedName = skillExecutionSkillName(skillId);
    expect(expectedName).toBe(`ob-asset-${skillId}`);

    const installed = await invokeHandler(
      skillLifecycleHandlers,
      "robot-skills.install",
      { agentId, skillId },
      "alice@example.com",
    );
    expect(installed.ok).toBe(true);
    expect(installed.payload?.skill).toBeTruthy();
    expect(installed.payload?.relation).toEqual({ state: "linked" });
    expect(installed.payload?.projection).toMatchObject({
      action: "materialised",
      state: "ready",
      skillName: expectedName,
    });
    const runtimeBinding = installed.payload?.runtimeBinding as {
      role?: string;
      synced?: boolean;
      reason?: string;
    };
    expect(runtimeBinding?.role).toBe("auxiliary");
    expect(runtimeBinding?.synced).toBe(false);
    expect(runtimeBinding?.reason).toBeTruthy();

    const seen = nextLoaderSkills(agentId);
    expect(seen).toContainEqual({
      name: expectedName,
      source: "openbot-lifecycle-binding",
    });
  });

  it("drops the skill from the next loader after remove", async () => {
    const agentId = "robot-slice-remove";
    const skillId = await saveSkill({
      agentId,
      name: "Removable brief",
      lifecycle: "private",
    });
    const expectedName = skillExecutionSkillName(skillId);
    await invokeHandler(skillLifecycleHandlers, "robot-skills.install", { agentId, skillId }, null);
    expect(nextLoaderSkills(agentId).map((entry) => entry.name)).toContain(expectedName);

    const removed = await invokeHandler(
      skillLifecycleHandlers,
      "robot-skills.remove",
      { agentId, skillId },
      null,
    );
    expect(removed.ok).toBe(true);
    expect(removed.payload?.ok).toBe(true);
    expect(removed.payload?.relation).toEqual({ state: "absent" });
    expect(removed.payload?.projection).toMatchObject({
      action: "removed",
      state: "absent",
    });
    expect(removed.payload?.runtimeBinding).toMatchObject({ state: "not_reviewed" });

    expect(nextLoaderSkills(agentId).map((entry) => entry.name)).not.toContain(expectedName);
  });

  it("does not treat employee-install installed as executable when binding is not synced", async () => {
    const agentId = "robot-slice-employee";
    const capabilityId = "cap-slice-unsynced";
    const created = await invokeHandler(
      employeeInstallHandlers,
      "employee-install.create-request",
      {
        targetRobotId: agentId,
        capabilityId,
        source: "platform-marketplace",
      },
      "",
    );
    expect(created.ok).toBe(true);
    const requestId = created.payload?.requestId;
    expect(typeof requestId).toBe("string");

    const confirmed = await invokeHandler(
      employeeInstallHandlers,
      "employee-install.confirm",
      { requestId },
      "",
    );
    expect(confirmed.ok).toBe(true);
    expect(confirmed.payload?.status).toBe("installed");
    expect(confirmed.payload?.executable).toBe(false);
    expect(confirmed.payload?.availability).toBe("failed");
    expect(confirmed.payload?.projection).toEqual({ state: "not_materialized" });
    expect(confirmed.payload?.relation).toMatchObject({
      state: "requested",
      requestStatus: "installed",
    });
    expect(confirmed.payload?.runtimeBinding).toMatchObject({
      role: "required",
      synced: false,
      reason: "missing-user",
    });
    expect(confirmed.payload?.nextStep).not.toBe("done");

    expect(nextLoaderSkills(agentId).map((entry) => entry.name)).not.toContain(
      skillExecutionSkillName(capabilityId),
    );
  });
});
