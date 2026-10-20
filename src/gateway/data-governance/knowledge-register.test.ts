import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildLocalFolderDocId } from "../knowledge/sources/local-folder-runtime.js";
import {
  activateKnowledgeGovernanceRegistration,
  beginKnowledgeGovernanceRegistration,
  buildKnowledgeResourceId,
} from "./knowledge-register.js";
import { writeGovernanceOpMarker } from "./operation-marker.js";
import {
  getSharedDataGovernanceCatalog,
  resetSharedDataGovernanceCatalogForTests,
} from "./runtime-catalog.js";

const tempDirs: string[] = [];
afterEach(() => {
  resetSharedDataGovernanceCatalogForTests();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("knowledge governance registration (P1-2-a)", () => {
  it("builds frozen grain resource ids for doc version and projection", () => {
    expect(
      buildKnowledgeResourceId({
        tenantId: "t1",
        contentClass: "document_version",
        docId: "doc-1",
        versionId: "v3",
      }),
    ).toBe("knowledge:t1:doc:doc-1:v3");
    expect(
      buildKnowledgeResourceId({
        tenantId: null,
        contentClass: "enterprise_projection",
        projectionId: "proj-9",
      }),
    ).toBe("knowledge:local:projection:proj-9");
  });

  it("accepts a generated local-folder docId and still rejects legacy lfdoc: ids", () => {
    const docId = buildLocalFolderDocId("src-folder", "notes/a.pdf");
    expect(
      buildKnowledgeResourceId({
        tenantId: "t1",
        contentClass: "document_version",
        docId,
        versionId: "v1",
      }),
    ).toBe(`knowledge:t1:doc:${docId}:v1`);

    expect(() =>
      buildKnowledgeResourceId({
        tenantId: "t1",
        contentClass: "document_version",
        docId: `lfdoc:${"ab".repeat(14)}`,
        versionId: "v1",
      }),
    ).toThrow("governance_knowledge_invalid:docId");
  });

  it("registers pending→active Knowledge Asset with canonical + derived index bindings", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-know-"));
    tempDirs.push(stateDir);
    const canonicalLocator = path.join(stateDir, "docs", "doc-1-v1.json");
    const indexLocator = path.join(stateDir, "index", "personal.db");
    fs.mkdirSync(path.dirname(canonicalLocator), { recursive: true });
    fs.writeFileSync(canonicalLocator, "{}\n");

    const { resourceId } = await beginKnowledgeGovernanceRegistration({
      stateDir,
      tenantId: "t1",
      owner: { kind: "user", userId: "u1" },
      scope: { kind: "user", userId: "u1" },
      contentClass: "document_version",
      docId: "doc-1",
      versionId: "v1",
      kbId: "kb-a",
      canonicalLocator,
      indexLocator,
    });

    const catalog = getSharedDataGovernanceCatalog({ stateDir });
    const pending = await catalog.get(resourceId);
    expect(pending?.envelope.lifecycleState).toBe("pending");
    expect(pending?.envelope.resourceType).toBe("knowledge");
    expect(pending?.envelope.projection?.contentClass).toBe("document_version");
    expect(pending?.bindings.some((b) => b.role === "canonical")).toBe(true);
    expect(pending?.bindings.some((b) => b.role === "derived")).toBe(true);

    await activateKnowledgeGovernanceRegistration({ resourceId, stateDir });
    const active = await catalog.get(resourceId);
    expect(active?.envelope.lifecycleState).toBe("active");
    expect(active?.envelope.governanceVersion).toBeGreaterThan(pending!.envelope.governanceVersion);
  });

  it("does not store knowledge bodies in Catalog projection", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-know-body-"));
    tempDirs.push(stateDir);
    const canonicalLocator = path.join(stateDir, "body.md");
    fs.writeFileSync(canonicalLocator, "# secret knowledge body\n");
    writeGovernanceOpMarker({
      targetPath: canonicalLocator,
      operationId: "op-k1",
      kind: "file",
    });

    const { resourceId } = await beginKnowledgeGovernanceRegistration({
      stateDir,
      tenantId: "t1",
      owner: { kind: "user", userId: "u1" },
      scope: { kind: "user", userId: "u1" },
      contentClass: "document_version",
      docId: "doc-body",
      versionId: "v1",
      canonicalLocator,
    });
    await activateKnowledgeGovernanceRegistration({ resourceId, stateDir });

    const record = await getSharedDataGovernanceCatalog({ stateDir }).get(resourceId);
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("secret knowledge body");
    expect(record?.envelope.projection?.docId).toBe("doc-body");
  });
});
