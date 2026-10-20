// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpDir, workspaceRoot } = vi.hoisted(() => {
  const base = `/tmp/openbot-steward-backfill-${Math.random().toString(36).slice(2)}`;
  return { tmpDir: base, workspaceRoot: `${base}-ws` };
});

vi.mock("../../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

vi.mock("../../workspace-resolver/write-roots.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../workspace-resolver/write-roots.js")>();
  return {
    ...actual,
    resolveRobotWriteRoot: (params: { userId?: string | null }) => {
      const userId = params.userId?.trim();
      return userId ? path.join(workspaceRoot, userId) : null;
    },
  };
});

const { backfillEmployeeStewardWorkspaceDeliverables } =
  await import("./backfill-workspace-deliverables.js");
const { listWorkspaceDeliverables } = await import("./read-model.js");
const {
  getDeliverableArchiveKnowledgeBaseId,
  listDeliverableArchiveKnowledgeBaseIds,
  setDeliverableArchiveKnowledgeBaseId,
} = await import("./archive-store.js");
const { ensurePersonalDeliverablesKnowledgeBase, ensureTeamDeliverablesKnowledgeBase } =
  await import("../deliverable-folders.js");

function workspaceDir(userId: string): string {
  return path.join(workspaceRoot, userId);
}

function cleanAll() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
}

beforeEach(cleanAll);
afterEach(cleanAll);

describe("backfillEmployeeStewardWorkspaceDeliverables", () => {
  it("captures deliverable files from the workspace and skips non-deliverables", () => {
    const dir = workspaceDir("user-elle");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "Alice_爱丽_瑜伽老师简历.docx"), Buffer.from([0x50, 0x4b]));
    fs.writeFileSync(path.join(dir, "周报.md"), "# 周报\n\n本周完成 X、Y、Z。");
    fs.writeFileSync(path.join(dir, "封面.png"), Buffer.from([0x89, 0x50]));

    const result = backfillEmployeeStewardWorkspaceDeliverables({
      userId: "user-elle",
      force: true,
    });
    expect(result.scanned).toBe(2); // docx + md; png ignored
    expect(result.captured).toBe(2);
  });

  it("never captures steward scaffolding files (AGENTS.md/SOUL.md/IDENTITY.md/...) as 成果", () => {
    const dir = workspaceDir("user-elle");
    fs.mkdirSync(dir, { recursive: true });
    // Provisioned steward operating context — must be ignored.
    for (const name of [
      "AGENTS.md",
      "CLAUDE.md",
      "BOOTSTRAP.md",
      "HEARTBEAT.md",
      "IDENTITY.md",
      "SOUL.md",
      "TOOLS.md",
      "USER.md",
      "README.md",
    ]) {
      fs.writeFileSync(path.join(dir, name), `# ${name}\n\nscaffolding content`);
    }
    // A genuine deliverable alongside the scaffolding.
    fs.writeFileSync(path.join(dir, "简历.docx"), Buffer.from([0x50, 0x4b]));

    const result = backfillEmployeeStewardWorkspaceDeliverables({
      userId: "user-elle",
      force: true,
    });
    expect(result.scanned).toBe(1); // only 简历.docx; all scaffolding .md skipped
    expect(result.captured).toBe(1);
  });

  it("surfaces backfilled files owner-scoped with a file preview reference", async () => {
    const dir = workspaceDir("user-elle");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "Alice_爱丽_瑜伽老师简历.docx"), Buffer.from([0x50, 0x4b]));
    backfillEmployeeStewardWorkspaceDeliverables({ userId: "user-elle", force: true });

    const owner = await listWorkspaceDeliverables({
      userId: "user-elle",
      limit: 50,
      visibleAgentIds: [],
    });
    const item = owner.deliverables.find((entry) => entry.title === "Alice_爱丽_瑜伽老师简历.docx");
    expect(item).toBeTruthy();
    expect(item?.previewKind).toBe("file");
    expect(item?.artifactFilename).toBe("Alice_爱丽_瑜伽老师简历.docx");

    // A different user must not see it.
    const other = await listWorkspaceDeliverables({
      userId: "user-other",
      limit: 50,
      visibleAgentIds: [],
    });
    expect(other.deliverables.some((entry) => entry.title === "Alice_爱丽_瑜伽老师简历.docx")).toBe(
      false,
    );
  });

  it("is idempotent on repeated runs (force) and marker-guarded without force", () => {
    const dir = workspaceDir("user-elle");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "周报.md"), "# 周报\n\n本周完成 X、Y、Z。");

    const first = backfillEmployeeStewardWorkspaceDeliverables({
      userId: "user-elle",
      force: true,
    });
    expect(first.captured).toBe(1);

    // Re-run with force: file already in the capture ledger => captured 0.
    const second = backfillEmployeeStewardWorkspaceDeliverables({
      userId: "user-elle",
      force: true,
    });
    expect(second.captured).toBe(0);

    // Without force after the marker is written: no rescan at all.
    const third = backfillEmployeeStewardWorkspaceDeliverables({ userId: "user-elle" });
    expect(third.scanned).toBe(0);
  });

  it("no-ops (and marks done) when the workspace does not exist", () => {
    const result = backfillEmployeeStewardWorkspaceDeliverables({ userId: "ghost-user" });
    expect(result).toEqual({ scanned: 0, captured: 0 });
    // Subsequent call is still a no-op via the marker.
    const again = backfillEmployeeStewardWorkspaceDeliverables({ userId: "ghost-user" });
    expect(again).toEqual({ scanned: 0, captured: 0 });
  });

  it("does not archive staged workspace files into reserved deliverable folders", async () => {
    const dir = workspaceDir("user-elle");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "暂存周报.md"),
      "# 周报\n\n仅捕获到暂存层，不得自动写入固定成果库。",
    );
    const personal = ensurePersonalDeliverablesKnowledgeBase({ ownerId: "user-elle" });
    const team = ensureTeamDeliverablesKnowledgeBase({ ownerId: "user-elle" });

    backfillEmployeeStewardWorkspaceDeliverables({ userId: "user-elle", force: true });

    expect(listDeliverableArchiveKnowledgeBaseIds()).toEqual({});
    expect(personal.documentIds).toEqual([]);
    expect(team.documentIds).toEqual([]);
    const { deliverables } = await listWorkspaceDeliverables({
      userId: "user-elle",
      limit: 50,
      visibleAgentIds: [],
    });
    expect(deliverables.some((item) => item.relatedKnowledgeBaseId)).toBe(false);
  });

  it("preserves explicit archive mappings and does not cross-home personal vs team", async () => {
    const dir = workspaceDir("user-elle");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "个人方案.md"), "# 个人方案\n\n已明确保存到个人成果。");
    fs.writeFileSync(path.join(dir, "小组方案.md"), "# 小组方案\n\n已明确保存到团队成果。");
    const personal = ensurePersonalDeliverablesKnowledgeBase({ ownerId: "user-elle" });
    const team = ensureTeamDeliverablesKnowledgeBase({ ownerId: "user-elle" });

    backfillEmployeeStewardWorkspaceDeliverables({ userId: "user-elle", force: true });
    const { deliverables } = await listWorkspaceDeliverables({
      userId: "user-elle",
      limit: 50,
      visibleAgentIds: [],
    });
    const personalItem = deliverables.find((item) => item.title === "个人方案.md");
    const teamItem = deliverables.find((item) => item.title === "小组方案.md");
    expect(personalItem?.deliverableId).toBeTruthy();
    expect(teamItem?.deliverableId).toBeTruthy();

    setDeliverableArchiveKnowledgeBaseId({
      deliverableId: personalItem?.deliverableId ?? "",
      knowledgeBaseId: personal.id,
    });
    setDeliverableArchiveKnowledgeBaseId({
      deliverableId: teamItem?.deliverableId ?? "",
      knowledgeBaseId: team.id,
    });

    backfillEmployeeStewardWorkspaceDeliverables({ userId: "user-elle", force: true });

    expect(getDeliverableArchiveKnowledgeBaseId(personalItem?.deliverableId ?? "")).toBe(
      personal.id,
    );
    expect(getDeliverableArchiveKnowledgeBaseId(teamItem?.deliverableId ?? "")).toBe(team.id);
    expect(getDeliverableArchiveKnowledgeBaseId(personalItem?.deliverableId ?? "")).not.toBe(
      team.id,
    );
  });
});
