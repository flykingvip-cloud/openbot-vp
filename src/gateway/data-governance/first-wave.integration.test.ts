// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileDataGovernanceCatalogStore } from "./catalog-store.js";
import { assertWritableEnvelope } from "./envelope.js";
import { createDataGovernanceInventoryApi } from "./inventory-api.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import {
  activateAgentGovernanceRegistration,
  beginAgentGovernanceRegistration,
  resetSharedDataGovernanceCatalogForTests,
  upsertConversationArchiveGovernanceRecord,
  upsertWorkspaceGovernanceRecord,
} from "./runtime-catalog.js";
import { GOVERNANCE_ENVELOPE_SCHEMA_VERSION } from "./types.js";

const tempDirs: string[] = [];

afterEach(() => {
  resetSharedDataGovernanceCatalogForTests();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("P1 first-wave integration evidence", () => {
  it("catalogs workspace/agent/conversation_archive and answers ownership without path inference", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-int-"));
    tempDirs.push(stateDir);

    await upsertWorkspaceGovernanceRecord({
      stateDir,
      resourceId: "ws-int-1",
      tenantId: "t-int",
      ownerScope: {
        kind: "user_owned",
        userId: "user-1",
        agentAssetId: "agent-asset-1",
        proof: {
          source: "explicit_binding",
          ownerType: "user",
          ownerId: "user-1",
          agentAssetId: "agent-asset-1",
        },
      },
      locator: path.join(stateDir, "users", "user-1", "workspace"),
      classification: "agent_workspace",
    });

    const agentIds = await beginAgentGovernanceRegistration({
      stateDir,
      agentId: "bot-1",
      tenantId: "t-int",
      ownerUserId: "user-1",
      ownerPositionId: null,
      workspaceLocator: path.join(stateDir, "agents", "bot-1", "workspace"),
      agentDirLocator: path.join(stateDir, "agents", "bot-1"),
    });
    await activateAgentGovernanceRegistration({ ...agentIds, stateDir });

    const archiveId = await upsertConversationArchiveGovernanceRecord({
      stateDir,
      transcriptPath: path.join(stateDir, "sessions", "s1.jsonl"),
      sessionId: "s1",
      tenantId: "t-int",
      ownerUserId: "user-1",
    });

    const catalogPath = resolveDataGovernanceCatalogPath(stateDir);
    expect(fs.existsSync(catalogPath)).toBe(true);
    const file = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as {
      records: Record<string, unknown>;
    };
    expect(Object.keys(file.records).length).toBeGreaterThanOrEqual(3);

    const store = createFileDataGovernanceCatalogStore({ storePath: catalogPath });
    const api = createDataGovernanceInventoryApi({ store });
    const items = await api.list({ tenantId: "t-int" });
    const types = new Set(items.map((i) => i.resourceType));
    expect(types.has("workspace")).toBe(true);
    expect(types.has("agent")).toBe(true);
    expect(types.has("conversation_archive")).toBe(true);

    const agent = await api.get(agentIds.agentResourceId);
    expect(agent?.record.envelope.owner).toEqual({ kind: "user", userId: "user-1" });
    expect(agent?.record.envelope.tenantId).toBe("t-int");

    const archive = await api.get(archiveId);
    expect(archive?.record.envelope.resourceType).toBe("conversation_archive");
    expect(archive?.record.envelope.canonicalBindingId).toBeTruthy();
  });

  it("managed invalid/unavailable writes fail closed", async () => {
    expect(() =>
      assertWritableEnvelope({
        resourceId: "x",
        resourceType: "workspace",
        schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
        tenantId: "t1",
        owner: { kind: "user", userId: "u1" },
        scope: { kind: "tenant" },
        lifecycleState: "active",
        classification: "internal",
        governanceVersion: 1,
        canonicalBindingId: "b1",
        createdAt: "2026-08-11T00:00:00Z",
        updatedAt: "2026-08-11T00:00:00Z",
      }),
    ).toThrow(/governance_envelope_invalid/);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-fail-"));
    tempDirs.push(dir);
    const storePath = path.join(dir, "catalog.json");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(storePath, "{not-json", "utf8");
    const store = createFileDataGovernanceCatalogStore({ storePath });
    await expect(
      store.put({
        envelope: {
          resourceId: "ws-x",
          resourceType: "workspace",
          schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
          tenantId: "t1",
          owner: { kind: "user", userId: "u1" },
          scope: { kind: "user", userId: "u1" },
          lifecycleState: "active",
          classification: "internal",
          governanceVersion: 1,
          canonicalBindingId: "bind-x",
          createdAt: "2026-08-11T00:00:00Z",
          updatedAt: "2026-08-11T00:00:00Z",
        },
        bindings: [
          {
            bindingId: "bind-x",
            resourceId: "ws-x",
            role: "canonical",
            storageKind: "filesystem",
            locator: "/data/x",
            state: "active",
            contentVersion: "v1",
          },
        ],
      }),
    ).rejects.toThrow(/governance_catalog_corrupt/);
  });
});
