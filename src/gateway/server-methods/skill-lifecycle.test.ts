import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-skill-handler-${Date.now()}`);
vi.mock("../../utils.js", () => ({ CONFIG_DIR: tmpDir }));

const { skillLifecycleHandlers } = await import("./skill-lifecycle.js");

type HandlerResponse = {
  ok: boolean;
  payload?: unknown;
  error?: unknown;
};

async function invokeAsUser(
  method: string,
  params: Record<string, unknown>,
  userEmail: string,
): Promise<HandlerResponse> {
  const handler = skillLifecycleHandlers[method];
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
      user: userEmail,
    },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = { ok, payload, error };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error(`handler ${method} did not respond`);
  }
  return response;
}

async function invoke(method: string, params: Record<string, unknown>): Promise<HandlerResponse> {
  return invokeAsUser(method, params, "alice@example.com");
}

function cleanStore() {
  fs.rmSync(path.join(tmpDir, "skill-assets"), { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

describe("skill lifecycle gateway handlers", () => {
  beforeEach(cleanStore);

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saves, lists, and opens skill details through gateway methods", async () => {
    const saved = await invoke("skill-lifecycle.save", {
      sourceAgentId: "robot-alpha",
      lifecycle: "private",
      profile: {
        name: "Customer brief",
        summary: "Turns support threads into briefings.",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: {
        prompts: ["hidden prompt"],
        modelPreferences: { provider: "internal" },
      },
    });
    expect(saved.ok).toBe(true);
    const skillId = (saved.payload as { skillId: string }).skillId;

    const personal = await invoke("personal-skills.list", {});
    expect(personal.ok).toBe(true);
    expect((personal.payload as { skills: unknown[] }).skills).toHaveLength(1);

    const detail = await invoke("personal-skills.detail", { skillId });
    expect(detail.ok).toBe(true);
    expect(JSON.stringify(detail.payload)).not.toContain("hidden prompt");

    await invoke("robot-skills.install", { agentId: "robot-alpha", skillId });
    const robot = await invoke("robot-skills.list", { agentId: "robot-alpha" });
    expect(robot.ok).toBe(true);
    expect((robot.payload as { skills: unknown[] }).skills).toHaveLength(1);
  });

  it("lists personal skills only for the authenticated owner", async () => {
    const alice = await invokeAsUser(
      "skill-lifecycle.save",
      {
        sourceAgentId: "robot-alpha",
        profile: {
          name: "Alice brief",
          summary: "Alice only",
          assetType: "capability",
          visibility: "private",
        },
      },
      "alice@example.com",
    );
    const bob = await invokeAsUser(
      "skill-lifecycle.save",
      {
        sourceAgentId: "robot-beta",
        profile: {
          name: "Bob brief",
          summary: "Bob only",
          assetType: "capability",
          visibility: "private",
        },
      },
      "bob@example.com",
    );
    expect(alice.ok).toBe(true);
    expect(bob.ok).toBe(true);

    const aliceList = await invokeAsUser("personal-skills.list", {}, "alice@example.com");
    const bobList = await invokeAsUser("personal-skills.list", {}, "bob@example.com");
    expect(
      (aliceList.payload as { skills: Array<{ profile: { name: string } }> }).skills.map(
        (item) => item.profile.name,
      ),
    ).toEqual(["Alice brief"]);
    expect(
      (bobList.payload as { skills: Array<{ profile: { name: string } }> }).skills.map(
        (item) => item.profile.name,
      ),
    ).toEqual(["Bob brief"]);
  });

  it("rejects invalid create params before touching the store", async () => {
    const response = await invoke("skill-lifecycle.save", {
      sourceAgentId: "robot-alpha",
    });

    expect(response.ok).toBe(false);
    const list = await invoke("personal-skills.list", {});
    expect((list.payload as { skills: unknown[] }).skills).toEqual([]);
  });

  async function saveDraft(name = "Draft skill"): Promise<string> {
    const saved = await invoke("skill-lifecycle.save", {
      sourceAgentId: "robot-alpha",
      profile: { name, summary: "A draft.", assetType: "capability", visibility: "private" },
    });
    return (saved.payload as { skillId: string }).skillId;
  }

  async function saveRunnable(name = "Runnable skill"): Promise<string> {
    const saved = await invoke("skill-lifecycle.save", {
      sourceAgentId: "robot-alpha",
      lifecycle: "private",
      profile: {
        name,
        summary: "A reusable skill.",
        assetType: "capability",
        visibility: "private",
      },
    });
    return (saved.payload as { skillId: string }).skillId;
  }

  it("returns a dependency summary and graph for a saved skill (G4)", async () => {
    const skillId = await saveRunnable();
    const summary = await invoke("skill-dependency.summary", { skillId });
    expect(summary.ok).toBe(true);
    expect(summary.payload).toMatchObject({
      installedRobotCount: 1, // auto-installed on source robot
      hasAnyConsumer: true,
    });
    const graph = await invoke("skill-dependency.graph", { skillId });
    expect(graph.ok).toBe(true);
    expect((graph.payload as { installedRobots: unknown[] }).installedRobots).toHaveLength(1);
  });

  it("records a health sample and updates status (G1)", async () => {
    const skillId = await saveDraft();
    const failed = await invoke("skill-health.sample", {
      sample: { skillId, outcome: "failure", latencyMs: 1200, failureReason: "输入格式错误" },
    });
    expect(failed.ok).toBe(true);
    const repair = await invoke("skill-health.repair-suggestions", { skillId });
    expect(repair.ok).toBe(true);
    expect((repair.payload as { suggestions: string[] }).suggestions.length).toBeGreaterThan(0);
  });

  it("produces and fetches an autofill result, then accepts it (G2, G3)", async () => {
    const skillId = await saveDraft();
    const result = await invoke("skill-autofill.result", { skillId });
    expect(result.ok).toBe(true);
    const job = result.payload as { status: string; suggestion: Record<string, unknown> | null };
    expect(["succeeded", "empty"]).toContain(job.status);

    const accepted = await invoke("personal-skills.accept-autofill", {
      skillId,
      suggestion: { category: "客服", tags: ["自动化"] },
      acceptFields: ["category", "tags"],
    });
    expect(accepted.ok).toBe(true);
    const skill = (accepted.payload as { skill: { profile: { category: string } } }).skill;
    expect(skill.profile.category).toBe("客服");
  });

  it("finalizes a draft to private (G3)", async () => {
    const skillId = await saveDraft();
    const finalized = await invoke("personal-skills.finalize-draft", { skillId });
    expect(finalized.ok).toBe(true);
    expect((finalized.payload as { skill: { lifecycle: string } }).skill.lifecycle).toBe("private");

    // second finalize fails (no longer draft)
    const again = await invoke("personal-skills.finalize-draft", { skillId });
    expect(again.ok).toBe(false);
  });

  it("runs the enterprise review lifecycle (G5)", async () => {
    const skillId = await saveDraft();
    await invoke("personal-skills.finalize-draft", { skillId });

    const submitted = await invoke("skill-review.submit", {
      skillId,
      scope: { kind: "department", id: "d1", name: "客服部" },
    });
    expect(submitted.ok).toBe(true);
    expect((submitted.payload as { decision: unknown }).decision).toBeNull();
    const { listProposals } = await import("../capability-governance-store.js");
    expect(listProposals().some((proposal) => proposal.manifest.skillKey === skillId)).toBe(true);

    const record = await invoke("skill-review.record", { skillId });
    expect(record.ok).toBe(true);

    const blocked = await invoke("skill-review.publish", {
      skillId,
      scope: { kind: "enterprise" },
    });
    expect(blocked.ok).toBe(false);

    const { approveAndRegister, findProposalBySkillKey } =
      await import("../capability-governance-store.js");
    const proposal = findProposalBySkillKey(skillId);
    expect(proposal).toBeTruthy();
    expect(approveAndRegister(proposal!.proposalId, "enterprise-admin")).toBeTruthy();

    const published = await invoke("skill-review.publish", {
      skillId,
      scope: { kind: "enterprise" },
    });
    expect(published.ok).toBe(true);
    expect((published.payload as { skill: { lifecycle: string } }).skill.lifecycle).toBe(
      "published",
    );

    const deprecated = await invoke("skill-review.deprecate", { skillId });
    expect((deprecated.payload as { skill: { lifecycle: string } }).skill.lifecycle).toBe(
      "deprecated",
    );

    const retired = await invoke("skill-review.retire", { skillId });
    expect((retired.payload as { skill: { lifecycle: string } }).skill.lifecycle).toBe("retired");
  });

  it("recommends published skills not installed on the target robot (G5)", async () => {
    // skill saved + shared to a group becomes recommendable to other robots
    const skillId = await saveRunnable("Shareable skill");
    await invoke("personal-skills.share", { skillId, groupId: "group-1" });

    const recs = await invoke("skill-recommendations.list", { agentId: "robot-beta" });
    expect(recs.ok).toBe(true);
    const list = (recs.payload as { recommendations: Array<{ skillId: string }> }).recommendations;
    expect(list.some((r) => r.skillId === skillId)).toBe(true);

    // not recommended to the robot that already has it installed (source robot-alpha)
    const recsAlpha = await invoke("skill-recommendations.list", { agentId: "robot-alpha" });
    const listAlpha = (recsAlpha.payload as { recommendations: Array<{ skillId: string }> })
      .recommendations;
    expect(listAlpha.some((r) => r.skillId === skillId)).toBe(false);
  });

  it("suggests and accepts auto-classification (G5)", async () => {
    const skillId = await saveDraft("Unclassified");
    const suggestions = await invoke("skill-auto-classify.suggestions", {});
    expect(suggestions.ok).toBe(true);

    const accepted = await invoke("skill-auto-classify.accept", {
      skillId,
      acceptCategory: "运营",
      acceptTags: ["报表"],
    });
    expect(accepted.ok).toBe(true);
    expect(
      (accepted.payload as { skill: { profile: { category: string } } }).skill.profile.category,
    ).toBe("运营");
  });

  it("deletes a personal skill (G3)", async () => {
    const skillId = await saveDraft();
    const deleted = await invoke("personal-skills.delete", { skillId });
    expect(deleted.ok).toBe(true);
    const list = await invoke("personal-skills.list", {});
    expect((list.payload as { skills: unknown[] }).skills).toEqual([]);
  });
});
