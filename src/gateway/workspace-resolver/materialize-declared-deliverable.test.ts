import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  materializeDeclaredDeliverableAtPlacedRoot,
  materializeDeclaredDeliverableInWorkspace,
} from "./materialize-declared-deliverable.js";
import { resolvePlacedFilesystemWriteRoot, resolveRobotOwnWriteRoot } from "./write-roots.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("materializeDeclaredDeliverableInWorkspace", () => {
  it("places a declared deliverable in the robot-own workspace so preview cannot miss an unplaced-only file", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-deliv-place-"));
    tempDirs.push(stateDir);

    const robotOwn = resolveRobotOwnWriteRoot({
      stateDir,
      tenantId: "001",
      userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
      agentId: "main",
    });

    // Simulate the observed bug: bytes exist only under an unplaced/classified pollution path.
    const unplacedOnly = path.join(
      stateDir,
      "unplaced:",
      "classified",
      "ws:001:user:90fed19a-1c8b-4420-87e0-bcc6165e32fa:asset:demo",
    );
    fs.mkdirSync(unplacedOnly, { recursive: true });
    fs.writeFileSync(
      path.join(unplacedOnly, "longrun-compare-20261003.md"),
      "# only under unplaced\n",
      "utf8",
    );

    // Preview reads workspace-relative paths under the placed robot-own root — miss today.
    expect(fs.existsSync(path.join(robotOwn, "longrun-compare-20261003.md"))).toBe(false);

    const placedRoot = resolvePlacedFilesystemWriteRoot({
      locator: "unplaced://classified/ws:001:user:90fed19a-1c8b-4420-87e0-bcc6165e32fa:asset:demo",
      agentId: "main",
      tenantId: "001",
      userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
      stateDir,
      ensureDirectory: true,
    });
    expect(placedRoot).toBe(robotOwn);

    const result = materializeDeclaredDeliverableAtPlacedRoot({
      catalogLocator:
        "unplaced://classified/ws:001:user:90fed19a-1c8b-4420-87e0-bcc6165e32fa:asset:demo",
      agentId: "main",
      tenantId: "001",
      userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
      stateDir,
      relativePath: "longrun-compare-20261003.md",
      content:
        "# example.com 与 example.org 对比\n\n## example.com\n\n- 页面标题：Example Domain\n",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.workspaceRoot).toBe(robotOwn);
    expect(result.relativePath).toBe("longrun-compare-20261003.md");

    // Workspace-relative read the preview pane performs must succeed.
    const previewBytes = fs.readFileSync(
      path.join(robotOwn, "longrun-compare-20261003.md"),
      "utf8",
    );
    expect(previewBytes).toContain("example.com 与 example.org 对比");
    expect(previewBytes).not.toContain("only under unplaced");
  });

  it("refuses to materialize into an unplaced/classified root (workspace-root write guard)", () => {
    const refusedUri = materializeDeclaredDeliverableInWorkspace({
      workspaceRoot: "unplaced://classified/ws:001:user:x:asset:main",
      relativePath: "report.md",
      content: "# should not land here\n",
    });
    expect(refusedUri).toEqual({ ok: false, reason: "workspace_root_unplaced" });

    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-deliv-guard-"));
    tempDirs.push(stateDir);
    const polluted = path.join(stateDir, "unplaced:", "classified", "ws:demo");
    const refusedPolluted = materializeDeclaredDeliverableInWorkspace({
      workspaceRoot: polluted,
      relativePath: "report.md",
      content: "# should not land here\n",
    });
    expect(refusedPolluted).toEqual({ ok: false, reason: "workspace_root_unplaced" });
    expect(fs.existsSync(path.join(polluted, "report.md"))).toBe(false);
  });

  it("refuses Downloads and another user's space instead of inventing a docx", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-deliv-contract-"));
    tempDirs.push(stateDir);
    const workspace = path.join(
      stateDir,
      "tenants",
      "001",
      "users",
      "user-a",
      "OpenBot",
      "agents",
      "main",
      "workspace",
    );
    const other = path.join(
      stateDir,
      "tenants",
      "001",
      "users",
      "user-b",
      "OpenBot",
      "agents",
      "main",
      "workspace",
      "人才回流.docx",
    );
    fs.mkdirSync(workspace, { recursive: true });
    const downloads = materializeDeclaredDeliverableInWorkspace({
      workspaceRoot: workspace,
      relativePath: "~/Downloads/人才回流.docx",
      content: "# markdown is not a docx\n",
    });
    const foreign = materializeDeclaredDeliverableInWorkspace({
      workspaceRoot: workspace,
      relativePath: other,
      content: "# markdown is not a docx\n",
    });
    expect(downloads.ok).toBe(false);
    expect(foreign.ok).toBe(false);
    expect(fs.existsSync(other)).toBe(false);
    expect(fs.existsSync(path.join(workspace, "人才回流.docx"))).toBe(false);
  });

  it("refuses path escape outside the workspace root", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-deliv-escape-"));
    tempDirs.push(stateDir);
    const workspace = path.join(stateDir, "workspace");
    fs.mkdirSync(workspace, { recursive: true });

    // normalizeDeliverableWorkspacePath strips `..` — double-check the guard still holds.
    const result = materializeDeclaredDeliverableInWorkspace({
      workspaceRoot: workspace,
      relativePath: "../outside.md",
      content: "secret\n",
    });
    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(stateDir, "outside.md"))).toBe(false);
  });

  it("refuses a zero-byte text declare and does not leave an empty file", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-deliv-empty-"));
    tempDirs.push(stateDir);
    const workspace = path.join(stateDir, "workspace");
    fs.mkdirSync(workspace, { recursive: true });

    const result = materializeDeclaredDeliverableInWorkspace({
      workspaceRoot: workspace,
      relativePath: "article-final.md",
      content: "",
    });
    expect(result).toEqual({ ok: false, reason: "empty_content" });
    expect(fs.existsSync(path.join(workspace, "article-final.md"))).toBe(false);
  });

  it("does not treat an existing zero-byte binary as a successful materialize", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-deliv-zero-bin-"));
    tempDirs.push(stateDir);
    const workspace = path.join(stateDir, "workspace");
    fs.mkdirSync(workspace, { recursive: true });
    const target = path.join(workspace, "Q3报告.docx");
    fs.writeFileSync(target, Buffer.alloc(0));

    const result = materializeDeclaredDeliverableInWorkspace({
      workspaceRoot: workspace,
      relativePath: "Q3报告.docx",
      content: "summary that must not overwrite the binary",
    });
    expect(result).toEqual({ ok: false, reason: "empty_write" });
    expect(fs.statSync(target).size).toBe(0);
  });

  it("materializes a declared markdown file with size greater than zero", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-deliv-article-"));
    tempDirs.push(stateDir);
    const workspace = path.join(stateDir, "workspace");
    fs.mkdirSync(workspace, { recursive: true });
    const body = "# 终稿\n\n正文已经落盘，预览应能打开。\n";

    const result = materializeDeclaredDeliverableInWorkspace({
      workspaceRoot: workspace,
      relativePath: "article-final.md",
      content: body,
    });
    expect(result.ok).toBe(true);
    const written = path.join(workspace, "article-final.md");
    expect(fs.statSync(written).size).toBeGreaterThan(0);
    expect(fs.readFileSync(written, "utf8")).toBe(body);
  });

  it("does not overwrite a non-empty file with the envelope summary", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-deliv-keep-"));
    tempDirs.push(stateDir);
    const workspace = path.join(stateDir, "workspace");
    const target = path.join(workspace, "article-final.md");
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(target, "# 工具真稿\n");

    const result = materializeDeclaredDeliverableInWorkspace({
      workspaceRoot: workspace,
      relativePath: "article-final.md",
      content: "# 摘要\n\n这不是文件正文。\n",
    });
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toBe("# 工具真稿\n");
  });
});
