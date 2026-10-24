import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";
import { prepareChatDeliverablePublish } from "../knowledge/deliverables/chat-deliverable-publish.js";
import {
  alignFormalRootForManagedAddressing,
  resolveFormalAgentWorkspace,
  resolveFormalPreviewAbsolutePath,
} from "./formal-deliverable-root.js";
import {
  resolveCollaborationDeliverableRoots,
  settleDeclaredDeliverableText,
} from "./settle-declared-deliverable.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const RELATIVE = "output/pdf/收入增长是否等于经营改善.pdf";
const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

function layout() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-formal-settle-"));
  tempDirs.push(stateDir);
  const tenantsRoot = path.join(stateDir, "volume-tenants");
  const userId = "user-elle";
  const agentId = "bot-skill";
  const tenantId = "001";
  const leaf = path.join("OpenBot", "agents", agentId, "workspace");
  const operators = path.join(stateDir, "operators", userId, leaf);
  const stateTenants = path.join(stateDir, "tenants", tenantId, "users", userId, leaf);
  const volumeTenants = path.join(tenantsRoot, tenantId, "users", userId, leaf);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENBOT_STATE_DIR: stateDir,
    OPENBOT_TENANTS_ROOT: tenantsRoot,
    OPENBOT_MULTITENANT: "1",
    OPENBOT_DATA_MODE: "managed",
  };
  delete env.OPENCLAW_DATA_MODE;
  const cfg = { data: { mode: "managed" } } as OpenBotConfig;
  return {
    stateDir,
    tenantsRoot,
    userId,
    agentId,
    tenantId,
    operators,
    stateTenants,
    volumeTenants,
    env,
    cfg,
  };
}

function writeAt(root: string, relative: string, bytes: Buffer | string): void {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, bytes);
}

function declarePdf(relative = RELATIVE): string {
  return [
    "分析结论仍然有效。点预览就能打开。",
    `<<DELIVERABLE title="收入增长是否等于经营改善" type="pdf" file="${relative}">>`,
    "见附件。",
    "<</DELIVERABLE>>",
  ].join("\n");
}

function publish(dirs: ReturnType<typeof layout>, text: string) {
  return prepareChatDeliverablePublish({
    text,
    publishIntent: "agent-run-final",
    sessionKey: "agent:bot-skill:direct",
    tenantId: dirs.tenantId,
    groupId: null,
    taskId: null,
    agentId: dirs.agentId,
    userId: dirs.userId,
    stateDir: dirs.stateDir,
    env: dirs.env,
    skipCapture: true,
  });
}

describe("batch 9 formal root settle", () => {
  it("delivers a PDF that already sits on the operators formal root", () => {
    const dirs = layout();
    writeAt(dirs.operators, RELATIVE, PDF_BYTES);

    const roots = resolveCollaborationDeliverableRoots({
      agentId: dirs.agentId,
      tenantId: dirs.tenantId,
      userId: dirs.userId,
      stateDir: dirs.stateDir,
      cfg: dirs.cfg,
      env: dirs.env,
    });
    expect(roots.agentWorkspaceRoot).toBe(path.resolve(dirs.operators));
    expect(
      alignFormalRootForManagedAddressing(dirs.stateTenants, { config: dirs.cfg, env: dirs.env }),
    ).toBe(roots.agentWorkspaceRoot);
    expect(
      alignFormalRootForManagedAddressing(dirs.volumeTenants, { config: dirs.cfg, env: dirs.env }),
    ).toBe(roots.agentWorkspaceRoot);

    const result = publish(dirs, declarePdf());
    expect(result.view.presentation).toBe("delivered");
    expect(result.view.failureReason).toBeNull();
    expect(result.record?.settleStatus).toBe("readable");
    expect(result.view.reasonLabel).toBeNull();

    const preview = resolveFormalPreviewAbsolutePath({
      formalRoot: {
        ok: true,
        kind: "personal",
        rootPath: roots.agentWorkspaceRoot ?? "",
        bindingId: "formal:test",
        resourceIdentity: "personal:user-elle",
      },
      relativePath: RELATIVE,
    });
    expect(preview).toBe(path.join(dirs.operators, RELATIVE));
    expect(fs.readFileSync(preview).equals(PDF_BYTES)).toBe(true);
    expect(fs.existsSync(path.join(dirs.volumeTenants, RELATIVE))).toBe(false);
    expect(fs.existsSync(path.join(dirs.stateTenants, RELATIVE))).toBe(false);
  });

  it("keeps binary_requires_tool_write when neither shape has the PDF", () => {
    const dirs = layout();
    const result = publish(dirs, declarePdf());
    expect(result.view.presentation).toBe("undelivered");
    expect(result.record?.settleStatus).toBe("unwritten");
    expect(result.view.failureReason).toBe("binary_requires_tool_write");
    expect(result.view.reasonLabel).toBe("文件缺失或为空");
    expect(result.text).toContain("分析结论仍然有效。");
    expect(result.text).not.toMatch(/点预览就能打开|可以直接打开/);
    expect(fs.existsSync(path.join(dirs.operators, RELATIVE))).toBe(false);
  });

  it("does not deliver a PDF that exists only on the skewed sibling tree", () => {
    const dirs = layout();
    writeAt(dirs.volumeTenants, RELATIVE, PDF_BYTES);
    writeAt(dirs.stateTenants, RELATIVE, PDF_BYTES);

    const result = publish(dirs, declarePdf());
    expect(result.view.presentation).toBe("undelivered");
    expect(result.record?.settleStatus).toBe("unwritten");
    expect(result.view.failureReason).toBe("workspace_root_skew");
    expect(result.view.reasonLabel).toBe("文件缺失或为空");
    expect(result.text).toContain("分析结论仍然有效。");
    expect(result.text).not.toMatch(/点预览就能打开|可以直接打开/);
    expect(fs.existsSync(path.join(dirs.operators, RELATIVE))).toBe(false);
    expect(fs.readFileSync(path.join(dirs.volumeTenants, RELATIVE)).equals(PDF_BYTES)).toBe(true);
    expect(fs.readFileSync(path.join(dirs.stateTenants, RELATIVE)).equals(PDF_BYTES)).toBe(true);
  });

  it("does not treat disagreeing checksums on the two shapes as delivered", () => {
    const dirs = layout();
    const other = Buffer.from("%PDF-1.4\nother-tree\n%%EOF\n");
    writeAt(dirs.operators, RELATIVE, PDF_BYTES);
    writeAt(dirs.volumeTenants, RELATIVE, other);

    const result = publish(dirs, declarePdf());
    expect(result.view.presentation).toBe("undelivered");
    expect(result.view.failureReason).toBe("workspace_root_skew");
    expect(fs.readFileSync(path.join(dirs.operators, RELATIVE)).equals(PDF_BYTES)).toBe(true);
    expect(fs.readFileSync(path.join(dirs.volumeTenants, RELATIVE)).equals(other)).toBe(true);
  });

  it("still materializes a text envelope onto the formal root", () => {
    const dirs = layout();
    const relative = "notes/brief.md";
    const text = [
      "三张表的字段与口径草案已写入工作区。",
      `<<DELIVERABLE title="建模底稿" type="doc" file="${relative}">>`,
      "# 电力密度",
      "",
      "传导链从电力密度到散热。",
      "<</DELIVERABLE>>",
    ].join("\n");

    const result = publish(dirs, text);
    expect(result.view.presentation).toBe("delivered");
    expect(result.view.failureReason).toBeNull();
    expect(result.record?.settleStatus).toBe("readable");
    expect(fs.readFileSync(path.join(dirs.operators, relative), "utf8")).toContain("电力密度");
    expect(fs.existsSync(path.join(dirs.volumeTenants, relative))).toBe(false);
    expect(fs.existsSync(path.join(dirs.stateTenants, relative))).toBe(false);
  });

  it("keeps group reserved paths and version conflicts unchanged", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-formal-group-"));
    tempDirs.push(stateDir);
    const agent = path.join(stateDir, "agent");
    const group = path.join(stateDir, "group");
    fs.mkdirSync(path.join(group, "runtime"), { recursive: true });
    const reserved = settleDeclaredDeliverableText({
      text: '<<DELIVERABLE title="日志" file="runtime/transcript.md">>正文<</DELIVERABLE>>',
      agentWorkspaceRoot: null,
      groupWorkspaceRoot: group,
    });
    expect(reserved.status).toBe("unwritten");
    expect(reserved.reason).toBe("group_reserved_path");
    expect(fs.existsSync(path.join(group, "runtime/transcript.md"))).toBe(false);

    const relative = "analysis/model.md";
    const oldBytes = Buffer.from("# OLD group draft\npreview stays here\n", "utf8");
    const newBody = "# NEW bot deliverable\n\nThis revision must stay a conflict.\n";
    writeAt(group, relative, oldBytes);
    writeAt(agent, relative, newBody);
    const conflict = settleDeclaredDeliverableText({
      text: [
        "已写入工作区。",
        `<<DELIVERABLE title="底稿" file="${relative}">>`,
        newBody,
        "<</DELIVERABLE>>",
      ].join("\n"),
      agentWorkspaceRoot: agent,
      groupWorkspaceRoot: group,
    });
    expect(conflict.status).toBe("conflict");
    expect(conflict.reason).toBe("version_conflict");
    expect(fs.readFileSync(path.join(group, relative)).equals(oldBytes)).toBe(true);
  });

  it("uses operators when data.mode is only in config and the tenants volume is not stateDir/tenants", () => {
    const dirs = layout();
    const env: NodeJS.ProcessEnv = { ...dirs.env };
    delete env.OPENBOT_DATA_MODE;
    delete env.OPENCLAW_DATA_MODE;
    writeAt(dirs.operators, RELATIVE, PDF_BYTES);

    const resolved = resolveFormalAgentWorkspace({
      agentId: dirs.agentId,
      tenantId: dirs.tenantId,
      userId: dirs.userId,
      stateDir: dirs.stateDir,
      cfg: dirs.cfg,
      env,
      ensureDirectory: true,
    });
    expect(resolved?.rootPath).toBe(path.resolve(dirs.operators));
    expect(fs.existsSync(dirs.operators)).toBe(true);
    expect(fs.existsSync(dirs.stateTenants)).toBe(false);
    expect(fs.existsSync(dirs.volumeTenants)).toBe(false);

    const roots = resolveCollaborationDeliverableRoots({
      agentId: dirs.agentId,
      tenantId: dirs.tenantId,
      userId: dirs.userId,
      stateDir: dirs.stateDir,
      cfg: dirs.cfg,
      env,
    });
    expect(roots.agentWorkspaceRoot).toBe(path.resolve(dirs.operators));
    expect(roots.siblingAgentWorkspaceRoots).toContain(path.resolve(dirs.volumeTenants));
    expect(roots.siblingAgentWorkspaceRoots).toContain(path.resolve(dirs.stateTenants));
  });
});
