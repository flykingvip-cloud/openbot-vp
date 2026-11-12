// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpDir } = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-save-archive-${Math.random().toString(36).slice(2)}`,
}));

const collabRoot = path.join(tmpDir, "collab-root");
const cfg = { collaboration: { defaults: { workspace: collabRoot } } };

vi.mock("../../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

vi.mock("../../../config/config.js", () => ({
  loadConfig: () => cfg,
}));

vi.mock("./attach.js", () => ({
  attachWorkspaceDeliverableToKnowledgeBase: vi.fn(
    async (params: {
      deliverableId: string;
      knowledgeBaseId: string;
      documentId?: string | null;
    }) => {
      const { setDeliverableArchiveKnowledgeBaseId } = await import("./archive-store.js");
      setDeliverableArchiveKnowledgeBaseId({
        deliverableId: params.deliverableId,
        knowledgeBaseId: params.knowledgeBaseId,
      });
      return {
        relatedKnowledgeBaseId: params.knowledgeBaseId,
        knowledgeBase: { id: params.knowledgeBaseId, title: "archived" },
        documentId: params.documentId?.trim() || "doc-1",
        ingest: { ok: true },
      };
    },
  ),
}));

vi.mock("./purge-prior-versions.js", () => ({
  purgePriorKnowledgeDocumentVersions: vi.fn(async () => ({
    keptVersionId: "v-kept",
    purgedVersionIds: ["v-old"],
    purgedChunkIds: ["chunk-old"],
  })),
}));

vi.mock("../../workspace/handler-bridge.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../workspace/handler-bridge.js")>();
  const fs = await import("node:fs");
  return {
    ...actual,
    resolveTrustedAgentLocator: vi.fn(async () => path.join(tmpDir, "personal-ws")),
    authorizeAgentWorkspaceFileAccess: vi.fn(async (params: { relativePath: string }) => {
      const absoluteFilePath = path.join(tmpDir, "personal-ws", params.relativePath);
      if (!fs.existsSync(path.dirname(absoluteFilePath))) {
        return { ok: false, message: "workspace file not found" };
      }
      return {
        ok: true,
        absoluteFilePath,
        access: { baseReal: path.join(tmpDir, "personal-ws") },
      };
    }),
  };
});

const {
  saveAndArchiveWorkspaceDeliverable,
  resolveSaveArchiveDeliverableId,
  isPreviewArtifactDeliverableId,
} = await import("./save-and-archive.js");
const { readGroupDeliverableManifest } = await import("./group-manifest.js");
const { resolveGroupCollaborationPaths } =
  await import("../../collaboration-learning/collaboration-paths.js");
const { attachWorkspaceDeliverableToKnowledgeBase } = await import("./attach.js");
const { purgePriorKnowledgeDocumentVersions } = await import("./purge-prior-versions.js");
const {
  getDeliverableArchiveKnowledgeBaseId,
  getDeliverableArchiveRecord,
  listDeliverableArchiveKnowledgeBaseIds,
} = await import("./archive-store.js");
const { SaveDecisionRequiredError, SaveConflictStaleError } = await import("./save-decision.js");
const { ensurePersonalDeliverablesKnowledgeBase, ensureTeamDeliverablesKnowledgeBase } =
  await import("../deliverable-folders.js");

function writeGroupAclFixture(groupId: string, userId: string): string {
  const locator = path.join(collabRoot, "groups", encodeURIComponent(groupId));
  fs.mkdirSync(locator, { recursive: true });
  fs.writeFileSync(
    path.join(locator, "members.json"),
    `${JSON.stringify(
      [
        {
          memberId: `m-${userId}`,
          userId,
          name: userId,
          status: "active",
          memberKind: "human",
          governanceRole: "owner",
          updatedAtMs: 1,
        },
      ],
      null,
      2,
    )}\n`,
  );
  return locator;
}

function cleanStore() {
  fs.rmSync(path.join(tmpDir, "skill-assets"), { recursive: true, force: true });
  fs.rmSync(path.join(tmpDir, "knowledge"), { recursive: true, force: true });
  fs.rmSync(path.join(tmpDir, "tenants"), { recursive: true, force: true });
  fs.rmSync(path.join(tmpDir, "personal-ws"), { recursive: true, force: true });
  fs.rmSync(collabRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

describe("saveAndArchiveWorkspaceDeliverable", () => {
  beforeEach(() => {
    cleanStore();
    vi.mocked(attachWorkspaceDeliverableToKnowledgeBase).mockClear();
    vi.mocked(purgePriorKnowledgeDocumentVersions).mockClear();
  });

  afterEach(() => {
    cleanStore();
  });

  it("writes group workspace file, captures deliverable, attaches to KB, and pins manifest", async () => {
    const groupId = "grp-save";
    writeGroupAclFixture(groupId, "user-a");
    const team = ensureTeamDeliverablesKnowledgeBase({ ownerId: "user-a" });
    const content =
      "本周复盘结论：企业版定价需要新增 SSO 单点登录与自动对账能力，预计可提升老客户续费率约 12%。" +
      "建议在下一个迭代中优先落地，由产品同步给销售团队与客户成功团队。";

    const result = await saveAndArchiveWorkspaceDeliverable({
      userId: "user-a",
      sessionKey: "space:grp-save",
      knowledgeBaseId: team.id,
      title: "市场周报",
      content,
      groupId,
      logicalId: "weekly-brief",
    });

    expect(result.knowledgeBaseId).toBe(team.id);
    expect(result.logicalId).toBe("weekly-brief");
    expect(result.relativePath).toBe("deliverables/weekly-brief.md");
    expect(attachWorkspaceDeliverableToKnowledgeBase).toHaveBeenCalledTimes(1);
    expect(vi.mocked(attachWorkspaceDeliverableToKnowledgeBase).mock.calls[0]?.[0]).toMatchObject({
      knowledgeBaseId: team.id,
      deliverableId: result.deliverableId,
      deferEmbedding: true,
    });
    expect(
      fs.readFileSync(
        path.join(tmpDir, "knowledge", "folders", "team-deliverables", "weekly-brief.md"),
        "utf8",
      ),
    ).toBe(content);

    const paths = resolveGroupCollaborationPaths(groupId, cfg);
    const savedFile = path.join(paths.workspacePath, "deliverables/weekly-brief.md");
    expect(fs.readFileSync(savedFile, "utf8")).toBe(content);

    const manifest = readGroupDeliverableManifest(paths.workspacePath);
    expect(manifest.canonical?.["weekly-brief"]).toMatchObject({
      relativePath: "deliverables/weekly-brief.md",
      knowledgeBaseId: team.id,
      deliverableId: result.deliverableId,
    });
    expect(getDeliverableArchiveKnowledgeBaseId(result.deliverableId)).toBe(team.id);
    expect(listDeliverableArchiveKnowledgeBaseIds()[result.deliverableId]).toBe(team.id);
  });

  it("keeps file, attach, manifest, and archive store on the same reserved folder", async () => {
    const groupId = "grp-save-consistent";
    writeGroupAclFixture(groupId, "user-a");
    const team = ensureTeamDeliverablesKnowledgeBase({ ownerId: "user-a" });
    const content =
      "同一成果重复保存必须幂等，文件、知识库 attach、manifest 与 archive store 必须指向同一固定库。";

    const first = await saveAndArchiveWorkspaceDeliverable({
      userId: "user-a",
      sessionKey: "space:grp-save-consistent",
      knowledgeBaseId: team.id,
      title: "定价方案",
      content,
      groupId,
      logicalId: "pricing-plan",
    });
    const second = await saveAndArchiveWorkspaceDeliverable({
      userId: "user-a",
      sessionKey: "space:grp-save-consistent",
      knowledgeBaseId: team.id,
      title: "定价方案",
      content,
      groupId,
      logicalId: "pricing-plan",
    });

    expect(second.deliverableId).toBe(first.deliverableId);
    expect(second.knowledgeBaseId).toBe(team.id);
    expect(second.saveAction).toBe("noop");
    const attachCalls = vi.mocked(attachWorkspaceDeliverableToKnowledgeBase).mock.calls;
    expect(attachCalls).toHaveLength(1);
    expect(attachCalls[0]?.[0]?.knowledgeBaseId).toBe(team.id);
    expect(purgePriorKnowledgeDocumentVersions).not.toHaveBeenCalled();
    expect(getDeliverableArchiveKnowledgeBaseId(first.deliverableId)).toBe(team.id);

    const personal = ensurePersonalDeliverablesKnowledgeBase({ ownerId: "user-a" });
    expect(personal.id).not.toBe(team.id);
    expect(getDeliverableArchiveKnowledgeBaseId(first.deliverableId)).not.toBe(personal.id);
  });

  it("does not write files or attach when group membership is missing", async () => {
    const groupId = "grp-denied";
    const team = ensureTeamDeliverablesKnowledgeBase({ ownerId: "user-a" });
    const content = "错误归属不得写文件或 attach。未写入 members.json 的调用必须在归档前失败关闭。";

    await expect(
      saveAndArchiveWorkspaceDeliverable({
        userId: "user-a",
        sessionKey: "space:grp-denied",
        knowledgeBaseId: team.id,
        title: "未授权归档",
        content,
        groupId,
        logicalId: "denied-brief",
      }),
    ).rejects.toThrow(/not authorized/);

    expect(attachWorkspaceDeliverableToKnowledgeBase).not.toHaveBeenCalled();
    const paths = resolveGroupCollaborationPaths(groupId, cfg);
    expect(fs.existsSync(path.join(paths.workspacePath, "deliverables/denied-brief.md"))).toBe(
      false,
    );
    expect(listDeliverableArchiveKnowledgeBaseIds()).toEqual({});
  });

  it("does not write files or attach when a personal folder is used for a group session", async () => {
    const groupId = "grp-wrong-folder";
    writeGroupAclFixture(groupId, "user-a");
    const personal = ensurePersonalDeliverablesKnowledgeBase({ ownerId: "user-a" });
    const content = "协作会话成果只能进入团队成果。显式传入个人成果固定库必须失败且不得落盘。";

    await expect(
      saveAndArchiveWorkspaceDeliverable({
        userId: "user-a",
        sessionKey: "space:grp-wrong-folder",
        knowledgeBaseId: personal.id,
        title: "错误归属",
        content,
        groupId,
        logicalId: "wrong-folder",
      }),
    ).rejects.toThrow(/team_deliverables/);

    expect(attachWorkspaceDeliverableToKnowledgeBase).not.toHaveBeenCalled();
    const paths = resolveGroupCollaborationPaths(groupId, cfg);
    expect(fs.existsSync(path.join(paths.workspacePath, "deliverables/wrong-folder.md"))).toBe(
      false,
    );
  });

  it("ignores sidebar preview artifact ids and attaches the captured skill id", async () => {
    const personal = ensurePersonalDeliverablesKnowledgeBase({ ownerId: "user-a" });
    const content =
      "AI 智能体时代需要把对话成果沉淀进知识库，避免仅停留在侧栏预览哈希身份上。" +
      "保存时应使用 capture 产出的 skill 文档作为 ingest 源。";

    const result = await saveAndArchiveWorkspaceDeliverable({
      userId: "user-a",
      sessionKey: "agent:main:main",
      knowledgeBaseId: personal.id,
      title: "世界上最贵的找茬游戏",
      content,
      deliverableId: "assistant-doc:deadbeefpreviewhash",
    });

    expect(result.deliverableId.startsWith("skill:")).toBe(true);
    expect(result.knowledgeBaseId).toBe(personal.id);
    expect(attachWorkspaceDeliverableToKnowledgeBase).toHaveBeenCalledTimes(1);
    const attachArgs = vi.mocked(attachWorkspaceDeliverableToKnowledgeBase).mock.calls[0]?.[0];
    expect(attachArgs?.deliverableId).toBe(result.deliverableId);
    expect(attachArgs?.deliverableId).not.toContain("assistant-doc:");
    expect(attachArgs?.knowledgeBaseId).toBe(personal.id);
    expect(attachArgs?.deferEmbedding).toBe(true);
    expect(
      fs.readFileSync(
        path.join(
          tmpDir,
          "knowledge",
          "folders",
          "personal-deliverables",
          path.basename(result.relativePath ?? "document.md"),
        ),
        "utf8",
      ),
    ).toBe(content);
    expect(getDeliverableArchiveKnowledgeBaseId(result.deliverableId)).toBe(personal.id);
    const written = path.join(tmpDir, "personal-ws", result.relativePath ?? "");
    expect(fs.readFileSync(written, "utf8")).toBe(content);
  });

  it("forwards tenant ownership proof to attach so cloud ingest can write", async () => {
    const personal = ensurePersonalDeliverablesKnowledgeBase({
      ownerId: "user-a",
      tenantId: "tenant-cloud",
    });
    const { ownershipProofFromTenantUser } =
      await import("../../data-governance/ownership-proof.js");
    const proof = ownershipProofFromTenantUser({ tenantId: "tenant-cloud", userId: "user-a" });
    const content =
      "云端租户保存必须把认证入口的 ownership proof 传到知识库写入闸，否则会 missing_ownership_proof。";

    await saveAndArchiveWorkspaceDeliverable({
      userId: "user-a",
      sessionKey: "agent:main:main",
      knowledgeBaseId: personal.id,
      title: "云端论文笔记",
      content,
      governanceOwnershipProof: proof,
    });

    const attachArgs = vi.mocked(attachWorkspaceDeliverableToKnowledgeBase).mock.calls[0]?.[0];
    expect(attachArgs).toMatchObject({
      knowledgeBaseId: personal.id,
      governanceOwnershipProof: proof,
      deferEmbedding: true,
    });
    expect(
      fs.readFileSync(
        path.join(
          tmpDir,
          "tenants",
          "tenant-cloud",
          "users",
          "user-a",
          "OpenBot",
          "shared",
          "knowledge",
          "folders",
          "personal-deliverables",
          path.basename(attachArgs?.ingestFileName ?? "document.md"),
        ),
        "utf8",
      ),
    ).toBe(content);
  });

  it("asks before a second save when content changed", async () => {
    const personal = ensurePersonalDeliverablesKnowledgeBase({ ownerId: "user-a" });
    const firstBody =
      "咨询报告第一版：先把范围、证据和结论写清楚，再进入第二轮修订。" +
      "这份正文足够长，避免被自动捕获长度门挡住。";
    const first = await saveAndArchiveWorkspaceDeliverable({
      userId: "user-a",
      sessionKey: "agent:main:main",
      knowledgeBaseId: personal.id,
      title: "咨询报告",
      content: firstBody,
    });
    await expect(
      saveAndArchiveWorkspaceDeliverable({
        userId: "user-a",
        sessionKey: "agent:bot-2:main",
        knowledgeBaseId: personal.id,
        title: "咨询报告",
        content: `${firstBody} 第二版改了结论。`,
        agentId: "bot-2",
      }),
    ).rejects.toBeInstanceOf(SaveDecisionRequiredError);
    expect(attachWorkspaceDeliverableToKnowledgeBase).toHaveBeenCalledTimes(1);
    expect(getDeliverableArchiveRecord(first.deliverableId)?.rawHash).toBe(first.rawHash);
  });

  it("overwrite keeps the same document without purging historical evidence", async () => {
    const personal = ensurePersonalDeliverablesKnowledgeBase({ ownerId: "user-a" });
    const firstBody = "覆盖前的正文必须足够完整，才能作为知识库可调用的第一版成果进入个人成果。";
    const first = await saveAndArchiveWorkspaceDeliverable({
      userId: "user-a",
      sessionKey: "agent:bot-1:main",
      knowledgeBaseId: personal.id,
      title: "定价方案",
      content: firstBody,
      agentId: "bot-1",
    });
    const nextBody = `${firstBody} 用户确认覆盖，只保留这一版可调用正文。`;
    const second = await saveAndArchiveWorkspaceDeliverable({
      userId: "user-a",
      sessionKey: "agent:bot-2:main",
      knowledgeBaseId: personal.id,
      title: "定价方案",
      content: nextBody,
      agentId: "bot-2",
      saveMode: "overwrite",
      expectedRawHash: first.rawHash,
    });

    expect(second.saveAction).toBe("overwrite");
    expect(second.documentId).toBe(first.documentId);
    expect(second.rawHash).not.toBe(first.rawHash);
    expect(purgePriorKnowledgeDocumentVersions).not.toHaveBeenCalled();
    const attachArgs = vi.mocked(attachWorkspaceDeliverableToKnowledgeBase).mock.calls[1]?.[0];
    expect(attachArgs).toMatchObject({
      documentId: first.documentId,
      ingestContent: nextBody,
    });
    expect(getDeliverableArchiveRecord(second.deliverableId)?.rawHash).toBe(second.rawHash);
  });

  it("rejects a stale overwrite lock without writing", async () => {
    const personal = ensurePersonalDeliverablesKnowledgeBase({ ownerId: "user-a" });
    const firstBody = "已入库正文。并发覆盖必须拿用户看到的 rawHash，否则只能重新询问。";
    const first = await saveAndArchiveWorkspaceDeliverable({
      userId: "user-a",
      sessionKey: "agent:main:main",
      knowledgeBaseId: personal.id,
      title: "并发稿",
      content: firstBody,
    });
    await expect(
      saveAndArchiveWorkspaceDeliverable({
        userId: "user-a",
        sessionKey: "agent:main:main",
        knowledgeBaseId: personal.id,
        title: "并发稿",
        content: `${firstBody} 又改了一版。`,
        saveMode: "overwrite",
        expectedRawHash: "stale-hash",
      }),
    ).rejects.toBeInstanceOf(SaveConflictStaleError);
    expect(attachWorkspaceDeliverableToKnowledgeBase).toHaveBeenCalledTimes(1);
    expect(getDeliverableArchiveRecord(first.deliverableId)?.rawHash).toBe(first.rawHash);
  });

  it("save-as creates a sibling document with a unique filename and lineage", async () => {
    const personal = ensurePersonalDeliverablesKnowledgeBase({ ownerId: "user-a" });
    const firstBody = "原件入库后，另存必须留下可区分的新文件名和新的知识库文档身份。";
    const first = await saveAndArchiveWorkspaceDeliverable({
      userId: "user-a",
      sessionKey: "agent:bot-1:main",
      knowledgeBaseId: personal.id,
      title: "咨询报告",
      content: firstBody,
      filename: "consulting-report.md",
      agentId: "bot-1",
    });
    const nextBody = `${firstBody} 这是另一机器人改过的副本，应当另存而不是覆盖。`;
    const second = await saveAndArchiveWorkspaceDeliverable({
      userId: "user-a",
      sessionKey: "agent:bot-2:main",
      knowledgeBaseId: personal.id,
      title: "咨询报告",
      content: nextBody,
      filename: "consulting-report.md",
      agentId: "bot-2",
      saveMode: "save_as",
    });

    expect(second.saveAction).toBe("save_as");
    expect(second.derivedFromDocumentId).toBe(first.documentId);
    expect(second.relativePath).toBe("consulting-report-v2.md");
    expect(second.logicalId).not.toBe(first.logicalId);
    expect(purgePriorKnowledgeDocumentVersions).not.toHaveBeenCalled();
    const attachArgs = vi.mocked(attachWorkspaceDeliverableToKnowledgeBase).mock.calls[1]?.[0];
    expect(attachArgs).toMatchObject({
      ingestFileName: "consulting-report-v2.md",
      derivedFromDocumentId: first.documentId,
      derivedFromRawHash: first.rawHash,
    });
    expect(attachArgs?.documentId).toBeUndefined();
    expect(getDeliverableArchiveRecord(first.deliverableId)?.filename).toBe("consulting-report.md");
    expect(getDeliverableArchiveRecord(second.deliverableId)?.filename).toBe(
      "consulting-report-v2.md",
    );
  });

  it("does not write the birth workspace when knowledge ingest fails", async () => {
    const personal = ensurePersonalDeliverablesKnowledgeBase({ ownerId: "user-a" });
    const body = "入库失败时出生工作区必须保持原样，避免对话文件已经是新稿而知识库仍是旧原文。";
    vi.mocked(attachWorkspaceDeliverableToKnowledgeBase).mockRejectedValueOnce(
      new Error("ingest failed"),
    );

    await expect(
      saveAndArchiveWorkspaceDeliverable({
        userId: "user-a",
        sessionKey: "agent:main:main",
        knowledgeBaseId: personal.id,
        title: "入库失败稿",
        content: body,
        filename: "ingest-fail.md",
      }),
    ).rejects.toThrow(/ingest failed/);

    const written = path.join(tmpDir, "personal-ws", "ingest-fail.md");
    expect(fs.existsSync(written)).toBe(false);
  });

  it("keeps the previous workspace file when overwrite ingest fails", async () => {
    const personal = ensurePersonalDeliverablesKnowledgeBase({ ownerId: "user-a" });
    const firstBody = "已入库的第一版必须足够长，覆盖失败后磁盘上仍应是这一版，而不是第二版。";
    const first = await saveAndArchiveWorkspaceDeliverable({
      userId: "user-a",
      sessionKey: "agent:main:main",
      knowledgeBaseId: personal.id,
      title: "覆盖失败稿",
      content: firstBody,
      filename: "overwrite-fail.md",
    });
    const written = path.join(tmpDir, "personal-ws", first.relativePath ?? "");
    expect(fs.readFileSync(written, "utf8")).toBe(firstBody);

    vi.mocked(attachWorkspaceDeliverableToKnowledgeBase).mockRejectedValueOnce(
      new Error("ingest failed"),
    );
    await expect(
      saveAndArchiveWorkspaceDeliverable({
        userId: "user-a",
        sessionKey: "agent:main:main",
        knowledgeBaseId: personal.id,
        title: "覆盖失败稿",
        content: `${firstBody} 这一版不该落到工作区。`,
        filename: "overwrite-fail.md",
        saveMode: "overwrite",
        expectedRawHash: first.rawHash,
      }),
    ).rejects.toThrow(/ingest failed/);
    expect(fs.readFileSync(written, "utf8")).toBe(firstBody);
  });

  it("archives PDF bytes from base64 instead of UTF-8 text", async () => {
    const personal = ensurePersonalDeliverablesKnowledgeBase({ ownerId: "user-a" });
    const pdf = Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n1 0 obj\n<<>>\nendobj\n", "binary");
    const { computeRawContentHash } = await import("../document-fingerprint.js");

    const result = await saveAndArchiveWorkspaceDeliverable({
      userId: "user-a",
      sessionKey: "agent:bot-2:main",
      knowledgeBaseId: personal.id,
      title: "咨询报告",
      content: "",
      contentBase64: pdf.toString("base64"),
      filename: "consulting-report.pdf",
      agentId: "bot-2",
    });

    expect(result.saveAction).toBe("create");
    expect(result.rawHash).toBe(computeRawContentHash(pdf));
    expect(result.relativePath).toBe("consulting-report.pdf");
    const attachArgs = vi.mocked(attachWorkspaceDeliverableToKnowledgeBase).mock.calls[0]?.[0];
    expect(attachArgs).toMatchObject({
      ingestFileName: "consulting-report.pdf",
      ingestBase64: pdf.toString("base64"),
    });
    expect(attachArgs?.ingestContent).toBeUndefined();
  });

  it("write-throughs a steward reports/ birth path without a deliverables/ copy", async () => {
    const personal = ensurePersonalDeliverablesKnowledgeBase({ ownerId: "user-a" });
    const pptx = Buffer.from("PK\u0003\u0004-pptx-bytes", "binary");
    const result = await saveAndArchiveWorkspaceDeliverable({
      userId: "user-a",
      sessionKey: "agent:main:main",
      knowledgeBaseId: personal.id,
      title: "干部培训落地方案",
      content: "",
      contentBase64: pptx.toString("base64"),
      filename: "reports/从干部培训到人才战略工程的落地方案.pptx",
    });

    expect(result.relativePath).toBe("reports/从干部培训到人才战略工程的落地方案.pptx");
    const birth = path.join(tmpDir, "personal-ws", result.relativePath ?? "");
    expect(fs.readFileSync(birth)).toEqual(pptx);
    expect(
      fs.existsSync(
        path.join(tmpDir, "personal-ws", "deliverables", "从干部培训到人才战略工程的落地方案.pptx"),
      ),
    ).toBe(false);
  });

  it("write-throughs a group output/ birth path and does not mint a second deliverables/ copy", async () => {
    const groupId = "grp-birth-output";
    writeGroupAclFixture(groupId, "user-a");
    const team = ensureTeamDeliverablesKnowledgeBase({ ownerId: "user-a" });
    const pptx = Buffer.from("PK\u0003\u0004-group-pptx", "binary");

    const result = await saveAndArchiveWorkspaceDeliverable({
      userId: "user-a",
      sessionKey: "space:grp-birth-output",
      knowledgeBaseId: team.id,
      title: "组内路演",
      content: "",
      contentBase64: pptx.toString("base64"),
      filename: "output/deck.pptx",
      groupId,
    });

    expect(result.relativePath).toBe("output/deck.pptx");
    const paths = resolveGroupCollaborationPaths(groupId, cfg);
    expect(fs.readFileSync(path.join(paths.workspacePath, "output/deck.pptx"))).toEqual(pptx);
    expect(fs.existsSync(path.join(paths.workspacePath, "deliverables/deck.pptx"))).toBe(false);
  });
});

describe("resolveSaveArchiveDeliverableId", () => {
  it("detects preview artifact ids", () => {
    expect(isPreviewArtifactDeliverableId("assistant-doc:abc")).toBe(true);
    expect(isPreviewArtifactDeliverableId("tool-write:xyz")).toBe(true);
    expect(isPreviewArtifactDeliverableId("preview:hash")).toBe(true);
    expect(isPreviewArtifactDeliverableId("skill:real")).toBe(false);
  });

  it("prefers capture skill id over preview client id", () => {
    expect(
      resolveSaveArchiveDeliverableId({
        clientDeliverableId: "assistant-doc:preview",
        captureDeliverableId: "skill:captured-1",
        captureSkillId: "captured-1",
      }),
    ).toBe("skill:captured-1");
  });

  it("falls back to non-preview client id when capture is empty", () => {
    expect(
      resolveSaveArchiveDeliverableId({
        clientDeliverableId: "skill:existing",
        captureDeliverableId: null,
        captureSkillId: null,
      }),
    ).toBe("skill:existing");
  });

  it("rejects preview client id when capture is empty", () => {
    expect(
      resolveSaveArchiveDeliverableId({
        clientDeliverableId: "assistant-doc:preview",
        captureDeliverableId: null,
        captureSkillId: null,
      }),
    ).toBe("");
  });
});
