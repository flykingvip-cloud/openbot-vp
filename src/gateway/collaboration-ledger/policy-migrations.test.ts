/**
 * P1-A2 — PolicyMigrationEvent ledger I/O + workspace txn IO (Floor Runtime v2.1 §4.2).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeOperatingState } from "../collaboration-dispatch/__fixtures__/policy-source-matrix.js";
import {
  applyPolicyMigrationPlan,
  migrateLegacyGroupSettings,
} from "../collaboration-dispatch/policy-migration-event.js";
import { createWorkspacePolicyMigrationTxnIo } from "../collaboration-learning/policy-migration-store.js";
import {
  createWorkspaceCollaborationStores,
  readGroupOperatingState,
  syncGroupOperatingState,
  writeGroupOperatingState,
} from "../collaboration-learning/shared.js";
import {
  appendCollaborationPolicyMigrationEvents,
  readCollaborationPolicyMigrations,
} from "./policy-migrations.js";
import { readCollaborationLedgerArchive } from "./reader.js";
import { COLLABORATION_LEDGER_KINDS } from "./types.js";

let tempDirs: string[] = [];
let previousState: string | undefined;
let previousConfig: string | undefined;

async function makeTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

beforeEach(async () => {
  previousState = process.env.OPENBOT_STATE_DIR;
  previousConfig = process.env.OPENCLAW_CONFIG_PATH;
  const stateDir = await makeTempDir("openbot-pme-state-");
  const workspaceDir = await makeTempDir("openbot-pme-ws-");
  const collaborationRoot = await makeTempDir("openbot-pme-root-");
  process.env.OPENBOT_STATE_DIR = stateDir;
  process.env.OPENCLAW_CONFIG_PATH = path.join(stateDir, "openbot.json");
  await fs.writeFile(
    process.env.OPENCLAW_CONFIG_PATH,
    JSON.stringify({
      agents: { defaults: { workspace: workspaceDir } },
      collaboration: { defaults: { workspace: collaborationRoot } },
    }),
    "utf8",
  );
});

afterEach(async () => {
  if (previousState === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = previousState;
  }
  if (previousConfig === undefined) {
    delete process.env.OPENCLAW_CONFIG_PATH;
  } else {
    process.env.OPENCLAW_CONFIG_PATH = previousConfig;
  }
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

const CTX = { tenantId: null, migrationId: "mig-q5-ledger", now: 1_700_000_000_000 };

describe("policy_migration ledger kind", () => {
  it("is a registered ledger kind (queryable through collaboration.ledger.list kinds filter)", () => {
    expect(COLLABORATION_LEDGER_KINDS).toContain("policy_migration");
  });

  it("appends idempotently by eventId and queries latest-first with field filter", async () => {
    const groupId = `grp-pme-${Date.now()}`;
    const plan = migrateLegacyGroupSettings(makeOperatingState({ groupId, policy: {} }), CTX);
    expect(plan.events).toHaveLength(3);
    expect(
      await appendCollaborationPolicyMigrationEvents({ groupId, events: plan.events }),
    ).toEqual({ appended: 3, skipped: 0 });
    expect(
      await appendCollaborationPolicyMigrationEvents({ groupId, events: plan.events }),
    ).toEqual({ appended: 0, skipped: 3 });

    const all = await readCollaborationPolicyMigrations({ groupId });
    expect(all).toHaveLength(3);
    expect(all[0]).toMatchObject({
      kind: "policy_migration",
      groupId,
      actor: "migration",
      policyRevision: 1,
      recordedAtMs: CTX.now,
    });
    const filtered = await readCollaborationPolicyMigrations({
      groupId,
      field: "collaborationPolicy.maxVisibleBotRepliesPerRound",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toMatchObject({ from: null, to: 5 });

    // Existing readers that filter by kind are unaffected by the new kind.
    const executions = await readCollaborationLedgerArchive({ groupId, kinds: ["execution"] });
    expect(executions.records).toEqual([]);
  });

  it("rejects events that belong to another group", async () => {
    const plan = migrateLegacyGroupSettings(
      makeOperatingState({ groupId: "grp-a", policy: {} }),
      CTX,
    );
    await expect(
      appendCollaborationPolicyMigrationEvents({ groupId: "grp-b", events: plan.events }),
    ).rejects.toThrow(/belongs to grp-a/);
  });
});

describe("workspace PolicyMigrationTxnIo", () => {
  it("applies a Q5 plan end-to-end: state + ledger, idempotent rerun, txn cleared", async () => {
    const groupId = `grp-pme-ws-${Date.now()}`;
    const { fileStore } = createWorkspaceCollaborationStores();
    const legacy = makeOperatingState({ groupId, policy: { mentionBotMustRespond: true } });
    await writeGroupOperatingState({ fileStore, groupId, state: legacy });

    const io = createWorkspacePolicyMigrationTxnIo({ groupId, fileStore });
    const current = await io.readState();
    const plan = migrateLegacyGroupSettings(current!, CTX);
    expect(plan.report.fields.toSorted()).toEqual(
      [
        "collaborationPolicy.maxVisibleBotRepliesPerRound",
        "groupProfile.collaborationMode",
      ].toSorted(),
    );
    await applyPolicyMigrationPlan({ plan, ...CTX, io });

    const written = await readGroupOperatingState({ fileStore, groupId });
    expect(written?.policyRevision).toBe(1);
    expect(written?.groupProfile.collaborationMode).toBe("discussion_driven");
    expect(written?.collaborationPolicy.maxVisibleBotRepliesPerRound).toBe(5);
    expect(written?.collaborationPolicy.mentionBotMustRespond).toBe(true);
    expect(await io.readTxn()).toBeNull();
    expect(await readCollaborationPolicyMigrations({ groupId })).toHaveLength(2);

    const rerun = migrateLegacyGroupSettings(written!, { ...CTX, migrationId: "again" });
    expect(await applyPolicyMigrationPlan({ plan: rerun, ...CTX, io })).toEqual({
      status: "noop",
      policyRevision: 1,
    });
    expect(await readCollaborationPolicyMigrations({ groupId })).toHaveLength(2);
  });

  it("operating-state refresh keeps policyRevision and the materialised mode; un-migrated groups keep legacy refresh behaviour", async () => {
    const stores = createWorkspaceCollaborationStores();
    const migratedId = `grp-pme-refresh-${Date.now()}`;
    const legacyId = `${migratedId}-legacy`;
    const migrated = migrateLegacyGroupSettings(
      makeOperatingState({ groupId: migratedId, policy: {} }),
      CTX,
    ).next;
    await writeGroupOperatingState({
      fileStore: stores.fileStore,
      groupId: migratedId,
      state: migrated,
    });
    await writeGroupOperatingState({
      fileStore: stores.fileStore,
      groupId: legacyId,
      state: makeOperatingState({
        groupId: legacyId,
        collaborationMode: "review_driven",
        policy: {},
      }),
    });
    for (const groupId of [migratedId, legacyId]) {
      await syncGroupOperatingState({ ...stores, groupId });
    }
    const refreshed = await readGroupOperatingState({
      fileStore: stores.fileStore,
      groupId: migratedId,
    });
    expect(refreshed?.policyRevision).toBe(1);
    expect(refreshed?.groupProfile.collaborationMode).toBe("discussion_driven");
    expect(refreshed?.collaborationPolicy.maxVisibleBotRepliesPerRound).toBe(5);
    expect(refreshed?.collaborationPolicy.mentionBotMustRespond).toBe(false);
    const legacyRefreshed = await readGroupOperatingState({
      fileStore: stores.fileStore,
      groupId: legacyId,
    });
    // Pre-P1-A2 behaviour: without a profile mode an existing group's mode resets to null.
    expect(legacyRefreshed?.policyRevision).toBeUndefined();
    expect(legacyRefreshed?.groupProfile.collaborationMode).toBeNull();
  });
});
