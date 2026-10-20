// @vitest-environment node
// Feature: shared-agent-identity-access-control-plane

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setPrimaryOwner } from "./ownership.js";
import { createAgentAsset } from "./registry.js";
import { loadAgentRegistryStore, saveAgentRegistryStore } from "./store.js";
import { createEmptyAgentRegistryStore } from "./types.js";

const NOW = "2026-07-31T00:00:00.000Z";

let dir = "";
let storePath = "";

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-agent-registry-"));
  storePath = path.join(dir, "openbot-agent-registry.json");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("agent registry store", () => {
  it("returns an empty store when the file is missing", async () => {
    expect(await loadAgentRegistryStore(storePath)).toEqual(createEmptyAgentRegistryStore());
  });

  it("round-trips assets, owners, and quarantine entries", async () => {
    const store = createEmptyAgentRegistryStore();
    const asset = createAgentAsset({
      store,
      enterpriseId: "ent-a",
      agentSlug: "sales-bot",
      displayName: "Sales Bot",
      nowIso: NOW,
      legacyAgentId: "legacy-1",
    });
    setPrimaryOwner({
      store,
      ref: { enterpriseId: "ent-a", agentAssetId: asset.agentAssetId },
      ownerType: "seat",
      ownerId: "seat-1",
      nowIso: NOW,
    });
    await saveAgentRegistryStore(store, storePath);

    const loaded = await loadAgentRegistryStore(storePath);
    expect(loaded.assets[asset.agentAssetId]).toMatchObject({
      enterpriseId: "ent-a",
      agentSlug: "sales-bot",
      legacyAgentId: "legacy-1",
    });
    expect(Object.values(loaded.ownerBindings)).toHaveLength(1);
  });

  it("refuses to persist an active asset with no owner", async () => {
    // The write path is the transaction boundary, so a state the ADR forbids must not
    // reach disk even though it is legal mid-transaction.
    const store = createEmptyAgentRegistryStore();
    createAgentAsset({
      store,
      enterpriseId: "ent-a",
      agentSlug: "sales-bot",
      displayName: "Sales Bot",
      nowIso: NOW,
    });
    await expect(saveAgentRegistryStore(store, storePath)).rejects.toThrow(
      /has 0 open primary owner bindings/,
    );
    await expect(fs.access(storePath)).rejects.toThrow();
  });

  it("degrades to an empty store instead of throwing on malformed content", async () => {
    await fs.writeFile(storePath, "{ not json");
    expect(await loadAgentRegistryStore(storePath)).toEqual(createEmptyAgentRegistryStore());
  });

  it("normalizes missing collections so callers never index undefined", async () => {
    await fs.writeFile(storePath, JSON.stringify({ version: 1, assets: { a: { id: "a" } } }));
    const loaded = await loadAgentRegistryStore(storePath);
    expect(loaded.ownerBindings).toEqual({});
    expect(loaded.quarantine).toEqual({});
    expect(loaded.deployments).toEqual({});
  });

  it("leaves no temp file behind after a write", async () => {
    await saveAgentRegistryStore(createEmptyAgentRegistryStore(), storePath);
    const entries = await fs.readdir(dir);
    expect(entries).toEqual(["openbot-agent-registry.json"]);
  });
});
