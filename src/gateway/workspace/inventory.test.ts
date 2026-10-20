import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deriveInventorySummary,
  inventoryCandidate,
  listUnknownOwnershipQuarantine,
  redactInventoryRecord,
  requireSafeSegment,
  resolveContained,
} from "./inventory.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ws-inv-"));
  tempDirs.push(root);
  const a = path.join(root, "tenants", "t1", "users", "u1", "workspace");
  const b = path.join(root, "tenants", "t1", "agent-assets", "asset-1", "workspace");
  fs.mkdirSync(a, { recursive: true });
  fs.mkdirSync(b, { recursive: true });
  fs.writeFileSync(path.join(a, "note.md"), "hello-a");
  fs.writeFileSync(path.join(b, "note.md"), "hello-b");
  return root;
}

describe("workspace inventory", () => {
  it("enforces safe segments and containment", () => {
    expect(() => requireSafeSegment("SAMPLE_TENANT", "a/b")).toThrow(/safe path segment/);
    const root = makeFixture();
    expect(() => resolveContained(root, path.join(root, "..", "escape"))).toThrow(/containment/);
  });

  it("inventories multiple roots with digests and unknown quarantine", () => {
    const root = makeFixture();
    const records = [
      inventoryCandidate(
        {
          candidateId: "c-user",
          absoluteRoot: path.join(root, "tenants", "t1", "users", "u1", "workspace"),
          normalizedRootClass: "user_flat_workspace",
          tenantRef: "t1",
          ownerRef: "u1",
          ownershipStatus: "unknown",
          bindingRole: "writer",
        },
        root,
      ),
      inventoryCandidate(
        {
          candidateId: "c-asset",
          absoluteRoot: path.join(root, "tenants", "t1", "agent-assets", "asset-1", "workspace"),
          normalizedRootClass: "agent_asset_workspace",
          tenantRef: "t1",
          agentAssetId: "asset-1",
          ownershipStatus: "proved",
          bindingRole: "duplicate",
        },
        root,
      ),
    ];
    expect(records[0]?.fileCount).toBe(1);
    expect(records[0]?.contentDigest).toBeTruthy();
    expect(records[1]?.contentDigest).toBeTruthy();
    expect(records[0]?.contentDigest).not.toBe(records[1]?.contentDigest);

    const quarantine = listUnknownOwnershipQuarantine(records);
    expect(quarantine.map((r) => r.candidateId)).toEqual(["c-user"]);

    const summary = deriveInventorySummary(records);
    expect(summary.recordCount).toBe(2);
    expect(summary.unknownOwnership).toBe(1);
    expect(summary.summarySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(deriveInventorySummary(records).summarySha256).toBe(summary.summarySha256);
  });

  it("redacts identifiers and respects truncation bounds", () => {
    const root = makeFixture();
    const deep = path.join(root, "tenants", "t1", "users", "u1", "workspace");
    const record = inventoryCandidate(
      {
        candidateId: "c1",
        absoluteRoot: deep,
        normalizedRootClass: "user_flat_workspace",
        tenantRef: "tenant-secret",
        ownerRef: "user-secret",
        agentId: "sales",
        ownershipStatus: "unknown",
        bindingRole: "risk_candidate",
      },
      root,
      { maxFiles: 0, maxDepth: 1, maxBytesRead: 1 },
    );
    expect(record.truncated).toBe(true);
    const redacted = redactInventoryRecord(record);
    expect(JSON.stringify(redacted)).not.toContain("tenant-secret");
    expect(JSON.stringify(redacted)).not.toContain("user-secret");
    expect(redacted.tenantRef).toMatch(/^[a-f0-9]{12}$/);
  });

  it("does not invent ownership from equal filenames", () => {
    const root = makeFixture();
    // Same basename note.md already exists in both roots with different content.
    const a = inventoryCandidate(
      {
        candidateId: "a",
        absoluteRoot: path.join(root, "tenants", "t1", "users", "u1", "workspace"),
        normalizedRootClass: "user_flat_workspace",
        ownershipStatus: "unknown",
      },
      root,
    );
    const b = inventoryCandidate(
      {
        candidateId: "b",
        absoluteRoot: path.join(root, "tenants", "t1", "agent-assets", "asset-1", "workspace"),
        normalizedRootClass: "agent_asset_workspace",
        ownershipStatus: "unknown",
      },
      root,
    );
    expect(a.contentDigest).not.toBe(b.contentDigest);
    expect(a.ownershipStatus).toBe("unknown");
    expect(b.ownershipStatus).toBe("unknown");
  });
});
