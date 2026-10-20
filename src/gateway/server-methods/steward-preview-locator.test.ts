import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectTenantUserAgentWorkspaceDirs,
  isExistingWorkspaceDirectory,
  resolvePreviewFilesystemLocator,
  resolveTenantUserAgentWorkspaceDir,
  canonicalPreviewOutputRelPath,
  resolveUniqueImmediatePreviewRelPath,
  resolveAuthorizedPreviewRelativePath,
  previewTrustedRoots,
  readUniquePreviewFile,
} from "./steward-preview-locator.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolvePreviewFilesystemLocator", () => {
  it("keeps a trusted locator that is an existing directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-preview-trusted-"));
    tempDirs.push(dir);
    expect(
      resolvePreviewFilesystemLocator({
        trustedLocator: dir,
        configuredWorkspace: "/tmp/configured-should-not-win",
        agentId: "bot-skill",
        stateDir: "/tmp/state",
      }),
    ).toBe(path.resolve(dir));
  });

  it("prefers an existing runtime write workspace over a stale configured checkout", () => {
    const live = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-preview-live-"));
    tempDirs.push(live);
    expect(
      resolvePreviewFilesystemLocator({
        trustedLocator: "unplaced://classified/ws:001:user:x:asset:main",
        runtimeWorkspaces: [live],
        configuredWorkspace: "/Users/daniel/AI项目/openbot",
        agentId: "main",
        stateDir: "/tmp/state",
      }),
    ).toBe(path.resolve(live));
  });

  it("maps tenant-user agent workspaces for any agent id", () => {
    expect(
      resolveTenantUserAgentWorkspaceDir({
        stateDir: "/tmp/openbot-state",
        tenantId: "001",
        userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
        agentId: "bot-skill",
      }),
    ).toBe(
      path.resolve(
        "/tmp/openbot-state/tenants/001/users/90fed19a-1c8b-4420-87e0-bcc6165e32fa/OpenBot/agents/bot-skill/workspace",
      ),
    );
  });

  it("resolves a unique bare basename in an immediate subdirectory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-preview-basename-"));
    tempDirs.push(dir);
    fs.mkdirSync(path.join(dir, "competitor-price"));
    fs.writeFileSync(path.join(dir, "competitor-price", "report.md"), "# ok\n");
    expect(resolveUniqueImmediatePreviewRelPath(dir, "report.md")).toBe(
      "competitor-price/report.md",
    );
  });

  it("does not rewrite a missing deliverables/<basename> onto a sibling folder", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-preview-deliverables-"));
    tempDirs.push(dir);
    fs.mkdirSync(path.join(dir, "competitor-price"));
    fs.writeFileSync(path.join(dir, "competitor-price", "report.md"), "# ok\n");
    expect(resolveUniqueImmediatePreviewRelPath(dir, "deliverables/report.md")).toBeNull();
  });

  it("keeps an existing deliverables/ path instead of rewriting", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-preview-deliverables-hit-"));
    tempDirs.push(dir);
    fs.mkdirSync(path.join(dir, "deliverables"));
    fs.writeFileSync(path.join(dir, "deliverables", "report.md"), "# deliverable\n");
    fs.mkdirSync(path.join(dir, "competitor-price"));
    fs.writeFileSync(path.join(dir, "competitor-price", "report.md"), "# other\n");
    expect(resolveUniqueImmediatePreviewRelPath(dir, "deliverables/report.md")).toBeNull();
  });

  it("lists existing tenant-user workspaces for a user+agent", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-preview-tenants-"));
    tempDirs.push(stateDir);
    const live = resolveTenantUserAgentWorkspaceDir({
      stateDir,
      tenantId: "001",
      userId: "user-elle",
      agentId: "main",
    });
    fs.mkdirSync(live, { recursive: true });
    expect(
      collectTenantUserAgentWorkspaceDirs({
        stateDir,
        userId: "user-elle",
        agentId: "main",
      }),
    ).toEqual([live]);
  });

  it("resolves a unique basename one task folder under reports/", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-preview-nested-pdf-"));
    tempDirs.push(dir);
    const topic = path.join(dir, "reports", "通州妇产医院后勤精简");
    fs.mkdirSync(topic, { recursive: true });
    fs.writeFileSync(path.join(topic, "首谈纲要.pdf"), "%PDF-1.4\n");
    expect(resolveUniqueImmediatePreviewRelPath(dir, "首谈纲要.pdf")).toBe(
      "reports/通州妇产医院后勤精简/首谈纲要.pdf",
    );
    expect(readUniquePreviewFile(dir, "首谈纲要.pdf")?.relativePath).toBe(
      "reports/通州妇产医院后勤精简/首谈纲要.pdf",
    );
    expect(readUniquePreviewFile(dir, "首谈纲要.pdf")?.buffer.subarray(0, 5).toString()).toBe(
      "%PDF-",
    );
  });

  it("resolves a unique agent pptx under pages/ or output/pptx/", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-preview-nested-pptx-"));
    tempDirs.push(dir);
    const pages = path.join(dir, "pages", "通州方案");
    fs.mkdirSync(pages, { recursive: true });
    fs.writeFileSync(path.join(pages, "客户演示版.pptx"), "PK\u0003\u0004");
    expect(resolveUniqueImmediatePreviewRelPath(dir, "客户演示版.pptx")).toBe(
      "pages/通州方案/客户演示版.pptx",
    );

    const typed = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-preview-output-pptx-"));
    tempDirs.push(typed);
    fs.mkdirSync(path.join(typed, "output", "pptx"), { recursive: true });
    fs.writeFileSync(path.join(typed, "output", "pptx", "客户演示版.pptx"), "PK\u0003\u0004");
    expect(resolveUniqueImmediatePreviewRelPath(typed, "客户演示版.pptx")).toBe(
      "output/pptx/客户演示版.pptx",
    );
  });

  it("prefers contract output/html for a bare HTML basename", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-preview-output-html-"));
    tempDirs.push(dir);
    const name = "全球热点简报-2026-10-14.html";
    fs.mkdirSync(path.join(dir, "output", "html"), { recursive: true });
    fs.writeFileSync(path.join(dir, "output", "html", name), "<html><body>brief</body></html>");
    expect(resolveUniqueImmediatePreviewRelPath(dir, name)).toBe(`output/html/${name}`);
    expect(canonicalPreviewOutputRelPath(name)).toBe(`output/html/${name}`);
  });

  it("opens a pptx published under reports/<topic>/deliver/ without copying it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-preview-deliver-pptx-"));
    tempDirs.push(dir);
    const name = "通州妇产医院后勤管理岗位精简优化方案_客户演示版.pptx";
    const topic = path.join(dir, "reports", "通州妇产医院后勤精简");
    fs.mkdirSync(path.join(topic, "deliver"), { recursive: true });
    fs.mkdirSync(path.join(topic, "build_deck"), { recursive: true });
    fs.writeFileSync(path.join(topic, "deliver", name), "PK-deliver");
    fs.writeFileSync(path.join(topic, "build_deck", name), "PK-deck");
    expect(resolveUniqueImmediatePreviewRelPath(dir, name)).toBe(
      `reports/通州妇产医院后勤精简/deliver/${name}`,
    );
    expect(canonicalPreviewOutputRelPath(name)).toBe(`output/pptx/${name}`);
    expect(fs.existsSync(path.join(dir, "output", "pptx", name))).toBe(false);
  });

  it("does not guess when the same basename exists in two task folders", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-preview-nested-ambiguous-"));
    tempDirs.push(dir);
    for (const topic of ["topic-a", "topic-b"]) {
      const folder = path.join(dir, "reports", topic);
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, "brief.pdf"), "%PDF-1.4\n");
    }
    expect(resolveUniqueImmediatePreviewRelPath(dir, "brief.pdf")).toBeNull();
  });

  it("does not guess when the same basename exists in two subdirectories", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-preview-ambiguous-"));
    tempDirs.push(dir);
    fs.mkdirSync(path.join(dir, "a"));
    fs.mkdirSync(path.join(dir, "b"));
    fs.writeFileSync(path.join(dir, "a", "notes.md"), "a");
    fs.writeFileSync(path.join(dir, "b", "notes.md"), "b");
    expect(resolveUniqueImmediatePreviewRelPath(dir, "notes.md")).toBeNull();
  });

  it("skips unplaced catalog locators and does not use configured list workspace", () => {
    expect(() =>
      resolvePreviewFilesystemLocator({
        trustedLocator: "unplaced://classified/ws:001:user:x:asset:bot-skill",
        configuredWorkspace: "/Users/daniel/.openbot/workspace-bot-skill",
        agentId: "bot-skill",
        stateDir: "/tmp/state",
      }),
    ).toThrow(/refusing host workspace-<id>/);
  });

  it("skips a missing trusted directory and does not use configured list workspace", () => {
    expect(() =>
      resolvePreviewFilesystemLocator({
        trustedLocator: "/tmp/openbot-missing-trusted-workspace",
        configuredWorkspace: "/Users/daniel/.openbot/workspace-bot-skill",
        agentId: "bot-skill",
        stateDir: "/tmp/state",
      }),
    ).toThrow(/refusing host workspace-<id>/);
  });

  it("uses a non-git default workspace instead of host workspace-<id>", () => {
    const fallback = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-preview-default-"));
    tempDirs.push(fallback);
    expect(
      resolvePreviewFilesystemLocator({
        trustedLocator: null,
        configuredWorkspace: "/Users/daniel/AI项目/openbot",
        configuredDefaultWorkspace: fallback,
        agentId: "bot-skill",
        stateDir: "/tmp/openbot-state",
      }),
    ).toBe(path.resolve(fallback));
  });

  it("refuses host workspace-<id> when no default exists", () => {
    expect(() =>
      resolvePreviewFilesystemLocator({
        trustedLocator: null,
        configuredWorkspace: "  ",
        agentId: "bot-skill",
        stateDir: "/tmp/openbot-state",
      }),
    ).toThrow(/refusing host workspace-<id>/);
  });

  it("rejects classified URIs as filesystem directories", () => {
    expect(isExistingWorkspaceDirectory("unplaced://classified/ws:001:asset:x")).toBe(false);
    expect(isExistingWorkspaceDirectory("")).toBe(false);
  });
});

describe("resolveAuthorizedPreviewRelativePath", () => {
  it("maps a container path and a gateway path to the nested file, not a twin", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-preview-map-"));
    tempDirs.push(dir);
    fs.mkdirSync(path.join(dir, "campaigns", "october"), { recursive: true });
    fs.writeFileSync(path.join(dir, "campaigns", "october", "article.html"), "nested");
    fs.writeFileSync(path.join(dir, "article.html"), "twin");
    const roots = previewTrustedRoots(dir);
    const mapped = resolveAuthorizedPreviewRelativePath({
      requested: "/account/workspace/campaigns/october/article.html",
      workspaceRoot: dir,
      trustedRoots: roots,
    });
    expect(mapped).toEqual({
      ok: true,
      relativePath: "campaigns/october/article.html",
      kind: "mapped",
    });
    const read = readUniquePreviewFile(dir, "campaigns/october/article.html");
    expect(read?.buffer.toString()).toBe("nested");
    expect(
      resolveAuthorizedPreviewRelativePath({
        requested: path.join(dir, "campaigns", "october", "article.html"),
        workspaceRoot: dir,
        trustedRoots: roots,
      }),
    ).toEqual({
      ok: true,
      relativePath: "campaigns/october/article.html",
      kind: "mapped",
    });
  });

  it("does not basename an outside absolute path or a prefix sibling", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-preview-outside-"));
    tempDirs.push(dir);
    const roots = previewTrustedRoots(dir);
    expect(
      resolveAuthorizedPreviewRelativePath({
        requested: "/tmp/campaigns/october/article.html",
        workspaceRoot: dir,
        trustedRoots: roots,
      }).ok,
    ).toBe(false);
    expect(
      resolveAuthorizedPreviewRelativePath({
        requested: `${dir}-evil/article.html`,
        workspaceRoot: dir,
        trustedRoots: roots,
      }).ok,
    ).toBe(false);
  });
});

describe("resolveUniqueImmediatePreviewRelPath legacy media embed", () => {
  it("opens bare file= against a legacy {name}---{uuid}.ext on disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-preview-legacy-embed-"));
    tempDirs.push(dir);
    const embedded = "协作小组自运行体系设计-2026-10-15---22a3c012-e5f6-7890-abcd-ef1234567890.md";
    fs.writeFileSync(path.join(dir, embedded), "# design\n");
    expect(resolveUniqueImmediatePreviewRelPath(dir, "协作小组自运行体系设计-2026-10-15.md")).toBe(
      embedded,
    );
    const read = readUniquePreviewFile(dir, "协作小组自运行体系设计-2026-10-15.md");
    expect(read?.relativePath).toBe(embedded);
    expect(read?.buffer.toString("utf8")).toContain("# design");
  });

  it("prefers a true bare file over a legacy embed of the same name", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-preview-bare-wins-"));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, "report.md"), "bare\n");
    fs.writeFileSync(
      path.join(dir, "report---a1b2c3d4-e5f6-7890-abcd-ef1234567890.md"),
      "legacy\n",
    );
    expect(resolveUniqueImmediatePreviewRelPath(dir, "report.md")).toBe("report.md");
  });
});
