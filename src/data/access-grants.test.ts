import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listAccessGrants,
  recordAccessGrant,
  resolveAccessGrantsPath,
  revokeAccessGrant,
} from "./access-grants.js";

describe("access-grants", () => {
  const dataRoot = path.join(os.tmpdir(), `openbot-grants-${Date.now()}`);

  afterEach(async () => {
    await fs.rm(dataRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it("records and revokes grants in access-grants.jsonl", async () => {
    const cfg = { data: { root: dataRoot, mode: "local" as const, schemaVersion: 1 } };
    const grant = await recordAccessGrant({
      cfg,
      agentId: "sales",
      resourceType: "knowledge",
      resourcePath: "shared/knowledge/projectA",
    });
    expect(grant.revokedAt).toBeNull();

    const active = await listAccessGrants({ cfg, agentId: "sales" });
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe(grant.id);

    const revoked = await revokeAccessGrant({ cfg, grantId: grant.id });
    expect(revoked?.revokedAt).toBeTruthy();

    const afterRevoke = await listAccessGrants({ cfg, agentId: "sales" });
    expect(afterRevoke).toHaveLength(0);

    const filePath = resolveAccessGrantsPath(dataRoot);
    const raw = await fs.readFile(filePath, "utf-8");
    expect(raw).toContain("shared/knowledge/projectA");
    expect(raw).toContain("revokedAt");
  });
});
