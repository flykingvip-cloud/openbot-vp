import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractDeliverableEnvelope } from "../../../shared/preview-artifact/deliverable-envelope.js";
import { settleCollaborationDeclaredDeliverable } from "../../workspace-resolver/settle-declared-deliverable.js";
import {
  buildChatDeliverableIdempotencyKey,
  deliverPreparedChatFinal,
  overlayChatDeliverablePublish,
  prepareChatDeliverablePublish,
  scrubFalseDeliveryClaims,
} from "./chat-deliverable-publish.js";
import { readGroupDeliverableManifest } from "./group-manifest.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function roots() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-deliver-publish-"));
  tempDirs.push(stateDir);
  const agent = path.join(stateDir, "agent-workspace");
  const group = path.join(stateDir, "group-workspace");
  fs.mkdirSync(agent, { recursive: true });
  fs.mkdirSync(group, { recursive: true });
  return { agent, group, stateDir };
}

const BODY = [
  "# 电力密度—散热—材料—资本开支",
  "",
  "三张表的字段与口径草案。传导链从电力密度到散热，再到材料与资本开支。",
  "本段用于确认协作回合在声明 file= 时会把正文落到可预览路径。",
].join("\n");

function declare(file: string, body = BODY): string {
  return [
    "三张表的字段与口径草案已写入工作区。",
    `<<DELIVERABLE title="建模底稿" type="doc" file="${file}">>`,
    body,
    "<</DELIVERABLE>>",
  ].join("\n");
}

function prepareGroup(
  dirs: ReturnType<typeof roots>,
  text: string,
  extra: Partial<Parameters<typeof prepareChatDeliverablePublish>[0]> = {},
) {
  return prepareChatDeliverablePublish({
    text,
    publishIntent: "group-bot-final",
    sessionKey: "space:group-a",
    tenantId: "tenant-a",
    groupId: "group-a",
    agentId: "bot-a",
    clientRunId: "run-1",
    taskId: null,
    stateDir: dirs.stateDir,
    agentWorkspaceRoot: dirs.agent,
    groupWorkspaceRoot: dirs.group,
    skipCapture: true,
    ...extra,
  });
}

describe("prepareChatDeliverablePublish", () => {
  it("persists a group text deliverable before the caller broadcasts success", () => {
    const dirs = roots();
    const relative = "analysis/model.md";
    const result = prepareGroup(dirs, declare(relative));

    expect(result.structured).toBe(true);
    expect(result.record?.settleStatus).toBe("confirmed");
    expect(result.record?.verification).toBe("pass");
    expect(result.record?.registration).toBe("registered");
    expect(result.record?.persisted).toBe(true);
    expect(result.record?.broadcastOk).toBeNull();
    expect(result.view.presentation).toBe("delivered");
    expect(result.record?.authoritativeWrites).toBe(1);
    expect(result.text).toContain("已写入工作区");
    expect(extractDeliverableEnvelope(result.text)?.settle).toBe("confirmed");
    expect(fs.readFileSync(path.join(dirs.group, relative), "utf8")).toContain("电力密度");
    expect(result.idempotencyKey).toBe(
      buildChatDeliverableIdempotencyKey({
        tenantId: "tenant-a",
        sessionKey: "space:group-a",
        publishIntent: "group-bot-final",
        taskId: null,
        relativePath: relative,
        versionChecksum: result.record?.versionChecksum,
      }),
    );
  });

  it("keeps 1:1 writes inside the agent workspace and does not touch a group root", () => {
    const dirs = roots();
    const relative = "notes/brief.md";
    const result = prepareChatDeliverablePublish({
      text: declare(relative),
      publishIntent: "agent-run-final",
      sessionKey: "agent:main:main",
      tenantId: "tenant-a",
      groupId: null,
      taskId: null,
      agentId: "main",
      stateDir: dirs.stateDir,
      agentWorkspaceRoot: dirs.agent,
      groupWorkspaceRoot: null,
      skipCapture: true,
    });

    expect(result.record?.settleStatus).toBe("readable");
    expect(result.record?.verification).toBe("pass");
    expect(result.view.presentation).toBe("delivered");
    expect(result.record).not.toHaveProperty("accepted");
    expect(fs.readFileSync(path.join(dirs.agent, relative), "utf8")).toContain("电力密度");
    expect(fs.existsSync(path.join(dirs.group, relative))).toBe(false);
    expect(fs.existsSync(path.join(dirs.group, ".manifest.json"))).toBe(false);
  });

  it("does not treat a missing group root as an agent-only readable success", () => {
    const dirs = roots();
    const result = prepareGroup(dirs, declare("notes/brief.md"), {
      groupWorkspaceRoot: null,
      groupScoped: true,
    });

    expect(result.record?.settleStatus).toBe("retryable");
    expect(result.view.presentation).not.toBe("delivered");
    expect(result.view.registration).toBe("failed");
    expect(fs.existsSync(path.join(dirs.agent, "notes/brief.md"))).toBe(false);
  });

  it("leaves verbal success prose untouched when there is no structured file declaration", () => {
    const dirs = roots();
    const text = "已生成 report.pdf，保存在工作区。";
    const result = prepareGroup(dirs, text);

    expect(result.structured).toBe(false);
    expect(result.view.presentation).toBe("none");
    expect(result.text).toBe(text);
    expect(result.record).toBeNull();
    expect(fs.readdirSync(dirs.agent)).toEqual([]);
    expect(fs.readdirSync(dirs.group)).toEqual([]);
  });

  it("scopes the idempotency key by tenant, session, and intent without requiring a task id", () => {
    const shared = {
      publishIntent: "agent-run-final" as const,
      relativePath: "notes/brief.md",
      versionChecksum: "abc",
    };
    const direct = buildChatDeliverableIdempotencyKey({
      ...shared,
      tenantId: "tenant-a",
      sessionKey: "agent:main:main",
      taskId: null,
    });
    const otherSession = buildChatDeliverableIdempotencyKey({
      ...shared,
      tenantId: "tenant-a",
      sessionKey: "agent:main:other",
      taskId: null,
    });
    const otherTenant = buildChatDeliverableIdempotencyKey({
      ...shared,
      tenantId: "tenant-b",
      sessionKey: "agent:main:main",
      taskId: null,
    });
    const otherIntent = buildChatDeliverableIdempotencyKey({
      ...shared,
      tenantId: "tenant-a",
      sessionKey: "agent:main:main",
      publishIntent: "direct-fallback-final",
      taskId: null,
    });

    expect(direct).toMatch(/^[a-f0-9]{64}$/);
    expect(new Set([direct, otherSession, otherTenant, otherIntent]).size).toBe(4);
  });

  it("keeps the analysis body and does not present delivery when the file is missing or empty", () => {
    const dirs = roots();
    const missing = prepareGroup(
      dirs,
      [
        "分析结论仍然有效。",
        '<<DELIVERABLE title="报告" file="reports/brief.pdf">>',
        "见附件。",
        "<</DELIVERABLE>>",
      ].join("\n"),
    );
    expect(missing.view.presentation).toBe("undelivered");
    expect(missing.view.verification).toBe("fail");
    expect(missing.view.failureReason).toBe("binary_requires_tool_write");
    expect(missing.text).toContain("分析结论仍然有效。");
    expect(fs.existsSync(path.join(dirs.group, "reports/brief.pdf"))).toBe(false);

    const relative = "notes/empty.md";
    fs.mkdirSync(path.join(dirs.group, "notes"), { recursive: true });
    fs.writeFileSync(path.join(dirs.group, relative), "");
    const empty = prepareGroup(dirs, declare(relative, ""));
    expect(empty.view.presentation).toBe("undelivered");
    expect(empty.record?.settleStatus).toBe("unwritten");
    expect(empty.text).toContain("已写入工作区");
  });

  it("does not overwrite a conflicting group version or present it as delivered", () => {
    const dirs = roots();
    const relative = "analysis/model-framework-v0.md";
    const oldBytes = Buffer.from("# OLD group draft\npreview stays here\n", "utf8");
    const newBody = [
      "# NEW bot deliverable",
      "",
      "This is the revised modeling framework body that must not silently confirm",
      "against the stale group formal-root file.",
    ].join("\n");
    fs.mkdirSync(path.join(dirs.group, "analysis"), { recursive: true });
    fs.mkdirSync(path.join(dirs.agent, "analysis"), { recursive: true });
    fs.writeFileSync(path.join(dirs.group, relative), oldBytes);
    fs.writeFileSync(path.join(dirs.agent, relative), newBody, "utf8");

    const result = prepareGroup(dirs, declare(relative, newBody));

    expect(result.record?.settleStatus).toBe("conflict");
    expect(result.view.presentation).toBe("undelivered");
    expect(result.view.failureReason).toBe("version_conflict");
    expect(result.record?.authoritativeWrites).toBe(0);
    expect(fs.readFileSync(path.join(dirs.group, relative))).toEqual(oldBytes);
    expect(result.text).toContain("已写入工作区");
  });

  it("keeps a passed byte check as pending recovery when manifest registration fails", () => {
    const dirs = roots();
    const relative = "analysis/retryable.md";
    fs.mkdirSync(path.join(dirs.group, ".manifest.json"));

    const failed = prepareGroup(dirs, declare(relative));

    expect(failed.record?.settleStatus).toBe("retryable");
    expect(failed.view.verification).toBe("pass");
    expect(failed.view.registration).toBe("failed");
    expect(failed.view.presentation).toBe("pending_recovery");
    expect(failed.view.reasonLabel).toContain("登记失败");
    expect(failed.text).toContain("已写入工作区");
    expect(fs.readFileSync(path.join(dirs.group, relative), "utf8")).toContain("电力密度");
    expect(readGroupDeliverableManifest(dirs.group).drafts ?? {}).toEqual({});

    fs.rmSync(path.join(dirs.group, ".manifest.json"), { recursive: true, force: true });
    const recovered = prepareGroup(dirs, declare(relative));
    expect(recovered.idempotencyKey).toBe(failed.idempotencyKey);
    expect(recovered.view.registration).toBe("registered");
    expect(recovered.view.verification).toBe("pass");
    expect(recovered.record?.authoritativeWrites).toBe(1);
    expect(recovered.record?.versionChecksum).toBe(failed.record?.versionChecksum);
    const drafts = Object.values(readGroupDeliverableManifest(dirs.group).drafts ?? {});
    expect(drafts.filter((entry) => entry.relativePath === relative)).toHaveLength(1);
  });

  it("keeps the original analysis when settle throws and does not present delivery", () => {
    const dirs = roots();
    const result = prepareGroup(dirs, declare("notes/brief.md"), {
      settleImpl: () => {
        throw new Error("disk exploded");
      },
    });

    expect(result.view.presentation).toBe("undelivered");
    expect(result.view.verification).toBe("unknown");
    expect(result.view.failureReason).toBe("settle_threw");
    expect(result.text).toContain("已写入工作区");
    expect(extractDeliverableEnvelope(result.text)?.unwritten).toBe(true);
    expect(result.record?.authoritativeWrites ?? 0).toBe(0);
  });

  it("records a broadcast failure without a second version and replays the same publish", () => {
    const dirs = roots();
    const relative = "analysis/model.md";
    let settleCalls = 0;
    const settleImpl: typeof settleCollaborationDeclaredDeliverable = (params) => {
      settleCalls += 1;
      return settleCollaborationDeclaredDeliverable(params);
    };
    const first = prepareGroup(dirs, declare(relative), { settleImpl });
    expect(first.view.presentation).toBe("delivered");
    expect(first.record?.registration).toBe("registered");

    const failedBroadcast = deliverPreparedChatFinal({
      prepared: first,
      send: () => {
        throw new Error("socket closed");
      },
    });
    expect(failedBroadcast.ok).toBe(false);

    const replay = prepareGroup(dirs, declare(relative), { settleImpl });
    expect(replay.replayed).toBe(true);
    expect(replay.idempotencyKey).toBe(first.idempotencyKey);
    expect(replay.view.presentation).toBe("pending_recovery");
    expect(replay.view.registration).toBe("registered");
    expect(replay.view.failureReason).toBe("broadcast_failed");
    expect(replay.record?.authoritativeWrites).toBe(1);
    expect(replay.record?.versionChecksum).toBe(first.record?.versionChecksum);
    expect(settleCalls).toBe(1);

    const resent = deliverPreparedChatFinal({
      prepared: replay,
      send: () => undefined,
    });
    expect(resent.ok).toBe(true);
    const again = prepareGroup(dirs, declare(relative), { settleImpl });
    expect(again.replayed).toBe(true);
    expect(again.view.presentation).toBe("delivered");
    expect(again.record?.authoritativeWrites).toBe(1);
    expect(settleCalls).toBe(1);
    const drafts = Object.values(readGroupDeliverableManifest(dirs.group).drafts ?? {});
    expect(drafts.filter((entry) => entry.relativePath === relative)).toHaveLength(1);
  });

  it("overlays history with the ledger so a failed broadcast is not shown as delivered", () => {
    const dirs = roots();
    const relative = "analysis/model.md";
    const first = prepareGroup(dirs, declare(relative));
    deliverPreparedChatFinal({
      prepared: first,
      send: () => {
        throw new Error("broadcast down");
      },
    });
    const overlaid = overlayChatDeliverablePublish({
      sessionKey: "space:group-a",
      stateDir: dirs.stateDir,
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: first.text }],
          deliverablePublish: first.view,
        },
      ],
    });
    const publish = (
      overlaid[0] as { deliverablePublish?: { presentation?: string; registration?: string } }
    ).deliverablePublish;
    expect(publish?.presentation).toBe("pending_recovery");
    expect(publish?.registration).toBe("registered");
    expect(first.text).toContain("已写入工作区");
  });
});

describe("scrubFalseDeliveryClaims / delivery copy gate", () => {
  it("removes preview-success claims from undelivered publish text", () => {
    const dirs = roots();
    const relative = "output/pdf/demo.pdf";
    const text = [
      "分析结论仍然有效。点预览就能打开。",
      `<<DELIVERABLE title="demo" type="pdf" file="${relative}">>`,
      "见附件。",
      "<</DELIVERABLE>>",
    ].join("\n");
    const result = prepareGroup(dirs, text);
    expect(result.view.presentation).toBe("undelivered");
    expect(result.text).toContain("分析结论仍然有效。");
    expect(result.text).not.toMatch(/点预览就能打开|可以直接打开/);
  });

  it("scrubs standalone false claims and keeps delivered prose gated by presentation", () => {
    expect(scrubFalseDeliveryClaims("分析结论仍然有效。点预览就能打开。")).toBe(
      "分析结论仍然有效。",
    );
    expect(scrubFalseDeliveryClaims("可以直接打开这份 PDF。")).not.toMatch(/可以直接打开/);
  });
});
