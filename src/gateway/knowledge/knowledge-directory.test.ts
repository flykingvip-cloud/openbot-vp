// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  KNOWLEDGE_INDEX_DIRNAME,
  KNOWLEDGE_LEGACY_INDEX_DIRNAME,
  listKnowledgeFolderFiles,
  listKnowledgeIndexDbPaths,
  readKnowledgeFolderFile,
  resolveKnowledgeDirectoryLayout,
  resolveKnowledgeDirectoryLayoutForBase,
  resolveKnowledgeIndexRootForBase,
  writeKnowledgeFolderFile,
} from "./knowledge-directory.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-dir-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("knowledge-directory", () => {
  it("keeps local fallback on legacy knowledge/index", () => {
    const layout = resolveKnowledgeDirectoryLayout({
      ownerId: "user-a",
      configDir: tmpDir,
      tenantsRoot: path.join(tmpDir, "tenants"),
    });
    expect(layout.scope).toBe("local");
    expect(layout.knowledgeRoot).toBe(path.join(tmpDir, "knowledge"));
    expect(layout.indexRoot).toBe(path.join(tmpDir, "knowledge", KNOWLEDGE_LEGACY_INDEX_DIRNAME));
    expect(layout.deliverableFolderRoot).toBe(
      path.join(tmpDir, "knowledge", "folders", "personal-deliverables"),
    );
  });

  it("puts enterprise indexes at L1 and user 成果 folders at L2", () => {
    const tenantsRoot = path.join(tmpDir, "tenants");
    const enterprise = resolveKnowledgeDirectoryLayout({
      ownerId: "user-a",
      tenantId: "acme",
      visibility: "enterprise",
      reservedKind: "team_deliverables",
      tenantsRoot,
      configDir: tmpDir,
    });
    expect(enterprise.scope).toBe("tenant");
    expect(enterprise.knowledgeRoot).toBe(path.join(tenantsRoot, "acme", "shared", "knowledge"));
    expect(enterprise.indexRoot).toBe(
      path.join(tenantsRoot, "acme", "shared", "knowledge", KNOWLEDGE_INDEX_DIRNAME),
    );
    expect(enterprise.deliverableFolderRoot).toBe(
      path.join(tenantsRoot, "acme", "shared", "knowledge", "folders", "team-deliverables"),
    );

    const personal = resolveKnowledgeDirectoryLayout({
      ownerId: "user-a",
      tenantId: "acme",
      visibility: "private",
      reservedKind: "personal_deliverables",
      tenantsRoot,
      configDir: tmpDir,
    });
    expect(personal.scope).toBe("user");
    expect(personal.indexRoot).toBe(enterprise.indexRoot);
    expect(personal.originalsRoot).toBe(enterprise.originalsRoot);
    expect(personal.knowledgeRoot).toBe(
      path.join(tenantsRoot, "acme", "users", "user-a", "OpenBot", "shared", "knowledge"),
    );
    expect(personal.deliverableFolderRoot).toBe(
      path.join(personal.knowledgeRoot, "folders", "personal-deliverables"),
    );
  });

  it("writes browsable 成果 files under folders/", () => {
    const layout = resolveKnowledgeDirectoryLayoutForBase(
      {
        ownerId: "user-a",
        tenantId: null,
        visibility: "private",
        tags: ["openbot:personal-deliverables"],
        title: "个人成果",
      },
      { configDir: tmpDir, tenantsRoot: path.join(tmpDir, "tenants") },
    );
    const dest = writeKnowledgeFolderFile({
      layout,
      filename: "deliverables/weekly-brief.md",
      buffer: Buffer.from("# 周报\n", "utf8"),
    });
    expect(dest).toBe(path.join(layout.deliverableFolderRoot, "weekly-brief.md"));
    expect(fs.readFileSync(dest, "utf8")).toBe("# 周报\n");
    const readBack = readKnowledgeFolderFile({ layout, filename: "weekly-brief.md" });
    expect(readBack?.buffer.toString("utf8")).toBe("# 周报\n");
    expect(listKnowledgeFolderFiles({ layout }).map((item) => item.filename)).toEqual([
      "weekly-brief.md",
    ]);
  });

  it("lists index sqlite files from an explicit root", () => {
    const indexRoot = path.join(tmpDir, "index");
    fs.mkdirSync(path.join(indexRoot, "personal"), { recursive: true });
    const dbPath = path.join(indexRoot, "personal", "user-a.db");
    fs.writeFileSync(dbPath, "");
    expect(listKnowledgeIndexDbPaths({ indexRoot })).toEqual([dbPath]);
  });

  it("discovers tenant cloud indexes under shared/knowledge/.index", () => {
    const tenantsRoot = path.join(tmpDir, "tenants");
    const dbPath = path.join(
      tenantsRoot,
      "acme",
      "shared",
      "knowledge",
      KNOWLEDGE_INDEX_DIRNAME,
      "tenant",
      "acme.db",
    );
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, "");
    expect(
      listKnowledgeIndexDbPaths({
        configDir: tmpDir,
        tenantsRoot,
      }),
    ).toEqual([dbPath]);
  });

  it("resolveKnowledgeIndexRootForBase matches layout indexRoot and honors override", () => {
    const tenantsRoot = path.join(tmpDir, "tenants");
    const kb = {
      ownerId: "user-a",
      tenantId: "acme",
      visibility: "private" as const,
      tags: ["openbot:personal-deliverables"],
      title: "个人成果",
    };
    const layout = resolveKnowledgeDirectoryLayoutForBase(kb, { tenantsRoot, configDir: tmpDir });
    expect(resolveKnowledgeIndexRootForBase(kb, { tenantsRoot, configDir: tmpDir })).toBe(
      layout.indexRoot,
    );
    expect(layout.indexRoot).toContain(path.join("shared", "knowledge", KNOWLEDGE_INDEX_DIRNAME));
    expect(
      resolveKnowledgeIndexRootForBase(kb, {
        tenantsRoot,
        configDir: tmpDir,
        indexRoot: path.join(tmpDir, "explicit-index"),
      }),
    ).toBe(path.join(tmpDir, "explicit-index"));
  });
});
