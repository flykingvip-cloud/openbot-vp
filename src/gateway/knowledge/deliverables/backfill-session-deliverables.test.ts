// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpDir, sessionsRoot } = vi.hoisted(() => {
  const base = `/tmp/openbot-steward-session-backfill-${Math.random().toString(36).slice(2)}`;
  return { tmpDir: base, sessionsRoot: `${base}-sessions` };
});

vi.mock("../../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const { backfillStewardSessionDeliverables } = await import("./backfill-session-deliverables.js");
const { listWorkspaceDeliverables } = await import("./read-model.js");
const {
  getDeliverableArchiveKnowledgeBaseId,
  listDeliverableArchiveKnowledgeBaseIds,
  setDeliverableArchiveKnowledgeBaseId,
} = await import("./archive-store.js");
const { ensurePersonalDeliverablesKnowledgeBase, ensureTeamDeliverablesKnowledgeBase } =
  await import("../deliverable-folders.js");

const OWNER_CWD = "/tmp/state/agents/main/employees/user-elle/workspace";
const FOREIGN_CWD = "/tmp/state/agents/main/employees/user-other/workspace";

function messageLine(role: string, text: string): string {
  return JSON.stringify({ type: "message", message: { role, content: [{ type: "text", text }] } });
}

function writeTranscript(name: string, cwd: string, assistantTexts: string[]): void {
  const lines = [
    JSON.stringify({ type: "session", version: 1, id: name, timestamp: Date.now(), cwd }),
    messageLine("user", "帮我整理一下"),
    ...assistantTexts.map((text) => messageLine("assistant", text)),
  ];
  fs.writeFileSync(path.join(sessionsRoot, `${name}.jsonl`), `${lines.join("\n")}\n`);
}

function declaration(title: string, file: string, body: string): string {
  return `已生成好了。\n<<DELIVERABLE title="${title}" type="doc" file="${file}">>\n${body}\n<</DELIVERABLE>>`;
}

function cleanAll() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(sessionsRoot, { recursive: true, force: true });
  fs.mkdirSync(sessionsRoot, { recursive: true });
}

beforeEach(cleanAll);
afterEach(cleanAll);

describe("backfillStewardSessionDeliverables", () => {
  it("captures a declared deliverable from the caller's own steward transcript", async () => {
    writeTranscript("s-own", OWNER_CWD, [
      declaration(
        "Alice简历",
        "Alice简历.docx",
        "优化了头部设计、结构重组为五大板块、深蓝主色调排版。",
      ),
    ]);

    const result = backfillStewardSessionDeliverables({
      userId: "user-elle",
      sessionsDir: sessionsRoot,
      expectedCwd: OWNER_CWD,
      force: true,
    });
    expect(result.scannedSessions).toBe(1);
    expect(result.captured).toBe(1);

    const { deliverables } = await listWorkspaceDeliverables({
      userId: "user-elle",
      limit: 50,
      visibleAgentIds: [],
    });
    const item = deliverables.find((entry) => entry.title === "Alice简历");
    expect(item?.previewKind).toBe("file");
    expect(item?.artifactFilename).toBe("Alice简历.docx");
  });

  it("skips transcripts owned by a different employee (owner filter via cwd)", () => {
    writeTranscript("s-foreign", FOREIGN_CWD, [
      declaration(
        "别人的简历",
        "别人.docx",
        "这是另一个员工的成果正文，内容足够长以通过长度门槛。",
      ),
    ]);

    const result = backfillStewardSessionDeliverables({
      userId: "user-elle",
      sessionsDir: sessionsRoot,
      expectedCwd: OWNER_CWD,
      force: true,
    });
    expect(result.scannedSessions).toBe(0);
    expect(result.captured).toBe(0);
  });

  it("ignores the heuristic quote form and only honors explicit tag declarations", () => {
    writeTranscript("s-quote", OWNER_CWD, [
      `帮你记一下：\n「${"这是一段被引号包裹的普通对话内容，不应被当作声明式成果收录进来。".repeat(2)}」`,
    ]);
    const result = backfillStewardSessionDeliverables({
      userId: "user-elle",
      sessionsDir: sessionsRoot,
      expectedCwd: OWNER_CWD,
      force: true,
    });
    expect(result.captured).toBe(0);
  });

  it("folds multiple revisions of the same file into one final entry", async () => {
    writeTranscript("s-rev", OWNER_CWD, [
      declaration("季度报告", "报告.docx", "第一版内容，初稿，字数足够多以形成正文。"),
      declaration("季度报告（终稿）", "报告.docx", "第二版内容，终稿，已根据反馈完善所有章节。"),
    ]);
    backfillStewardSessionDeliverables({
      userId: "user-elle",
      sessionsDir: sessionsRoot,
      expectedCwd: OWNER_CWD,
      force: true,
    });
    const { deliverables } = await listWorkspaceDeliverables({
      userId: "user-elle",
      limit: 50,
      visibleAgentIds: [],
    });
    const forFile = deliverables.filter((entry) => entry.artifactFilename === "报告.docx");
    expect(forFile).toHaveLength(1);
    expect(forFile[0]?.title).toBe("季度报告（终稿）");
  });

  it("is idempotent on repeated forced runs and marker-guarded without force", () => {
    writeTranscript("s-idem", OWNER_CWD, [
      declaration("周报", "周报.docx", "本周完成了 X、Y、Z，进展顺利，下周计划推进 A、B。"),
    ]);
    const first = backfillStewardSessionDeliverables({
      userId: "user-elle",
      sessionsDir: sessionsRoot,
      expectedCwd: OWNER_CWD,
      force: true,
    });
    expect(first.captured).toBe(1);

    // Re-run (force): same transcript line key already in the ledger => nothing new.
    const second = backfillStewardSessionDeliverables({
      userId: "user-elle",
      sessionsDir: sessionsRoot,
      expectedCwd: OWNER_CWD,
      force: true,
    });
    expect(second.captured).toBe(0);

    // Without force after the marker is written: no rescan.
    const third = backfillStewardSessionDeliverables({
      userId: "user-elle",
      sessionsDir: sessionsRoot,
      expectedCwd: OWNER_CWD,
    });
    expect(third.scannedSessions).toBe(0);
  });

  it("does not treat staging captures as archived reserved-folder documents", async () => {
    writeTranscript("s-staging", OWNER_CWD, [
      declaration(
        "暂存周报",
        "暂存周报.docx",
        "这是一份仅被捕获到 skill 暂存层的历史成果，不应自动入库。",
      ),
    ]);
    const personal = ensurePersonalDeliverablesKnowledgeBase({ ownerId: "user-elle" });
    const team = ensureTeamDeliverablesKnowledgeBase({ ownerId: "user-elle" });

    backfillStewardSessionDeliverables({
      userId: "user-elle",
      sessionsDir: sessionsRoot,
      expectedCwd: OWNER_CWD,
      force: true,
    });

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

  it("preserves an explicit archive mapping and does not cross-home personal vs team", async () => {
    writeTranscript("s-archived", OWNER_CWD, [
      declaration(
        "个人方案",
        "个人方案.docx",
        "这份成果已经由用户明确保存到个人成果，回填不得改写归属。",
      ),
      declaration(
        "小组方案",
        "小组方案.docx",
        "这份成果已经由用户明确保存到团队成果，回填不得交叉归位。",
      ),
    ]);
    const personal = ensurePersonalDeliverablesKnowledgeBase({ ownerId: "user-elle" });
    const team = ensureTeamDeliverablesKnowledgeBase({ ownerId: "user-elle" });

    backfillStewardSessionDeliverables({
      userId: "user-elle",
      sessionsDir: sessionsRoot,
      expectedCwd: OWNER_CWD,
      force: true,
    });
    const { deliverables } = await listWorkspaceDeliverables({
      userId: "user-elle",
      limit: 50,
      visibleAgentIds: [],
    });
    const personalItem = deliverables.find((item) => item.title === "个人方案");
    const teamItem = deliverables.find((item) => item.title === "小组方案");
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

    backfillStewardSessionDeliverables({
      userId: "user-elle",
      sessionsDir: sessionsRoot,
      expectedCwd: OWNER_CWD,
      force: true,
    });

    expect(getDeliverableArchiveKnowledgeBaseId(personalItem?.deliverableId ?? "")).toBe(
      personal.id,
    );
    expect(getDeliverableArchiveKnowledgeBaseId(teamItem?.deliverableId ?? "")).toBe(team.id);
    expect(getDeliverableArchiveKnowledgeBaseId(personalItem?.deliverableId ?? "")).not.toBe(
      team.id,
    );
    expect(getDeliverableArchiveKnowledgeBaseId(teamItem?.deliverableId ?? "")).not.toBe(
      personal.id,
    );
  });
});
