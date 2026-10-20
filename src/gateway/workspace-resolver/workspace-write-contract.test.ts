import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  WORKSPACE_WRITE_AMBIGUOUS_MESSAGE,
  WORKSPACE_WRITE_DOWNLOADS_MESSAGE,
  WORKSPACE_WRITE_FOREIGN_MESSAGE,
  WORKSPACE_WRITE_MEDIA_STUB_MESSAGE,
  WORKSPACE_WRITE_OUTSIDE_MESSAGE,
  pathBelongsToBot,
  resolveWorkspaceWriteLocator,
} from "./workspace-write-contract.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempDirs.push(dir);
  return dir;
}

function botSpace(root: string, userId: string, agentId = "agt-hr"): string {
  return path.join(
    root,
    "tenants",
    "001",
    "users",
    userId,
    "OpenBot",
    "agents",
    agentId,
    "workspace",
  );
}

describe("resolveWorkspaceWriteLocator", () => {
  it("rewrites an absolute path inside the bot space to the workspace-relative path", () => {
    const root = tempDir("openbot-write-contract-");
    const space = botSpace(root, "user-a");
    fs.mkdirSync(space, { recursive: true });
    const absolute = path.join(space, "reports", "人才回流.docx");
    const decision = resolveWorkspaceWriteLocator({
      workspaceRoot: space,
      requestedPath: absolute,
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) {
      return;
    }
    expect(decision.relativePath).toBe("reports/人才回流.docx");
    expect(decision.absolutePath).toBe(path.resolve(space, "reports", "人才回流.docx"));
    expect(decision.rewritten).toBe(true);
  });

  it("refuses home Downloads and a path outside the workspace", () => {
    const root = tempDir("openbot-write-outside-");
    const space = botSpace(root, "user-a");
    fs.mkdirSync(space, { recursive: true });
    const downloads = resolveWorkspaceWriteLocator({
      workspaceRoot: space,
      requestedPath: "~/Downloads/人才回流.docx",
      homeDir: path.join(root, "home"),
    });
    expect(downloads).toMatchObject({ ok: false, message: WORKSPACE_WRITE_DOWNLOADS_MESSAGE });
    const outside = resolveWorkspaceWriteLocator({
      workspaceRoot: space,
      requestedPath: path.join(root, "tmp", "人才回流.docx"),
    });
    expect(outside).toMatchObject({ ok: false, message: WORKSPACE_WRITE_OUTSIDE_MESSAGE });
    expect(fs.existsSync(path.join(root, "home", "Downloads", "人才回流.docx"))).toBe(false);
  });

  it("refuses a write into another user's bot space", () => {
    const root = tempDir("openbot-write-foreign-");
    const spaceA = botSpace(root, "user-a");
    const spaceB = botSpace(root, "user-b");
    fs.mkdirSync(spaceA, { recursive: true });
    fs.mkdirSync(spaceB, { recursive: true });
    const target = path.join(spaceB, "reports", "人才回流.docx");
    const decision = resolveWorkspaceWriteLocator({
      workspaceRoot: spaceA,
      requestedPath: target,
    });
    expect(decision).toMatchObject({
      ok: false,
      code: "foreign_space",
      message: WORKSPACE_WRITE_FOREIGN_MESSAGE,
    });
    expect(pathBelongsToBot(spaceB, "user-a", "agt-hr")).toBe(false);
    expect(pathBelongsToBot(spaceA, "user-a", "agt-hr")).toBe(true);
  });

  it("refuses a bare office name at the install checkout and keeps a nested relative path", () => {
    const install = tempDir("openbot-write-install-");
    fs.mkdirSync(path.join(install, ".git"));
    fs.writeFileSync(
      path.join(install, "package.json"),
      JSON.stringify({ name: "@upbeyond/openbot" }),
    );
    const bare = resolveWorkspaceWriteLocator({
      workspaceRoot: install,
      requestedPath: "人才回流.docx",
    });
    expect(bare).toMatchObject({ ok: false, message: WORKSPACE_WRITE_AMBIGUOUS_MESSAGE });
    const nested = resolveWorkspaceWriteLocator({
      workspaceRoot: install,
      requestedPath: "reports/人才回流.docx",
    });
    expect(nested.ok).toBe(true);
    if (nested.ok) {
      expect(nested.relativePath).toBe("reports/人才回流.docx");
    }
  });

  it("allows mkdir of the workspace root itself", () => {
    const root = tempDir("openbot-write-root-mkdir-");
    const space = botSpace(root, "user-a");
    fs.mkdirSync(space, { recursive: true });
    const decision = resolveWorkspaceWriteLocator({
      workspaceRoot: space,
      requestedPath: space,
      purpose: "directory",
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.relativePath).toBe("");
      expect(decision.absolutePath).toBe(path.resolve(space));
    }
  });

  it("allows a bare office name at the bot's own workspace root", () => {
    const root = tempDir("openbot-write-bare-own-");
    const space = botSpace(root, "user-a");
    fs.mkdirSync(space, { recursive: true });
    const decision = resolveWorkspaceWriteLocator({
      workspaceRoot: space,
      requestedPath: "人才回流.docx",
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.relativePath).toBe("人才回流.docx");
    }
  });

  it("refuses a media upload zip stub", () => {
    const root = tempDir("openbot-write-zip-");
    const space = botSpace(root, "user-a");
    fs.mkdirSync(space, { recursive: true });
    const decision = resolveWorkspaceWriteLocator({
      workspaceRoot: space,
      requestedPath: "media/inbound/11111111-1111-4111-8111-111111111111/人才回流.zip",
    });
    expect(decision).toMatchObject({
      ok: false,
      code: "media_zip_stub",
      message: WORKSPACE_WRITE_MEDIA_STUB_MESSAGE,
    });
  });

  it("keeps an operators remount of the same user and agent", () => {
    const root = tempDir("openbot-write-operators-");
    const operators = path.join(
      root,
      "operators",
      "user-a",
      "OpenBot",
      "agents",
      "agt-hr",
      "workspace",
    );
    fs.mkdirSync(operators, { recursive: true });
    expect(pathBelongsToBot(operators, "user-a", "agt-hr")).toBe(true);
    const decision = resolveWorkspaceWriteLocator({
      workspaceRoot: operators,
      requestedPath: "reports/人才回流.docx",
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.absolutePath.startsWith(operators)).toBe(true);
    }
  });
});
