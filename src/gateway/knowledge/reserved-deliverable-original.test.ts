// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setDeliverableArchiveRecord } from "./deliverables/archive-store.js";
import { knowledgeDocumentIdFromSkillRef } from "./document-display-title.js";
import { createKnowledgeBase } from "./knowledge-base-store.js";
import {
  resolveKnowledgeDirectoryLayoutForBase,
  writeKnowledgeFolderFile,
} from "./knowledge-directory.js";
import {
  deleteReservedDeliverableOriginal,
  listReservedDeliverableDocuments,
  readReservedDeliverableOriginal,
  reservedDeliverableDocumentId,
} from "./reserved-deliverable-original.js";

describe("reserved-deliverable-original", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("remaps leftover skill archive ids to kbdoc and reads the folder SoT", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-reserved-sot-"));
    roots.push(root);
    const kbStorePath = path.join(root, "bases.json");
    const archiveStorePath = path.join(root, "archives.json");
    const kb = createKnowledgeBase(
      {
        title: "个人成果",
        visibility: "private",
        ownerId: "user-a",
        tenantId: "acme",
      },
      kbStorePath,
    );
    const tenantsRoot = path.join(root, "tenants");
    const layout = resolveKnowledgeDirectoryLayoutForBase(kb, { tenantsRoot, configDir: root });
    writeKnowledgeFolderFile({
      layout,
      filename: "computer-browser-files-analysis-vs-openbot.md",
      buffer: Buffer.from("# 真文件\n", "utf8"),
    });
    setDeliverableArchiveRecord({
      deliverableId: "skill:skill_9b2c46eaedd4",
      knowledgeBaseId: kb.id,
      documentId: "skill_9b2c46eaedd4",
      filename: "computer-browser-files-analysis-vs-openbot.md",
      title: "浏览器文件分析",
      storePath: archiveStorePath,
    });

    const remapped = reservedDeliverableDocumentId({
      knowledgeBaseId: kb.id,
      filename: "computer-browser-files-analysis-vs-openbot.md",
      archive: {
        deliverableId: "skill:skill_9b2c46eaedd4",
        record: {
          knowledgeBaseId: kb.id,
          documentId: "skill_9b2c46eaedd4",
          filename: "computer-browser-files-analysis-vs-openbot.md",
          title: "浏览器文件分析",
          updatedAtMs: 1,
        },
      },
    });
    expect(remapped).toBe(knowledgeDocumentIdFromSkillRef(kb.id, "skill_9b2c46eaedd4"));

    const listed = listReservedDeliverableDocuments({
      knowledgeBase: kb,
      archiveStorePath,
      tenantsRoot,
      configDir: root,
    });
    expect(listed).toEqual([
      expect.objectContaining({
        documentId: remapped,
        title: "浏览器文件分析",
      }),
    ]);

    const read = readReservedDeliverableOriginal({
      knowledgeBaseId: kb.id,
      documentId: remapped,
      kbStorePath,
      archiveStorePath,
      tenantsRoot,
      configDir: root,
    });
    expect(read?.buffer.toString("utf8")).toContain("真文件");
  });

  it("lists and previews team reserved docs from group deliverables the same way as personal folders", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-team-reserved-sot-"));
    roots.push(root);
    const kbStorePath = path.join(root, "bases.json");
    const archiveStorePath = path.join(root, "archives.json");
    const tenantsRoot = path.join(root, "tenants");
    const team = createKnowledgeBase(
      {
        title: "团队成果",
        visibility: "team",
        ownerId: "user-a",
        tenantId: "acme",
        tags: ["openbot:team-deliverables"],
      },
      kbStorePath,
    );
    const personal = createKnowledgeBase(
      {
        title: "个人成果",
        visibility: "private",
        ownerId: "user-a",
        tenantId: "acme",
        tags: ["openbot:personal-deliverables"],
      },
      kbStorePath,
    );
    const groupDir = path.join(
      tenantsRoot,
      "acme",
      "collaboration",
      "groups",
      encodeURIComponent("grp-hrqb-163-com-权变管理专家"),
    );
    fs.mkdirSync(path.join(groupDir, "deliverables"), { recursive: true });
    fs.writeFileSync(
      path.join(groupDir, "deliverables", "一切都刚刚开始_第128期综述_发布版.docx"),
      Buffer.from("PK-team-sot", "utf8"),
    );
    fs.writeFileSync(
      path.join(groupDir, "deliverables", "skill_aaaaaaaaaaaa.md"),
      Buffer.from("hidden", "utf8"),
    );
    fs.mkdirSync(
      path.join(tenantsRoot, "acme", "collaboration", "groups", "grp-old.bak-1", "deliverables"),
      {
        recursive: true,
      },
    );
    fs.writeFileSync(
      path.join(
        tenantsRoot,
        "acme",
        "collaboration",
        "groups",
        "grp-old.bak-1",
        "deliverables",
        "stale.md",
      ),
      "stale",
    );
    fs.writeFileSync(
      path.join(groupDir, ".manifest.json"),
      JSON.stringify({
        version: 1,
        drafts: {
          "issue-128": {
            relativePath: "deliverables/一切都刚刚开始_第128期综述_发布版.docx",
            workspaceFilename: "一切都刚刚开始_第128期综述_发布版.docx",
            title: "第128期综述",
            deliverableId: "skill:skill_bbbbbbbbbbbb",
            updatedAtMs: 9,
          },
        },
        canonical: {},
      }),
    );

    const listed = listReservedDeliverableDocuments({
      knowledgeBase: team,
      archiveStorePath,
      tenantsRoot,
      configDir: root,
    });
    expect(listed).toEqual([
      expect.objectContaining({
        filename: "一切都刚刚开始_第128期综述_发布版.docx",
        title: "第128期综述",
        documentId: knowledgeDocumentIdFromSkillRef(team.id, "skill_bbbbbbbbbbbb"),
      }),
    ]);
    expect(
      listReservedDeliverableDocuments({
        knowledgeBase: personal,
        archiveStorePath,
        tenantsRoot,
        configDir: root,
      }),
    ).toEqual([]);

    const remapped = listed[0]?.documentId;
    expect(remapped).toBeTruthy();
    const read = readReservedDeliverableOriginal({
      knowledgeBaseId: team.id,
      documentId: remapped,
      kbStorePath,
      archiveStorePath,
      tenantsRoot,
      configDir: root,
    });
    expect(read?.buffer.toString("utf8")).toBe("PK-team-sot");

    const layout = resolveKnowledgeDirectoryLayoutForBase(team, { tenantsRoot, configDir: root });
    expect(
      fs.existsSync(
        path.join(layout.deliverableFolderRoot, "一切都刚刚开始_第128期综述_发布版.docx"),
      ),
    ).toBe(true);
  });

  it("lets the reserved team folder win over a same-named group workspace file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-team-folder-wins-"));
    roots.push(root);
    const kbStorePath = path.join(root, "bases.json");
    const tenantsRoot = path.join(root, "tenants");
    const team = createKnowledgeBase(
      {
        title: "团队成果",
        visibility: "team",
        ownerId: "user-a",
        tenantId: "acme",
      },
      kbStorePath,
    );
    const layout = resolveKnowledgeDirectoryLayoutForBase(team, { tenantsRoot, configDir: root });
    writeKnowledgeFolderFile({
      layout,
      filename: "ai-org-report.pdf",
      buffer: Buffer.from("folder-copy", "utf8"),
    });
    const groupDir = path.join(
      tenantsRoot,
      "acme",
      "collaboration",
      "groups",
      "grp-live",
      "deliverables",
    );
    fs.mkdirSync(groupDir, { recursive: true });
    fs.writeFileSync(path.join(groupDir, "ai-org-report.pdf"), "group-copy");

    const listed = listReservedDeliverableDocuments({
      knowledgeBase: team,
      tenantsRoot,
      configDir: root,
    });
    expect(listed).toHaveLength(1);
    const read = readReservedDeliverableOriginal({
      knowledgeBaseId: team.id,
      documentId: listed[0].documentId,
      kbStorePath,
      tenantsRoot,
      configDir: root,
    });
    expect(read?.buffer.toString("utf8")).toBe("folder-copy");
  });
  it("hides extensionless folder shells without deleting them; explicit delete still works", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-reserved-shell-"));
    roots.push(root);
    const kbStorePath = path.join(root, "bases.json");
    const kb = createKnowledgeBase(
      {
        title: "个人成果",
        visibility: "private",
        ownerId: "user-a",
        tenantId: "acme",
        tags: ["openbot:personal-deliverables"],
      },
      kbStorePath,
    );
    const tenantsRoot = path.join(root, "tenants");
    const layout = resolveKnowledgeDirectoryLayoutForBase(kb, { tenantsRoot, configDir: root });
    writeKnowledgeFolderFile({
      layout,
      filename: "图书室",
      buffer: Buffer.from("", "utf8"),
    });
    writeKnowledgeFolderFile({
      layout,
      filename: "UPBEYOND",
      buffer: Buffer.from("", "utf8"),
    });
    writeKnowledgeFolderFile({
      layout,
      filename: "手册.md",
      buffer: Buffer.from("# 手册\n", "utf8"),
    });

    const listed = listReservedDeliverableDocuments({
      knowledgeBase: kb,
      tenantsRoot,
      configDir: root,
    });
    expect(listed.map((item) => item.filename)).toEqual(["手册.md"]);
    // Listing is read-only: hidden shells stay on disk.
    expect(fs.existsSync(path.join(layout.deliverableFolderRoot, "图书室"))).toBe(true);
    expect(fs.existsSync(path.join(layout.deliverableFolderRoot, "UPBEYOND"))).toBe(true);

    const docId = listed[0].documentId;
    expect(
      deleteReservedDeliverableOriginal({
        knowledgeBase: kb,
        documentId: docId,
        tenantsRoot,
        configDir: root,
      }),
    ).toBe(true);
    expect(fs.existsSync(path.join(layout.deliverableFolderRoot, "手册.md"))).toBe(false);
    expect(fs.existsSync(path.join(layout.deliverableFolderRoot, "图书室"))).toBe(true);
    expect(fs.existsSync(path.join(layout.deliverableFolderRoot, "UPBEYOND"))).toBe(true);
  });

  it("never deletes any file when listing, including non-importable ones", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-reserved-readonly-"));
    roots.push(root);
    const kbStorePath = path.join(root, "bases.json");
    const tenantsRoot = path.join(root, "tenants");
    const bases = [
      createKnowledgeBase(
        {
          title: "个人成果",
          visibility: "private",
          ownerId: "user-a",
          tenantId: "acme",
          tags: ["openbot:personal-deliverables"],
        },
        kbStorePath,
      ),
      createKnowledgeBase(
        {
          title: "团队成果",
          visibility: "team",
          ownerId: "user-a",
          tenantId: "acme",
          tags: ["openbot:team-deliverables"],
        },
        kbStorePath,
      ),
    ];
    const files: Record<string, string> = {
      "report.json": '{"ok":true}',
      "page.html": "<html></html>",
      "bundle.zip": "PK\u0003\u0004zip-bytes",
      notes: "extensionless user notes",
      图书室: "",
      "clip.mp4": "video-bytes",
      "手册.md": "# 手册\n",
    };
    for (const kb of bases) {
      const layout = resolveKnowledgeDirectoryLayoutForBase(kb, { tenantsRoot, configDir: root });
      for (const [filename, content] of Object.entries(files)) {
        writeKnowledgeFolderFile({ layout, filename, buffer: Buffer.from(content, "utf8") });
      }
      for (let pass = 0; pass < 3; pass += 1) {
        listReservedDeliverableDocuments({ knowledgeBase: kb, tenantsRoot, configDir: root });
      }
      for (const [filename, content] of Object.entries(files)) {
        const filePath = path.join(layout.deliverableFolderRoot, filename);
        expect(fs.existsSync(filePath), `${kb.title}/${filename} must survive listing`).toBe(true);
        expect(fs.readFileSync(filePath, "utf8")).toBe(content);
      }
    }
  });
});
