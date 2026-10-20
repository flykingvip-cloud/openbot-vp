import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setPrimaryOwner } from "../agent-registry/ownership.js";
import { createAgentAsset } from "../agent-registry/registry.js";
import { createEmptyAgentRegistryStore } from "../agent-registry/types.js";
import {
  appendAgentIdentityLines,
  authorizeRegistryIdentityWrite,
} from "./agent-identity-write.js";

const NOW = "2026-10-06T00:00:00.000Z";

function registryWithAsset(ownerId?: string) {
  const store = createEmptyAgentRegistryStore();
  const asset = createAgentAsset({
    store,
    enterpriseId: "tenant-a",
    agentSlug: "research",
    displayName: "Research",
    nowIso: NOW,
    legacyAgentId: "research",
  });
  if (ownerId) {
    setPrimaryOwner({
      store,
      ref: { enterpriseId: "tenant-a", agentAssetId: asset.agentAssetId },
      ownerType: "seat",
      ownerId,
      nowIso: NOW,
    });
  }
  return store;
}

describe("agents.update identity write gate", () => {
  it("does not append IDENTITY.md when the asset decision denies", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-identity-deny-"));
    const store = registryWithAsset();
    const access = await authorizeRegistryIdentityWrite({
      registry: store,
      enterpriseId: "tenant-a",
      agentId: "research",
      actorMembershipId: "mem-1",
    });
    expect(access.decision.allowed).toBe(false);
    await expect(
      appendAgentIdentityLines({
        workspaceDir: root,
        identityFileName: "IDENTITY.md",
        lines: "\n- Avatar: nope\n",
        access,
      }),
    ).rejects.toThrow(/agent asset access denied/);
    await expect(fs.access(path.join(root, "IDENTITY.md"))).rejects.toThrow();
  });

  it("does not append when the enterprise asset cannot be resolved", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-identity-missing-"));
    await expect(
      authorizeRegistryIdentityWrite({
        registry: createEmptyAgentRegistryStore(),
        enterpriseId: "tenant-a",
        agentId: "research",
        actorMembershipId: "mem-1",
      }),
    ).rejects.toThrow(/asset-not-resolved/);
    await expect(fs.access(path.join(root, "IDENTITY.md"))).rejects.toThrow();
  });

  it("appends when the owner baseline decision allows", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-identity-allow-"));
    const store = registryWithAsset("seat-1");
    const access = await authorizeRegistryIdentityWrite({
      registry: store,
      enterpriseId: "tenant-a",
      agentId: "research",
      actorMembershipId: "mem-1",
    });
    expect(access.decision.allowed).toBe(true);
    await appendAgentIdentityLines({
      workspaceDir: root,
      identityFileName: "IDENTITY.md",
      lines: "\n- Avatar: ok\n",
      access,
    });
    expect(await fs.readFile(path.join(root, "IDENTITY.md"), "utf8")).toContain("- Avatar: ok");
  });
});
