// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpDir } = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-deliverable-capture-${Math.random().toString(36).slice(2)}`,
}));

vi.mock("../../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const { captureAgentOutputDeliverable } = await import("./auto-capture-runtime.js");
const { getPersonalSkillAssetDetail } = await import("../../skill-lifecycle-store.js");
const { listWorkspaceDeliverables } = await import("./read-model.js");
const { listDeliverableArchiveKnowledgeBaseIds } = await import("./archive-store.js");
const { ensurePersonalDeliverablesKnowledgeBase, ensureTeamDeliverablesKnowledgeBase } =
  await import("../deliverable-folders.js");

const LONG_OUTPUT =
  "本周复盘结论：企业版定价需要新增 SSO 单点登录与自动对账能力，预计可提升老客户续费率约 12%，并显著降低人工对账成本。" +
  "建议在下一个迭代中优先落地，由产品同步给销售团队与客户成功团队，并在上线前完成完整回归测试与灰度验证。";

function cleanStore() {
  fs.rmSync(path.join(tmpDir, "skill-assets"), { recursive: true, force: true });
  fs.rmSync(path.join(tmpDir, "knowledge"), { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

describe("deliverable auto-capture runtime", () => {
  beforeEach(() => {
    cleanStore();
  });

  afterEach(() => {
    cleanStore();
  });

  it("captures a high-value agent output as a deliverable and surfaces it in 成果中心", async () => {
    const result = captureAgentOutputDeliverable({
      ownerId: "user-a",
      agentId: "sales-bot",
      title: "Q2 复盘结论",
      content: LONG_OUTPUT,
      sessionKey: "sess-1",
      messageId: "msg-1",
    });
    expect(result.captured).toBe(true);
    expect(result.reason).toBe("captured");
    expect(result.skillId).toBeTruthy();
    expect(result.deliverableId).toBe(`skill:${result.skillId}`);

    // Persisted as a skill asset flagged as a captured deliverable.
    const detail = getPersonalSkillAssetDetail(result.skillId ?? "");
    expect(detail.profile.name).toBe("Q2 复盘结论");
    expect(detail.profile.category).toBe("对话成果");
    expect(detail.ownerUserId).toBe("user-a");

    // Appears in the deliverables read-model (成果中心) as an agent deliverable.
    const { deliverables } = await listWorkspaceDeliverables({ userId: "user-a", limit: 50 });
    expect(deliverables.some((item) => item.deliverableId === `skill:${result.skillId}`)).toBe(
      true,
    );
  });

  it("is idempotent for the same session + message", async () => {
    const first = captureAgentOutputDeliverable({
      ownerId: "user-a",
      agentId: "sales-bot",
      title: "结论",
      content: LONG_OUTPUT,
      sessionKey: "sess-1",
      messageId: "msg-1",
    });
    expect(first.captured).toBe(true);

    const second = captureAgentOutputDeliverable({
      ownerId: "user-a",
      agentId: "sales-bot",
      title: "结论",
      content: LONG_OUTPUT,
      sessionKey: "sess-1",
      messageId: "msg-1",
    });
    expect(second.captured).toBe(false);
    expect(second.reason).toBe("duplicate");
    expect(second.skillId).toBe(first.skillId);

    const { deliverables } = await listWorkspaceDeliverables({ userId: "user-a", limit: 50 });
    const captured = deliverables.filter((item) => item.deliverableId === `skill:${first.skillId}`);
    expect(captured).toHaveLength(1);
  });

  it("skips low-value short outputs unless forced", async () => {
    const skipped = captureAgentOutputDeliverable({
      ownerId: "user-a",
      agentId: "sales-bot",
      title: "ok",
      content: "好的",
    });
    expect(skipped.captured).toBe(false);
    expect(skipped.reason).toBe("too-short");

    const forced = captureAgentOutputDeliverable({
      ownerId: "user-a",
      agentId: "sales-bot",
      title: "短成果",
      content: "好的",
      force: true,
    });
    expect(forced.captured).toBe(true);
  });

  it("rejects empty content", () => {
    const result = captureAgentOutputDeliverable({
      ownerId: "user-a",
      agentId: "sales-bot",
      title: "x",
      content: "   ",
    });
    expect(result.captured).toBe(false);
    expect(result.reason).toBe("empty");
  });

  it("folds file revisions into one latest-version entry (same filename, different messages)", async () => {
    const v1 = captureAgentOutputDeliverable({
      ownerId: "user-a",
      agentId: "sales-bot",
      title: "季度报告",
      content: `${LONG_OUTPUT} 版本一`,
      sessionKey: "sess-1",
      messageId: "msg-1",
      contextId: "sess-1",
      force: true,
      deliverableArtifact: { previewKind: "file", filename: "报告.docx" },
    });
    expect(v1.reason).toBe("captured");

    const v2 = captureAgentOutputDeliverable({
      ownerId: "user-a",
      agentId: "sales-bot",
      title: "季度报告（终稿）",
      content: `${LONG_OUTPUT} 版本二 最终`,
      sessionKey: "sess-1",
      messageId: "msg-2", // a later, different message = a revision
      contextId: "sess-1",
      force: true,
      deliverableArtifact: { previewKind: "file", filename: "报告.docx" }, // same logical file
    });
    expect(v2.reason).toBe("updated");
    expect(v2.skillId).toBe(v1.skillId);

    // 成果中心 shows exactly ONE entry, carrying the latest title + content.
    const { deliverables } = await listWorkspaceDeliverables({ userId: "user-a", limit: 50 });
    expect(
      deliverables.filter((item) => item.deliverableId === `skill:${v1.skillId}`),
    ).toHaveLength(1);
    const detail = getPersonalSkillAssetDetail(v1.skillId ?? "");
    expect(detail.profile.name).toBe("季度报告（终稿）");
    expect(detail.profile.outputDescription).toContain("版本二 最终");
  });

  it("folds revisions matched by title when no artifact is declared", async () => {
    const v1 = captureAgentOutputDeliverable({
      ownerId: "user-a",
      agentId: "sales-bot",
      title: "市场周报",
      content: `${LONG_OUTPUT} A`,
      sessionKey: "sess-1",
      messageId: "m-a",
      contextId: "sess-1",
    });
    const v2 = captureAgentOutputDeliverable({
      ownerId: "user-a",
      agentId: "sales-bot",
      title: "市场周报",
      content: `${LONG_OUTPUT} B`,
      sessionKey: "sess-1",
      messageId: "m-b",
      contextId: "sess-1",
    });
    expect(v1.reason).toBe("captured");
    expect(v2.reason).toBe("updated");
    expect(v2.skillId).toBe(v1.skillId);
  });

  it("does NOT fold different owners' same-named files (lineage-scoped identity)", () => {
    const a = captureAgentOutputDeliverable({
      agentId: "main",
      title: "简历",
      content: `${LONG_OUTPUT} A`,
      contextId: "agent:main:employee:user-a",
      force: true,
      deliverableArtifact: { previewKind: "file", filename: "简历.docx" },
    });
    const b = captureAgentOutputDeliverable({
      agentId: "main",
      title: "简历",
      content: `${LONG_OUTPUT} B`,
      contextId: "agent:main:employee:user-b",
      force: true,
      deliverableArtifact: { previewKind: "file", filename: "简历.docx" },
    });
    expect(a.reason).toBe("captured");
    expect(b.reason).toBe("captured"); // different lineage => separate deliverable
    expect(b.skillId).not.toBe(a.skillId);
  });

  it("folds collaboration revisions by groupId + logicalId", () => {
    const v1 = captureAgentOutputDeliverable({
      ownerId: "user-a",
      agentId: "market-bot",
      groupId: "grp-alpha",
      logicalId: "weekly-brief",
      title: "市场周报 v1",
      content: `${LONG_OUTPUT} 第一版`,
      sessionKey: "space:alpha",
      messageId: "m-1",
      force: true,
    });
    const v2 = captureAgentOutputDeliverable({
      ownerId: "user-a",
      agentId: "sales-bot",
      groupId: "grp-alpha",
      logicalId: "weekly-brief",
      title: "市场周报 v2",
      content: `${LONG_OUTPUT} 第二版`,
      sessionKey: "space:alpha",
      messageId: "m-2",
      force: true,
    });
    expect(v1.reason).toBe("captured");
    expect(v2.reason).toBe("updated");
    expect(v2.skillId).toBe(v1.skillId);
  });

  it("never attaches a captured draft to 个人成果 or 团队成果", async () => {
    const personal = ensurePersonalDeliverablesKnowledgeBase({ ownerId: "user-a" });
    const team = ensureTeamDeliverablesKnowledgeBase({ ownerId: "user-a" });
    const result = captureAgentOutputDeliverable({
      ownerId: "user-a",
      agentId: "sales-bot",
      title: "暂存结论",
      content: LONG_OUTPUT,
      sessionKey: "sess-draft",
      messageId: "msg-draft",
    });
    expect(result.captured).toBe(true);
    expect(listDeliverableArchiveKnowledgeBaseIds()).toEqual({});
    expect(personal.documentIds).toEqual([]);
    expect(team.documentIds).toEqual([]);

    const { deliverables } = await listWorkspaceDeliverables({ userId: "user-a", limit: 50 });
    const captured = deliverables.find((item) => item.deliverableId === `skill:${result.skillId}`);
    expect(captured).toBeTruthy();
    expect(captured?.relatedKnowledgeBaseId).toBeUndefined();
  });
});
