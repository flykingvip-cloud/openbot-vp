// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cfgState = vi.hoisted(() => ({ managed: false }));
vi.mock("../../../config/config.js", () => ({
  loadConfig: () => ({ data: { mode: cfgState.managed ? "managed" : "local" } }),
}));
const { tmpDir } = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-maybe-auto-capture-${Math.random().toString(36).slice(2)}`,
}));

vi.mock("../../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const ENVELOPE_BODY =
  "本周复盘结论：企业版定价需要新增 SSO 单点登录与自动对账能力，预计可提升老客户续费率约 12%。" +
  "建议在下一个迭代中优先落地，由产品同步给销售团队与客户成功团队。";

const { maybeAutoCaptureAgentDeliverable } =
  await import("./maybe-auto-capture-agent-deliverable.js");
const { listWorkspaceDeliverables } = await import("./read-model.js");
const { resolveRobotOwnWriteRoot } = await import("../../workspace-resolver/write-roots.js");

function cleanStore() {
  fs.rmSync(path.join(tmpDir, "skill-assets"), { recursive: true, force: true });
  fs.rmSync(path.join(tmpDir, "knowledge"), { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

describe("maybeAutoCaptureAgentDeliverable", () => {
  beforeEach(() => {
    cfgState.managed = false;
    cleanStore();
    delete process.env.OPENBOT_DELIVERABLE_AUTO_CAPTURE;
    delete process.env.OPENBOT_DELIVERABLE_AUTO_CAPTURE_HEURISTIC;
  });

  afterEach(() => {
    cfgState.managed = false;
    cleanStore();
    delete process.env.OPENBOT_DELIVERABLE_AUTO_CAPTURE;
    delete process.env.OPENBOT_DELIVERABLE_AUTO_CAPTURE_HEURISTIC;
  });

  it("managed capture only reads existing canonical bytes and never creates operators files", () => {
    cfgState.managed = true;
    const stateDir = path.join(tmpDir, "canonical-test-state");
    fs.rmSync(stateDir, { recursive: true, force: true });
    const canonical = path.join(stateDir, "tenant", "workspaces", "hash", "plan");
    fs.mkdirSync(canonical, { recursive: true });
    fs.writeFileSync(path.join(canonical, "actual.md"), "REAL BODY");
    const capture = (file: string, messageId: string) =>
      maybeAutoCaptureAgentDeliverable({
        agentId: "robot",
        ownerId: "user",
        stateDir,
        sessionKey: "agent:robot:main",
        messageId,
        canonicalWorkspaceRoot: canonical,
        content: `<<DELIVERABLE title="Result" file="${file}">>SUMMARY MUST NOT REPLACE BYTES<</DELIVERABLE>>`,
      });
    capture("actual.md", "existing");
    expect(fs.readFileSync(path.join(canonical, "actual.md"), "utf8")).toBe("REAL BODY");
    capture("missing.md", "missing");
    expect(fs.existsSync(path.join(canonical, "missing.md"))).toBe(false);
    const outside = path.join(stateDir, "outside.md");
    fs.writeFileSync(outside, "PRIVATE");
    fs.symlinkSync(outside, path.join(canonical, "escape.md"));
    capture("escape.md", "escape");
    expect(fs.readFileSync(outside, "utf8")).toBe("PRIVATE");
    expect(fs.existsSync(path.join(stateDir, "operators"))).toBe(false);
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("captures explicit deliverable envelopes after chat completion", async () => {
    const result = maybeAutoCaptureAgentDeliverable({
      agentId: "sales-bot",
      sessionKey: "agent:main:main",
      messageId: "msg-envelope-1",
      ownerId: "user-a",
      content: `好的，这是复盘结论。\n<<DELIVERABLE title="Q2 复盘结论">>\n${ENVELOPE_BODY}\n<</DELIVERABLE>>`,
    });
    expect(result?.captured).toBe(true);
    expect(result?.reason).toBe("captured");

    const { deliverables } = await listWorkspaceDeliverables({ userId: "user-a", limit: 20 });
    expect(deliverables.some((item) => item.deliverableId === result?.deliverableId)).toBe(true);
  });

  it("is idempotent for the same session + message", () => {
    const input = {
      agentId: "sales-bot",
      sessionKey: "agent:main:main",
      messageId: "msg-envelope-2",
      content: `<<DELIVERABLE title="结论">>\n${ENVELOPE_BODY}\n<</DELIVERABLE>>`,
    };
    const first = maybeAutoCaptureAgentDeliverable(input);
    const second = maybeAutoCaptureAgentDeliverable(input);
    expect(first?.captured).toBe(true);
    expect(second?.captured).toBe(false);
    expect(second?.reason).toBe("duplicate");
  });

  it("skips non-envelope output unless heuristic capture is enabled", () => {
    const result = maybeAutoCaptureAgentDeliverable({
      agentId: "sales-bot",
      sessionKey: "agent:main:main",
      messageId: "msg-plain",
      content: ENVELOPE_BODY,
    });
    expect(result).toBeNull();
  });

  it("captures long non-envelope output when heuristic capture is enabled", () => {
    process.env.OPENBOT_DELIVERABLE_AUTO_CAPTURE_HEURISTIC = "1";
    const result = maybeAutoCaptureAgentDeliverable({
      agentId: "sales-bot",
      sessionKey: "agent:main:main",
      messageId: "msg-heuristic",
      content: ENVELOPE_BODY,
    });
    expect(result?.captured).toBe(true);
  });

  it("captures a generated deliverable file referenced by an employee steward without an envelope", async () => {
    const result = maybeAutoCaptureAgentDeliverable({
      sessionKey: "agent:main:employee:user-elle",
      messageId: "msg-steward-file-1",
      content:
        "已经生成好了！优化后的简历已在工作区。\n文件：Alice_爱丽_瑜伽老师简历.docx\n主要优化点：头部设计、结构重组、视觉风格统一。",
    });
    expect(result?.captured).toBe(true);
    expect(result?.deliverableId).toBeTruthy();

    // Surfaces owner-scoped even when the caller owns no other agents.
    const owner = await listWorkspaceDeliverables({
      userId: "user-elle",
      limit: 20,
      visibleAgentIds: [],
    });
    const ownerItem = owner.deliverables.find(
      (item) => item.deliverableId === result?.deliverableId,
    );
    expect(ownerItem?.title).toBe("Alice_爱丽_瑜伽老师简历.docx");
    // 成果中心 can open the real workspace file, not just the captured text.
    expect(ownerItem?.previewKind).toBe("file");
    expect(ownerItem?.artifactFilename).toBe("Alice_爱丽_瑜伽老师简历.docx");

    // A different employee must not see another user's steward deliverable.
    const other = await listWorkspaceDeliverables({
      userId: "user-someone-else",
      limit: 20,
      visibleAgentIds: [],
    });
    expect(other.deliverables.some((item) => item.deliverableId === result?.deliverableId)).toBe(
      false,
    );
  });

  it("does not capture steward chatter that lacks a generated-file reference", () => {
    const result = maybeAutoCaptureAgentDeliverable({
      sessionKey: "agent:main:employee:user-elle",
      messageId: "msg-steward-chat-1",
      content: "你好，我可以帮你优化简历或整理资料，需要我做什么？",
    });
    expect(result).toBeNull();
  });

  it("does not force-capture a file mention outside an employee steward session", () => {
    const result = maybeAutoCaptureAgentDeliverable({
      agentId: "sales-bot",
      sessionKey: "agent:main:main",
      messageId: "msg-nonsteward-file",
      content: "已生成 报告.docx，请查收。",
    });
    // Non-steward + no envelope + heuristic off => not captured.
    expect(result).toBeNull();
  });

  it("captures a declared-file envelope with a file artifact reference", async () => {
    const result = maybeAutoCaptureAgentDeliverable({
      agentId: "sales-bot",
      sessionKey: "agent:main:main",
      messageId: "msg-declared-file",
      ownerId: "user-a",
      content: `已生成好了。\n<<DELIVERABLE title="季度报告" type="doc" file="Q3报告.docx">>\n${ENVELOPE_BODY}\n<</DELIVERABLE>>`,
    });
    expect(result?.captured).toBe(true);
    const { deliverables } = await listWorkspaceDeliverables({ userId: "user-a", limit: 20 });
    const item = deliverables.find((entry) => entry.deliverableId === result?.deliverableId);
    expect(item?.title).toBe("季度报告");
    // Office bytes are not invented from the markdown summary. Until a write
    // tool lands the file, the capture must not advertise a previewable file.
    expect(item?.previewKind).not.toBe("file");
    expect(item?.artifactFilename).not.toBe("Q3报告.docx");
  });

  it("lands a file= declaration as a non-empty workspace file the preview can open", () => {
    const stateDir = fs.mkdtempSync(path.join(tmpDir, "declare-state-"));
    fs.mkdirSync(path.join(stateDir, "tenants", "001"), { recursive: true });
    const result = maybeAutoCaptureAgentDeliverable({
      agentId: "main",
      sessionKey: "agent:main:main",
      messageId: "msg-article-final",
      ownerId: "user-a",
      stateDir,
      content: `已生成好了。\n<<DELIVERABLE title="终稿" type="article" file="article-final.md">>\n${ENVELOPE_BODY}\n<</DELIVERABLE>>`,
    });
    expect(result?.captured).toBe(true);

    const written = path.join(
      resolveRobotOwnWriteRoot({
        stateDir,
        tenantId: "001",
        userId: "user-a",
        agentId: "main",
      }),
      "article-final.md",
    );
    expect(fs.statSync(written).size).toBeGreaterThan(0);
    expect(fs.readFileSync(written, "utf8")).toContain("本周复盘结论");
  });

  it("does not create a zero-byte file when a file= declaration has an empty body", () => {
    const stateDir = fs.mkdtempSync(path.join(tmpDir, "declare-empty-"));
    fs.mkdirSync(path.join(stateDir, "tenants", "001"), { recursive: true });
    maybeAutoCaptureAgentDeliverable({
      agentId: "main",
      sessionKey: "agent:main:main",
      messageId: "msg-article-empty",
      ownerId: "user-a",
      stateDir,
      content: `<<DELIVERABLE title="终稿" type="article" file="article-final.md">>\n<</DELIVERABLE>>`,
    });
    const written = path.join(
      resolveRobotOwnWriteRoot({
        stateDir,
        tenantId: "001",
        userId: "user-a",
        agentId: "main",
      }),
      "article-final.md",
    );
    expect(fs.existsSync(written)).toBe(false);
  });

  it("captures a declared-url envelope with a published artifact reference", async () => {
    const result = maybeAutoCaptureAgentDeliverable({
      agentId: "sales-bot",
      sessionKey: "agent:main:main",
      messageId: "msg-declared-url",
      ownerId: "user-a",
      content: `已发布到草稿箱。\n<<DELIVERABLE title="公众号文章" type="article" url="https://mp.weixin.qq.com/s/abc">>\n${ENVELOPE_BODY}\n<</DELIVERABLE>>`,
    });
    expect(result?.captured).toBe(true);
    const { deliverables } = await listWorkspaceDeliverables({ userId: "user-a", limit: 20 });
    const item = deliverables.find((entry) => entry.deliverableId === result?.deliverableId);
    expect(item?.previewKind).toBe("published");
    expect(item?.openUrl).toBe("https://mp.weixin.qq.com/s/abc");
  });
});
