import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractDeliverableEnvelope } from "../../shared/preview-artifact/deliverable-envelope.js";
import { readGroupDeliverableManifest } from "../knowledge/deliverables/group-manifest.js";
import {
  settleCollaborationDeclaredDeliverable,
  settleDeclaredDeliverableText,
} from "./settle-declared-deliverable.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function roots() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-settle-"));
  tempDirs.push(stateDir);
  const agent = path.join(stateDir, "agent-workspace");
  const group = path.join(stateDir, "group-workspace");
  fs.mkdirSync(agent, { recursive: true });
  fs.mkdirSync(path.join(group, "runtime"), { recursive: true });
  return { agent, group, stateDir };
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const BODY = [
  "# 电力密度—散热—材料—资本开支",
  "",
  "三张表的字段与口径草案。传导链从电力密度到散热，再到材料与资本开支。",
  "本段用于确认协作回合在声明 file= 时会把正文落到可预览路径。",
].join("\n");

function declare(file: string, body = BODY, extraAttrs = ""): string {
  const attrs = extraAttrs ? ` ${extraAttrs.trim()}` : "";
  return [
    "三张表的字段与口径草案已写入工作区。",
    `<<DELIVERABLE title="建模底稿" type="doc" file="${file}"${attrs}>>`,
    body,
    "<</DELIVERABLE>>",
  ].join("\n");
}

describe("settleDeclaredDeliverableText", () => {
  it("confirms a text declaration into bot + group workspaces and pins manifest (PR C)", () => {
    const { agent, group } = roots();
    const relative = "analysis/ai-power-chain-v1/model-framework-v0.md";
    const result = settleDeclaredDeliverableText({
      text: declare(relative),
      agentWorkspaceRoot: agent,
      groupWorkspaceRoot: group,
    });

    expect(result.status).toBe("confirmed");
    expect(result.manifestOk).toBe(true);
    expect(result.relativePath).toBe(relative);
    expect(result.versionChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.readFileSync(path.join(agent, relative), "utf8")).toContain("电力密度");
    expect(fs.readFileSync(path.join(group, relative), "utf8")).toContain("电力密度");
    expect(result.versionChecksum).toBe(sha256(fs.readFileSync(path.join(group, relative))));
    expect(result.versionChecksum).toBe(sha256(fs.readFileSync(path.join(agent, relative))));
    const envelope = extractDeliverableEnvelope(result.text);
    expect(envelope?.file).toBe(relative);
    expect(envelope?.settle).toBe("confirmed");
    expect(envelope?.unwritten).toBeFalsy();
    const manifest = readGroupDeliverableManifest(group);
    const draft = Object.values(manifest.drafts ?? {}).find((e) => e.relativePath === relative);
    expect(draft?.relativePath).toBe(relative);
  });

  it("does not treat model file= alone as confirmed when bytes are missing", () => {
    const { agent, group } = roots();
    const result = settleDeclaredDeliverableText({
      text: declare("人才回流.docx", "摘要不是 docx 字节。"),
      agentWorkspaceRoot: agent,
      groupWorkspaceRoot: group,
    });

    expect(result.status).toBe("unwritten");
    expect(result.reason).toBe("binary_requires_tool_write");
    expect(result.text).toContain('unwritten="1"');
    expect(extractDeliverableEnvelope(result.text)?.settle).toBe("declared");
    expect(extractDeliverableEnvelope(result.text)?.unwritten).toBe(true);
    expect(fs.existsSync(path.join(agent, "人才回流.docx"))).toBe(false);
    expect(fs.existsSync(path.join(group, "人才回流.docx"))).toBe(false);
    expect(Object.keys(readGroupDeliverableManifest(group).drafts ?? {})).toHaveLength(0);
  });

  it("refuses basename-only matches under a different relative path (PR C)", () => {
    const { agent, group } = roots();
    const longName = "deliverables/人才回流矛盾中的老板权变智慧.docx";
    fs.mkdirSync(path.join(group, "deliverables"), { recursive: true });
    fs.writeFileSync(path.join(group, longName), Buffer.from("PK\x03\x04fake-docx-bytes!!"));
    // Also plant on agent under long path only
    fs.mkdirSync(path.join(agent, "deliverables"), { recursive: true });
    fs.writeFileSync(path.join(agent, longName), Buffer.from("PK\x03\x04fake-docx-bytes!!"));

    const result = settleDeclaredDeliverableText({
      text: declare("人才回流.docx", "模型只声明了短名。"),
      agentWorkspaceRoot: agent,
      groupWorkspaceRoot: group,
    });

    expect(result.status).toBe("unwritten");
    expect(result.reason).toBe("binary_requires_tool_write");
    expect(fs.existsSync(path.join(group, "人才回流.docx"))).toBe(false);
    expect(extractDeliverableEnvelope(result.text)?.settle).toBe("declared");
  });

  it("confirms when exact relative path already has bytes on group SOT", () => {
    const { agent, group } = roots();
    const relative = "output/docx/人才回流.docx";
    fs.mkdirSync(path.join(group, "output/docx"), { recursive: true });
    const bytes = Buffer.from("PK\x03\x04exact-path-bytes-here");
    fs.writeFileSync(path.join(group, relative), bytes);

    const result = settleDeclaredDeliverableText({
      text: declare(relative, "摘要"),
      agentWorkspaceRoot: agent,
      groupWorkspaceRoot: group,
    });

    expect(result.status).toBe("confirmed");
    expect(result.relativePath).toBe(relative);
    expect(result.versionChecksum).toBe(sha256(bytes));
    expect(extractDeliverableEnvelope(result.text)?.settle).toBe("confirmed");
    expect(extractDeliverableEnvelope(result.text)?.file).toBe(relative);
    // Mirrored to agent at same relative path
    expect(fs.readFileSync(path.join(agent, relative)).equals(bytes)).toBe(true);
  });

  it("is idempotent: second settle keeps confirmed + same manifest relativePath", () => {
    const { agent, group } = roots();
    const relative = "reports/brief-v1.md";
    const first = settleDeclaredDeliverableText({
      text: declare(relative),
      agentWorkspaceRoot: agent,
      groupWorkspaceRoot: group,
    });
    expect(first.status).toBe("confirmed");
    const second = settleDeclaredDeliverableText({
      text: first.text,
      agentWorkspaceRoot: agent,
      groupWorkspaceRoot: group,
    });
    expect(second.status).toBe("confirmed");
    expect(second.relativePath).toBe(relative);
    expect(second.versionChecksum).toBe(first.versionChecksum);
    const drafts = Object.values(readGroupDeliverableManifest(group).drafts ?? {});
    expect(drafts.filter((d) => d.relativePath === relative)).toHaveLength(1);
  });

  it("returns retryable when group disk is OK but manifest cannot be written", () => {
    const { agent, group } = roots();
    const relative = "analysis/retryable.md";
    // Block manifest write by making .manifest.json a directory
    fs.mkdirSync(path.join(group, ".manifest.json"), { recursive: true });

    const result = settleDeclaredDeliverableText({
      text: declare(relative),
      agentWorkspaceRoot: agent,
      groupWorkspaceRoot: group,
    });

    expect(result.status).toBe("retryable");
    expect(result.manifestOk).toBe(false);
    expect(result.reason).toBe("manifest_write_failed");
    expect(fs.existsSync(path.join(group, relative))).toBe(true);
    expect(extractDeliverableEnvelope(result.text)?.settle).toBe("retryable");
    expect(extractDeliverableEnvelope(result.text)?.unwritten).toBeFalsy();
  });

  it("keeps agent-only success as readable (no group root)", () => {
    const { agent } = roots();
    const relative = "solo/note.md";
    const result = settleDeclaredDeliverableText({
      text: declare(relative),
      agentWorkspaceRoot: agent,
      groupWorkspaceRoot: null,
    });
    expect(result.status).toBe("readable");
    expect(fs.readFileSync(path.join(agent, relative), "utf8")).toContain("电力密度");
    expect(extractDeliverableEnvelope(result.text)?.settle).toBeUndefined();
  });

  it("does not treat an empty text body as a workspace write", () => {
    const { agent, group } = roots();
    const result = settleDeclaredDeliverableText({
      text: '<<DELIVERABLE title="终稿" file="article-final.md">><</DELIVERABLE>>',
      agentWorkspaceRoot: agent,
      groupWorkspaceRoot: group,
    });
    expect(result.status).toBe("unwritten");
    expect(fs.existsSync(path.join(agent, "article-final.md"))).toBe(false);
    expect(fs.existsSync(path.join(group, "article-final.md"))).toBe(false);
  });

  it("refuses to materialize into group metadata directories", () => {
    const { group } = roots();
    const result = settleDeclaredDeliverableText({
      text: declare("runtime/transcript.md"),
      agentWorkspaceRoot: null,
      groupWorkspaceRoot: group,
    });
    expect(result.status).toBe("unwritten");
    expect(fs.existsSync(path.join(group, "runtime/transcript.md"))).toBe(false);
  });
});

describe("settle version conflict (P1-1)", () => {
  it("returns conflict when group old file differs from agent new deliverable", () => {
    const { agent, group } = roots();
    const relative = "analysis/model-framework-v0.md";
    const oldBytes = Buffer.from("# OLD group draft\npreview stays here\n", "utf8");
    const newBody = [
      "# NEW bot deliverable",
      "",
      "This is the revised modeling framework body that must not silently confirm",
      "against the stale group formal-root file.",
    ].join("\n");
    fs.mkdirSync(path.join(group, "analysis"), { recursive: true });
    fs.mkdirSync(path.join(agent, "analysis"), { recursive: true });
    fs.writeFileSync(path.join(group, relative), oldBytes);
    fs.writeFileSync(path.join(agent, relative), newBody, "utf8");

    const result = settleDeclaredDeliverableText({
      text: declare(relative, newBody),
      agentWorkspaceRoot: agent,
      groupWorkspaceRoot: group,
    });

    expect(result.status).toBe("conflict");
    expect(result.reason).toBe("version_conflict");
    expect(result.versionChecksum).toBe(sha256(newBody));
    expect(result.existingChecksum).toBe(sha256(oldBytes));
    expect(result.versionChecksum).not.toBe(result.existingChecksum);
    // Group formal root must remain the old preview bytes (no silent overwrite).
    expect(fs.readFileSync(path.join(group, relative))).toEqual(oldBytes);
    expect(fs.readFileSync(path.join(agent, relative), "utf8")).toBe(newBody);
    expect(extractDeliverableEnvelope(result.text)?.settle).toBe("conflict");
    expect(Object.keys(readGroupDeliverableManifest(group).drafts ?? {})).toHaveLength(0);
  });

  it("confirms only when group formal-root checksum equals this deliverable version", () => {
    const { agent, group } = roots();
    const relative = "analysis/same-version.md";
    const body = BODY;
    fs.mkdirSync(path.join(group, "analysis"), { recursive: true });
    fs.mkdirSync(path.join(agent, "analysis"), { recursive: true });
    fs.writeFileSync(path.join(group, relative), body, "utf8");
    fs.writeFileSync(path.join(agent, relative), body, "utf8");

    const result = settleDeclaredDeliverableText({
      text: declare(relative, body),
      agentWorkspaceRoot: agent,
      groupWorkspaceRoot: group,
    });

    expect(result.status).toBe("confirmed");
    expect(result.versionChecksum).toBe(sha256(body));
    expect(result.versionChecksum).toBe(sha256(fs.readFileSync(path.join(group, relative))));
    expect(extractDeliverableEnvelope(result.text)?.settle).toBe("confirmed");
  });

  it("personal bot: generated checksum equals formal root equals preview bytes", () => {
    const { agent } = roots();
    const relative = "personal/brief.md";
    const result = settleDeclaredDeliverableText({
      text: declare(relative),
      agentWorkspaceRoot: agent,
      groupWorkspaceRoot: null,
    });
    expect(result.status).toBe("readable");
    const onDisk = fs.readFileSync(path.join(agent, relative));
    expect(result.versionChecksum).toBe(sha256(onDisk));
    expect(onDisk.toString("utf8")).toContain("电力密度");
  });

  it("cross-login job bot path: agent formal root checksum matches settled version", () => {
    // Seat/job bots still settle through the agent workspace root for non-group turns.
    const { agent } = roots();
    const relative = "seat/job-output.md";
    const result = settleDeclaredDeliverableText({
      text: declare(relative),
      agentWorkspaceRoot: agent,
      groupWorkspaceRoot: null,
    });
    expect(result.status).toBe("readable");
    expect(result.versionChecksum).toBe(sha256(fs.readFileSync(path.join(agent, relative))));
  });

  it("collaboration group: checksum equals group formal root equals preview", () => {
    const { agent, group } = roots();
    const relative = "group/shared-brief.md";
    const result = settleDeclaredDeliverableText({
      text: declare(relative),
      agentWorkspaceRoot: agent,
      groupWorkspaceRoot: group,
    });
    expect(result.status).toBe("confirmed");
    const groupBytes = fs.readFileSync(path.join(group, relative));
    const agentBytes = fs.readFileSync(path.join(agent, relative));
    expect(result.versionChecksum).toBe(sha256(groupBytes));
    expect(sha256(agentBytes)).toBe(sha256(groupBytes));
  });
});

describe("settle group-root fail closed (P1-2)", () => {
  it("group-scoped settle with null group root is retryable, never readable", () => {
    const { agent } = roots();
    const relative = "analysis/group-task.md";
    const result = settleCollaborationDeclaredDeliverable({
      text: declare(relative),
      agentId: "bot-market",
      groupId: "grp-digital-team",
      agentWorkspaceRoot: agent,
      groupWorkspaceRoot: null,
      groupScoped: true,
    });
    expect(result.status).toBe("retryable");
    expect(result.reason).toMatch(/group_root_unavailable|locator_failed|missing_tenant/);
    expect(result.status).not.toBe("readable");
    expect(result.status).not.toBe("confirmed");
    expect(extractDeliverableEnvelope(result.text)?.settle).toBe("retryable");
    // Must not claim success by writing only to the agent workspace as a personal task.
    expect(fs.existsSync(path.join(agent, relative))).toBe(false);
  });

  it("managed_enterprise missing tenant marks group root failure (not agent-only success)", async () => {
    vi.resetModules();
    vi.doMock("../security-profile.js", () => ({
      resolveSecurityProfile: () => ({
        ok: true,
        profile: "managed_enterprise",
        isolationLevel: "I3",
        source: "test",
        tenantExecutionBoundary: "dedicated",
        errors: [],
      }),
    }));
    vi.doMock("../../config/config.js", () => ({
      loadConfig: () => ({ agents: { defaults: { workspace: "/tmp/agent" } } }),
    }));
    const { resolveCollaborationDeliverableRoots } =
      await import("./settle-declared-deliverable.js");
    const rootsResult = resolveCollaborationDeliverableRoots({
      agentId: "bot-market",
      groupId: "grp-digital-team",
      tenantId: null,
      userId: "user-1",
    });
    expect(rootsResult.groupWorkspaceRoot).toBeNull();
    expect(rootsResult.groupRootFailureReason).toBe("missing_tenant");
  });
});
