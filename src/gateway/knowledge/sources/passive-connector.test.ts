import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ownershipProofFromLocalUser } from "../../data-governance/ownership-proof.js";
import { computeRawContentHash } from "../document-fingerprint.js";
import { createKnowledgeBase, getKnowledgeBase } from "../knowledge-base-store.js";
import { isLocalFolderDocId } from "./local-folder-runtime.js";
import { listPassiveConnectorProviders } from "./passive-connector-providers.js";
import {
  bindPassiveConnector,
  commitPassiveConnectorSync,
  listPassiveConnectorStatus,
  planPassiveConnectorSync,
  unbindPassiveConnector,
} from "./passive-connector-runtime.js";
import { isPassiveConnectorKind } from "./passive-connector-types.js";
import { resolveSourcePlane } from "./source-descriptor.js";

const tmpRoot = path.join(os.tmpdir(), `openbot-pcb-${Math.random().toString(36).slice(2)}`);

describe("passive connectors (P5)", () => {
  let kbStore: string;
  let bindingStore: string;
  let sourceBindings: string;
  let linkStore: string;
  let indexRoot: string;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
    kbStore = path.join(tmpRoot, "bases.json");
    bindingStore = path.join(tmpRoot, "pcb.json");
    sourceBindings = path.join(tmpRoot, "source-bindings.json");
    linkStore = path.join(tmpRoot, "links.json");
    indexRoot = path.join(tmpRoot, "index");
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("registers git/cloud/mail as passive kinds", () => {
    expect(resolveSourcePlane("gitRepo")).toBe("passive");
    expect(resolveSourcePlane("cloudDrive")).toBe("passive");
    expect(resolveSourcePlane("mailAttachment")).toBe("passive");
    expect(isPassiveConnectorKind("gitRepo")).toBe(true);
    expect(
      listPassiveConnectorProviders()
        .map((p) => p.kind)
        .toSorted(),
    ).toEqual(["cloudDrive", "gitRepo", "mailAttachment"]);
  });

  it("binds git connector without secrets on descriptor and supports sync plan/commit", async () => {
    const kb = createKnowledgeBase(
      { title: "Team", visibility: "private", ownerId: "user-a" },
      kbStore,
    );
    const bound = bindPassiveConnector({
      request: {
        kind: "gitRepo",
        knowledgeBaseId: kb.id,
        label: "docs-repo",
        locator: "acme/docs",
        deletePolicy: "snapshot",
        config: { branch: "main" },
      },
      ownerId: "user-a",
      knowledgeBase: getKnowledgeBase(kb.id, kbStore)!,
      storePath: bindingStore,
      sourceBindingsPath: sourceBindings,
    });
    expect(bound.providerReady).toBe(false);
    expect(bound.kind).toBe("gitRepo");

    const status = listPassiveConnectorStatus({
      knowledgeBaseId: kb.id,
      storePath: bindingStore,
    });
    expect(status).toHaveLength(1);
    expect(status[0]?.locator).toBe("acme/docs");
    expect(JSON.stringify(status[0])).not.toMatch(/token|password|secret/i);

    const body = "# Readme\n\nfrom git";
    const hash = computeRawContentHash(Buffer.from(body, "utf8"));
    const binding = listPassiveConnectorStatus({
      knowledgeBaseId: kb.id,
      storePath: bindingStore,
    })[0];
    // Reload full binding via plan (needs full object)
    const { findPassiveConnectorBinding } = await import("./passive-connector-binding-store.js");
    const full = findPassiveConnectorBinding({
      bindingId: binding.bindingId,
      storePath: bindingStore,
    })!;

    const plan = planPassiveConnectorSync({
      binding: full,
      candidates: [{ relativePath: "README.md", rawHash: hash }],
      linkStorePath: linkStore,
    });
    expect(plan.needUpload).toHaveLength(1);

    const commit = await commitPassiveConnectorSync({
      binding: full,
      knowledgeBase: getKnowledgeBase(kb.id, kbStore)!,
      ownerId: "user-a",
      files: [{ relativePath: "README.md", textContent: body, rawHash: hash }],
      indexRoot,
      kbStorePath: kbStore,
      bindingStorePath: bindingStore,
      linkStorePath: linkStore,
      embeddingProvider: null,
      governanceOwnershipProof: ownershipProofFromLocalUser({ userId: "user-a" }),
    });
    expect(commit.ingested).toBeGreaterThanOrEqual(1);

    const plan2 = planPassiveConnectorSync({
      binding: full,
      candidates: [{ relativePath: "README.md", rawHash: hash }],
      linkStorePath: linkStore,
    });
    expect(plan2.unchanged).toEqual(["README.md"]);

    const unbind = await unbindPassiveConnector({
      binding: full,
      knowledgeBase: getKnowledgeBase(kb.id, kbStore)!,
      ownerId: "user-a",
      purgeProjected: true,
      storePath: bindingStore,
      sourceBindingsPath: sourceBindings,
      linkStorePath: linkStore,
      indexRoot,
      kbStorePath: kbStore,
    });
    expect(unbind.ok).toBe(true);
    expect(unbind.purged).toBeGreaterThanOrEqual(1);
    expect(
      listPassiveConnectorStatus({ knowledgeBaseId: kb.id, storePath: bindingStore }),
    ).toHaveLength(0);
    // After purge, KB should no longer list the committed document as attached.
    const kbAfter = getKnowledgeBase(kb.id, kbStore)!;
    expect(kbAfter.documentIds.some((id) => id.includes("README") || isLocalFolderDocId(id))).toBe(
      false,
    );
  });

  it("rejects invalid git locator", () => {
    const kb = createKnowledgeBase(
      { title: "Team", visibility: "private", ownerId: "user-a" },
      kbStore,
    );
    expect(() =>
      bindPassiveConnector({
        request: {
          kind: "gitRepo",
          knowledgeBaseId: kb.id,
          label: "bad",
          locator: "not a repo",
        },
        ownerId: "user-a",
        knowledgeBase: getKnowledgeBase(kb.id, kbStore)!,
        storePath: bindingStore,
        sourceBindingsPath: sourceBindings,
      }),
    ).toThrow(/locator/i);
  });
});
