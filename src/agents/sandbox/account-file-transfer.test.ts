/**
 * Account Computer v4.1 P4: export, restore, and single-owner browser migration.
 *
 * Default is no copy of the shared openclaw user-data. One proved owner may
 * run export → verify → activate → rollback. Fan-out copies nothing.
 * Device-bound sentinels come back REAUTH_REQUIRED. Durable rollback puts
 * back only the selected trees.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { exportSingleOwnerBrowserProfile } from "../../browser/account-browser-migration.js";
import type { OpenBotConfig } from "../../config/types.js";
import type { TenantContext } from "../../gateway/tenant-context.js";
import {
  adoptAccountBrowserProfile,
  exportAccountDurableFiles,
  exportSharedBrowserProfile,
  resolveAccountDurableDirs,
  restoreAccountDurableFiles,
  rollbackAccountDurableRestore,
  rollbackSharedBrowserExport,
  verifyAccountDurableExport,
  verifySharedBrowserExport,
  activateSharedBrowserExport,
  type AccountBrowserAdoption,
  type AccountDurableExportResult,
  type AccountDurableTransferSession,
} from "./account-file-transfer.js";
import type { SharedBrowserMigrationSession } from "./account-shared-browser-migration.js";
import { isAccountWorkerPrototypeEnabled } from "./account-worker-gateway.js";
import {
  parseRuntimeControllerRequest,
  RuntimeControllerRejectedError,
} from "./runtime-controller.js";

const ENV_KEYS = [
  "OPENBOT_DATA_MODE",
  "OPENBOT_MULTITENANT",
  "OPENBOT_TENANTS_ROOT",
  "OPENBOT_STATE_DIR",
] as const;

const cfg: OpenBotConfig = { data: { mode: "managed" } };
const ctx: TenantContext = { tenantId: "tenant-a", userId: "user-a", domain: "employee" };
const other: TenantContext = { tenantId: "tenant-a", userId: "user-b", domain: "employee" };

function saveEnv(): Record<string, string | undefined> {
  const prev: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    prev[key] = process.env[key];
  }
  return prev;
}

function restoreEnv(prev: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function asBrowserSession(value: AccountBrowserAdoption): SharedBrowserMigrationSession {
  expect(value.kind).toBe("session");
  if (value.kind !== "session") {
    throw new Error("expected browser migration session");
  }
  return value;
}

function asDurableSession(value: AccountDurableExportResult): AccountDurableTransferSession {
  expect(value.kind).toBe("session");
  if (value.kind !== "session") {
    throw new Error("expected durable transfer session");
  }
  return value;
}

async function writeFile(filePath: string, contents: string): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, contents, "utf8");
}

async function readTree(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (current: string, prefix: string): Promise<void> => {
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(abs, rel);
      } else if (entry.isFile()) {
        out.set(rel, await fsp.readFile(abs, "utf8"));
      }
    }
  };
  await walk(dir, "");
  return out;
}

describe("account computer P4 file export, restore, and migration", () => {
  let prev: Record<string, string | undefined> = {};
  let root = "";

  afterEach(async () => {
    restoreEnv(prev);
    if (root) {
      await fsp.rm(root, { recursive: true, force: true });
      root = "";
    }
  });

  function enableManaged(): void {
    prev = saveEnv();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-account-p4-"));
    process.env.OPENBOT_DATA_MODE = "managed";
    process.env.OPENBOT_MULTITENANT = "1";
    process.env.OPENBOT_TENANTS_ROOT = root;
    process.env.OPENBOT_STATE_DIR = path.join(root, "operator-state");
  }

  function sharedUserData(): string {
    return path.join(root, "legacy", "browser", "openclaw", "user-data");
  }

  function scope(account: TenantContext = ctx) {
    return { ctx: account, cfg, agentId: "bot", env: process.env };
  }

  it("does not copy the shared profile unless a single owner is proved", async () => {
    enableManaged();
    const shared = sharedUserData();
    await writeFile(path.join(shared, "Cookies"), "shared-cookie");
    await writeFile(path.join(shared, "Default", "Cookies"), "shared-nested");
    const dirs = resolveAccountDurableDirs(scope());
    await writeFile(path.join(dirs.browser, "Cookies"), "local-cookie");
    const otherDirs = resolveAccountDurableDirs(scope(other));

    const cold = await adoptAccountBrowserProfile({
      ...scope(),
      sourceUserDataDir: shared,
      singleOwnerProof: false,
      workDir: path.join(root, "work-cold"),
    });
    expect(cold.kind).toBe("cold-start");
    if (cold.kind !== "cold-start") {
      return;
    }
    expect(cold.copied).toBe(false);
    expect(await fsp.readFile(path.join(dirs.browser, "Cookies"), "utf8")).toBe("local-cookie");
    expect(await fsp.readFile(path.join(shared, "Cookies"), "utf8")).toBe("shared-cookie");
    await expect(fsp.stat(otherDirs.browser)).rejects.toThrow();

    const unproved = await exportSharedBrowserProfile({
      sourceUserDataDir: shared,
      targets: [dirs.browser],
      singleOwnerProof: false,
      workDir: path.join(root, "work-unproved"),
    });
    expect(unproved).toMatchObject({
      kind: "refused",
      outcome: "FAILED",
      reason: "no-single-owner-proof",
      copied: false,
    });
    expect(await fsp.readFile(path.join(dirs.browser, "Cookies"), "utf8")).toBe("local-cookie");
    await expect(fsp.stat(path.join(root, "work-unproved", "staging"))).rejects.toThrow();
  });

  it("runs export, verify, activate, and rollback for one proved owner", async () => {
    enableManaged();
    const shared = sharedUserData();
    await writeFile(path.join(shared, "Cookies"), "shared-cookie");
    await writeFile(path.join(shared, "Local State"), "local-state");
    const dirs = resolveAccountDurableDirs(scope());
    await writeFile(path.join(dirs.browser, "Cookies"), "old-cookie");
    const credential = path.join(path.dirname(dirs.browser), "agents", "bot", "agent", "auth.json");
    await writeFile(credential, "secret");

    const exported = asBrowserSession(
      await adoptAccountBrowserProfile({
        ...scope(),
        sourceUserDataDir: shared,
        singleOwnerProof: true,
        workDir: path.join(root, "work-migrate"),
      }),
    );
    expect(exported.phase).toBe("exported");
    expect(exported.outcome).toBeNull();
    expect(exported.copiedToTarget).toBe(false);
    expect(await fsp.readFile(path.join(dirs.browser, "Cookies"), "utf8")).toBe("old-cookie");
    expect(await fsp.readFile(path.join(exported.stagingDir, "Cookies"), "utf8")).toBe(
      "shared-cookie",
    );

    const verified = asBrowserSession(await verifySharedBrowserExport(exported));
    expect(verified.phase).toBe("verified");
    expect(verified.outcome).toBeNull();

    const activated = asBrowserSession(await activateSharedBrowserExport(verified));
    expect(activated.outcome).toBe("MIGRATED");
    expect(activated.copiedToTarget).toBe(true);
    expect(await fsp.readFile(path.join(dirs.browser, "Cookies"), "utf8")).toBe("shared-cookie");
    expect(await fsp.readFile(path.join(dirs.browser, "Local State"), "utf8")).toBe("local-state");
    expect(await fsp.readFile(credential, "utf8")).toBe("secret");
    expect(await fsp.readFile(path.join(shared, "Cookies"), "utf8")).toBe("shared-cookie");

    const rolled = asBrowserSession(await rollbackSharedBrowserExport(activated));
    expect(rolled.phase).toBe("rolled-back");
    expect(rolled.outcome).toBeNull();
    expect(rolled.copiedToTarget).toBe(false);
    expect(await fsp.readFile(path.join(dirs.browser, "Cookies"), "utf8")).toBe("old-cookie");
    await expect(fsp.stat(path.join(dirs.browser, "Local State"))).rejects.toThrow();
    expect(await fsp.readFile(credential, "utf8")).toBe("secret");
    expect(await fsp.readFile(path.join(shared, "Cookies"), "utf8")).toBe("shared-cookie");
  });

  it("rolls a newly created profile back to absent without removing siblings", async () => {
    enableManaged();
    const shared = sharedUserData();
    await writeFile(path.join(shared, "Cookies"), "shared-cookie");
    const dirs = resolveAccountDurableDirs(scope());
    const sidecar = path.join(path.dirname(dirs.browser), "browser-sidecar.txt");
    await writeFile(sidecar, "keep");
    const exported = asBrowserSession(
      await exportSharedBrowserProfile({
        sourceUserDataDir: shared,
        targets: [dirs.browser],
        singleOwnerProof: true,
        workDir: path.join(root, "work-absent"),
      }),
    );
    const activated = asBrowserSession(
      await activateSharedBrowserExport(await verifySharedBrowserExport(exported)),
    );
    expect(activated.outcome).toBe("MIGRATED");
    expect(activated.previousExisted).toBe(false);
    const rolled = asBrowserSession(await rollbackSharedBrowserExport(activated));
    expect(rolled.phase).toBe("rolled-back");
    await expect(fsp.stat(dirs.browser)).rejects.toThrow();
    expect(await fsp.readFile(sidecar, "utf8")).toBe("keep");
  });

  it("returns REAUTH_REQUIRED for device-bound flags and sentinels and still activates cookies", async () => {
    const cases = [
      { label: "flag", rel: null, flag: true },
      { label: "device-bound", rel: "device-bound", flag: false },
      { label: "WebAuthn", rel: "Default/WebAuthn", flag: false },
      { label: "passkeys", rel: "passkeys", flag: false },
      { label: "device-bound-2fa", rel: "device-bound-2fa", flag: false },
    ];
    for (const item of cases) {
      enableManaged();
      const shared = sharedUserData();
      await writeFile(path.join(shared, "Cookies"), `cookie-${item.label}`);
      if (item.rel) {
        await writeFile(path.join(shared, item.rel), "sentinel");
      }
      const target = path.join(root, "profiles", item.label);
      const exported = asBrowserSession(
        await exportSharedBrowserProfile({
          sourceUserDataDir: shared,
          targets: [target],
          singleOwnerProof: true,
          workDir: path.join(root, "work", item.label),
          deviceBoundCredentials: item.flag,
        }),
      );
      const activated = asBrowserSession(
        await activateSharedBrowserExport(await verifySharedBrowserExport(exported)),
      );
      expect(activated.outcome, item.label).toBe("REAUTH_REQUIRED");
      expect(await fsp.readFile(path.join(target, "Cookies"), "utf8")).toBe(`cookie-${item.label}`);
      await fsp.rm(root, { recursive: true, force: true });
      root = "";
      restoreEnv(prev);
    }
  });

  it("fails closed when verify is tampered or the source is missing", async () => {
    enableManaged();
    const shared = sharedUserData();
    await writeFile(path.join(shared, "Cookies"), "shared-cookie");
    const target = path.join(root, "profile-fail");
    await writeFile(path.join(target, "Cookies"), "old-cookie");
    const exported = asBrowserSession(
      await exportSharedBrowserProfile({
        sourceUserDataDir: shared,
        targets: [target],
        singleOwnerProof: true,
        workDir: path.join(root, "work-fail"),
      }),
    );
    await fsp.rm(path.join(exported.stagingDir, "Cookies"));
    const verified = asBrowserSession(await verifySharedBrowserExport(exported));
    expect(verified.outcome).toBe("FAILED");
    expect(verified.reason).toBe("verify-mismatch");
    const activated = asBrowserSession(await activateSharedBrowserExport(verified));
    expect(activated.outcome).toBe("FAILED");
    expect(activated.copiedToTarget).toBe(false);
    expect(await fsp.readFile(path.join(target, "Cookies"), "utf8")).toBe("old-cookie");

    const missing = await exportSharedBrowserProfile({
      sourceUserDataDir: path.join(root, "gone", "browser", "openclaw", "user-data"),
      targets: [path.join(root, "other-profile")],
      singleOwnerProof: true,
      workDir: path.join(root, "work-missing"),
    });
    expect(missing).toMatchObject({
      kind: "refused",
      outcome: "FAILED",
      reason: "missing-source",
      copied: false,
    });
  });

  it("refuses fan-out of the shared user-data to more than one account", async () => {
    enableManaged();
    const shared = sharedUserData();
    await writeFile(path.join(shared, "Cookies"), "shared-cookie");
    const profileA = resolveAccountDurableDirs(scope()).browser;
    const profileB = resolveAccountDurableDirs(scope(other)).browser;
    const fanned = await exportSharedBrowserProfile({
      sourceUserDataDir: shared,
      targets: [profileA, profileB],
      singleOwnerProof: true,
      workDir: path.join(root, "work-fan"),
    });
    expect(fanned).toMatchObject({
      kind: "refused",
      outcome: "FAILED",
      reason: "fan-out",
      copied: false,
    });
    await expect(fsp.stat(path.join(profileA, "Cookies"))).rejects.toThrow();
    await expect(fsp.stat(profileB)).rejects.toThrow();
    await expect(
      fsp.stat(
        path.join(root, "legacy", "browser", "openclaw", ".openbot-single-owner-claim.json"),
      ),
    ).rejects.toThrow();

    const adopted = await adoptAccountBrowserProfile({
      ...scope(),
      sourceUserDataDir: shared,
      singleOwnerProof: true,
      workDir: path.join(root, "work-extra"),
      extraTargets: [profileB],
    });
    expect(adopted).toMatchObject({
      kind: "refused",
      outcome: "FAILED",
      reason: "fan-out",
      copied: false,
    });
    await expect(fsp.stat(profileB)).rejects.toThrow();

    const first = asBrowserSession(
      await exportSharedBrowserProfile({
        sourceUserDataDir: shared,
        targets: [profileA],
        singleOwnerProof: true,
        workDir: path.join(root, "work-a"),
      }),
    );
    const repeat = await exportSharedBrowserProfile({
      sourceUserDataDir: shared,
      targets: [profileA],
      singleOwnerProof: true,
      workDir: path.join(root, "work-a-again"),
    });
    expect(repeat).toMatchObject({
      kind: "refused",
      outcome: "FAILED",
      reason: "already-exported",
      copied: false,
    });
    const second = await exportSharedBrowserProfile({
      sourceUserDataDir: shared,
      targets: [profileB],
      singleOwnerProof: true,
      workDir: path.join(root, "work-b"),
    });
    expect(second).toMatchObject({
      kind: "refused",
      outcome: "FAILED",
      reason: "fan-out",
      copied: false,
    });
    await expect(fsp.stat(path.join(root, "work-b", "staging"))).rejects.toThrow();
    const activated = asBrowserSession(
      await activateSharedBrowserExport(await verifySharedBrowserExport(first)),
    );
    expect(activated.outcome).toBe("MIGRATED");
    expect(await fsp.readFile(path.join(profileA, "Cookies"), "utf8")).toBe("shared-cookie");
    await expect(fsp.stat(profileB)).rejects.toThrow();
  });

  it("rejects a client-chosen browser profile", async () => {
    enableManaged();
    const shared = sharedUserData();
    await writeFile(path.join(shared, "Cookies"), "shared-cookie");
    const requested = resolveAccountDurableDirs(scope(other)).browser;
    const result = await adoptAccountBrowserProfile({
      ...scope(),
      sourceUserDataDir: shared,
      singleOwnerProof: true,
      workDir: path.join(root, "work-client"),
      requestedProfileDir: requested,
    });
    expect(result).toMatchObject({
      kind: "refused",
      outcome: "FAILED",
      reason: "client-profile",
      copied: false,
    });
    await expect(fsp.stat(requested)).rejects.toThrow();
    const own = resolveAccountDurableDirs(scope()).browser;
    await expect(fsp.stat(path.join(own, "Cookies"))).rejects.toThrow();
  });

  it("restores durable trees and rolls back without deleting unrelated account data", async () => {
    enableManaged();
    const dirs = resolveAccountDurableDirs(scope());
    await writeFile(path.join(dirs.workspace, "notes", "doc.txt"), "ws-v1");
    await writeFile(path.join(dirs.artifacts, "down.txt"), "art-v1");
    await writeFile(path.join(dirs.memory, "mem.txt"), "mem-v1");
    await writeFile(path.join(dirs.browser, "Cookies"), "cookie-v1");
    const userRoot = path.join(root, "tenant-a", "users", "user-a");
    const credential = path.join(userRoot, "state", "agents", "bot", "agent", "auth.json");
    const sessions = path.join(userRoot, "state", "agents", "bot", "sessions", "s.json");
    const otherAgent = path.join(userRoot, "OpenBot", "agents", "other", "workspace", "keep.txt");
    const skills = path.join(userRoot, "OpenBot", "skills", "shared.md");
    const sidecar = path.join(userRoot, "state", "browser-sidecar.txt");
    await writeFile(credential, "secret-v1");
    await writeFile(sessions, "sess-v1");
    await writeFile(otherAgent, "other-agent");
    await writeFile(skills, "read-only-skill");
    await writeFile(sidecar, "sidecar");
    const shared = sharedUserData();
    await writeFile(path.join(shared, "Cookies"), "SHARED_COOKIE_SENTINEL");

    const archiveRoot = path.join(root, "archive");
    const exported = asDurableSession(
      await exportAccountDurableFiles({
        ...scope(),
        kinds: ["workspace", "artifacts", "memory", "browser"],
        archiveRoot,
      }),
    );
    const archived = await readTree(archiveRoot);
    for (const contents of archived.values()) {
      expect(contents).not.toContain("SHARED_COOKIE_SENTINEL");
    }
    expect(archived.get("trees/workspace/notes/doc.txt")).toBe("ws-v1");
    expect(archived.has("trees/skills/shared.md")).toBe(false);
    expect(await fsp.readFile(path.join(dirs.workspace, "notes", "doc.txt"), "utf8")).toBe("ws-v1");

    await writeFile(path.join(dirs.workspace, "notes", "doc.txt"), "ws-v2");
    await writeFile(path.join(dirs.artifacts, "down.txt"), "art-v2");
    await writeFile(path.join(dirs.memory, "mem.txt"), "mem-v2");
    await writeFile(path.join(dirs.browser, "Cookies"), "cookie-v2");
    await writeFile(path.join(path.dirname(credential), "secret-extra.txt"), "during");

    const verified = asDurableSession(await verifyAccountDurableExport(exported));
    const restored = asDurableSession(await restoreAccountDurableFiles(verified, scope()));
    expect(restored.outcome).toBe("MIGRATED");
    expect(restored.liveMutated).toBe(true);
    expect(await fsp.readFile(path.join(dirs.workspace, "notes", "doc.txt"), "utf8")).toBe("ws-v1");
    expect(await fsp.readFile(path.join(dirs.artifacts, "down.txt"), "utf8")).toBe("art-v1");
    expect(await fsp.readFile(path.join(dirs.memory, "mem.txt"), "utf8")).toBe("mem-v1");
    expect(await fsp.readFile(path.join(dirs.browser, "Cookies"), "utf8")).toBe("cookie-v1");
    expect(await fsp.readFile(credential, "utf8")).toBe("secret-v1");
    expect(
      await fsp.readFile(path.join(path.dirname(credential), "secret-extra.txt"), "utf8"),
    ).toBe("during");
    expect(await fsp.readFile(sessions, "utf8")).toBe("sess-v1");
    expect(await fsp.readFile(otherAgent, "utf8")).toBe("other-agent");
    expect(await fsp.readFile(skills, "utf8")).toBe("read-only-skill");
    expect(await fsp.readFile(sidecar, "utf8")).toBe("sidecar");

    await writeFile(path.join(path.dirname(credential), "secret-extra.txt"), "after-restore");
    await writeFile(path.join(path.dirname(credential), "secret-v3.txt"), "later");
    const rolled = asDurableSession(await rollbackAccountDurableRestore(restored));
    expect(rolled.phase).toBe("rolled-back");
    expect(rolled.outcome).toBeNull();
    expect(rolled.liveMutated).toBe(false);
    expect(await fsp.readFile(path.join(dirs.workspace, "notes", "doc.txt"), "utf8")).toBe("ws-v2");
    expect(await fsp.readFile(path.join(dirs.artifacts, "down.txt"), "utf8")).toBe("art-v2");
    expect(await fsp.readFile(path.join(dirs.memory, "mem.txt"), "utf8")).toBe("mem-v2");
    expect(await fsp.readFile(path.join(dirs.browser, "Cookies"), "utf8")).toBe("cookie-v2");
    expect(await fsp.readFile(credential, "utf8")).toBe("secret-v1");
    expect(
      await fsp.readFile(path.join(path.dirname(credential), "secret-extra.txt"), "utf8"),
    ).toBe("after-restore");
    expect(await fsp.readFile(path.join(path.dirname(credential), "secret-v3.txt"), "utf8")).toBe(
      "later",
    );
    expect(await fsp.readFile(sessions, "utf8")).toBe("sess-v1");
    expect(await fsp.readFile(otherAgent, "utf8")).toBe("other-agent");
    expect(await fsp.readFile(skills, "utf8")).toBe("read-only-skill");
    expect(await fsp.readFile(sidecar, "utf8")).toBe("sidecar");
  });

  it("leaves durable kinds that were not exported in place across restore and rollback", async () => {
    enableManaged();
    const dirs = resolveAccountDurableDirs(scope());
    await writeFile(path.join(dirs.workspace, "doc.txt"), "ws-v1");
    await writeFile(path.join(dirs.artifacts, "down.txt"), "art-v1");
    const exported = asDurableSession(
      await exportAccountDurableFiles({
        ...scope(),
        kinds: ["workspace"],
        archiveRoot: path.join(root, "archive-one"),
      }),
    );
    await writeFile(path.join(dirs.workspace, "doc.txt"), "ws-v2");
    await writeFile(path.join(dirs.artifacts, "down.txt"), "art-v2");
    const restored = asDurableSession(
      await restoreAccountDurableFiles(
        asDurableSession(await verifyAccountDurableExport(exported)),
        scope(),
      ),
    );
    expect(restored.outcome).toBe("MIGRATED");
    expect(await fsp.readFile(path.join(dirs.workspace, "doc.txt"), "utf8")).toBe("ws-v1");
    expect(await fsp.readFile(path.join(dirs.artifacts, "down.txt"), "utf8")).toBe("art-v2");
    const rolled = asDurableSession(await rollbackAccountDurableRestore(restored));
    expect(rolled.phase).toBe("rolled-back");
    expect(await fsp.readFile(path.join(dirs.workspace, "doc.txt"), "utf8")).toBe("ws-v2");
    expect(await fsp.readFile(path.join(dirs.artifacts, "down.txt"), "utf8")).toBe("art-v2");
  });

  it("marks a restored browser sentinel as REAUTH_REQUIRED and keeps other trees", async () => {
    enableManaged();
    const dirs = resolveAccountDurableDirs(scope());
    await writeFile(path.join(dirs.workspace, "doc.txt"), "ws-v1");
    await writeFile(path.join(dirs.browser, "Cookies"), "cookie-v1");
    await writeFile(path.join(dirs.browser, "Default", "WebAuthn"), "passkey");
    const credential = path.join(
      root,
      "tenant-a",
      "users",
      "user-a",
      "state",
      "agents",
      "bot",
      "agent",
      "auth.json",
    );
    await writeFile(credential, "secret");
    const exported = asDurableSession(
      await exportAccountDurableFiles({
        ...scope(),
        kinds: ["workspace", "browser"],
        archiveRoot: path.join(root, "archive-reauth"),
      }),
    );
    await writeFile(path.join(dirs.workspace, "doc.txt"), "ws-v2");
    await writeFile(path.join(dirs.browser, "Cookies"), "cookie-v2");
    const restored = asDurableSession(
      await restoreAccountDurableFiles(
        asDurableSession(await verifyAccountDurableExport(exported)),
        scope(),
      ),
    );
    expect(restored.outcome).toBe("REAUTH_REQUIRED");
    expect(await fsp.readFile(path.join(dirs.browser, "Cookies"), "utf8")).toBe("cookie-v1");
    expect(await fsp.readFile(path.join(dirs.browser, "Default", "WebAuthn"), "utf8")).toBe(
      "passkey",
    );
    expect(await fsp.readFile(path.join(dirs.workspace, "doc.txt"), "utf8")).toBe("ws-v1");
    expect(await fsp.readFile(credential, "utf8")).toBe("secret");
  });

  it("does not restore a tampered durable archive or an archive inside the account", async () => {
    enableManaged();
    const dirs = resolveAccountDurableDirs(scope());
    await writeFile(path.join(dirs.workspace, "doc.txt"), "ws-v1");
    const exported = asDurableSession(
      await exportAccountDurableFiles({
        ...scope(),
        kinds: ["workspace"],
        archiveRoot: path.join(root, "archive-tamper"),
      }),
    );
    await fsp.rm(path.join(exported.archiveRoot, "trees", "workspace", "doc.txt"));
    const verified = asDurableSession(await verifyAccountDurableExport(exported));
    expect(verified.outcome).toBe("FAILED");
    const restored = asDurableSession(await restoreAccountDurableFiles(verified, scope()));
    expect(restored.outcome).toBe("FAILED");
    expect(restored.liveMutated).toBe(false);
    expect(await fsp.readFile(path.join(dirs.workspace, "doc.txt"), "utf8")).toBe("ws-v1");

    const inside = await exportAccountDurableFiles({
      ...scope(),
      kinds: ["workspace"],
      archiveRoot: path.join(dirs.workspace, "nested-export"),
    });
    expect(inside).toMatchObject({
      kind: "refused",
      outcome: "FAILED",
      reason: "archive-inside-account",
      copied: false,
    });
    expect(await fsp.readFile(path.join(dirs.workspace, "doc.txt"), "utf8")).toBe("ws-v1");
  });

  it("keeps the one-shot helper on the same outcomes and refuses an unproved copy", async () => {
    enableManaged();
    const shared = sharedUserData();
    await writeFile(path.join(shared, "Cookies"), "shared-cookie");
    const target = path.join(root, "one-shot");
    expect(
      await exportSingleOwnerBrowserProfile({
        sourceUserDataDir: shared,
        targetProfileDir: target,
        singleOwnerProof: false,
      }),
    ).toBe("FAILED");
    await expect(fsp.stat(target)).rejects.toThrow();

    const migrated = await exportSingleOwnerBrowserProfile({
      sourceUserDataDir: shared,
      targetProfileDir: target,
      singleOwnerProof: true,
    });
    expect(migrated).toBe("MIGRATED");
    expect(await fsp.readFile(path.join(target, "Cookies"), "utf8")).toBe("shared-cookie");

    const rebound = path.join(root, "legacy-reauth", "browser", "openclaw", "user-data");
    await writeFile(path.join(rebound, "Cookies"), "again");
    await writeFile(path.join(rebound, "passkeys"), "device");
    expect(
      await exportSingleOwnerBrowserProfile({
        sourceUserDataDir: rebound,
        targetProfileDir: path.join(root, "one-shot-reauth"),
        singleOwnerProof: true,
        deviceBoundCredentials: true,
      }),
    ).toBe("REAUTH_REQUIRED");
  });

  it("refuses to export a symlinked shared profile", async () => {
    enableManaged();
    const shared = sharedUserData();
    await writeFile(path.join(shared, "Cookies"), "shared-cookie");
    await fsp.symlink(path.join(shared, "Cookies"), path.join(shared, "Cookies-link"));
    const target = path.join(root, "symlink-target");
    const result = await exportSharedBrowserProfile({
      sourceUserDataDir: shared,
      targets: [target],
      singleOwnerProof: true,
      workDir: path.join(root, "work-link"),
    });
    expect(result).toMatchObject({
      kind: "refused",
      outcome: "FAILED",
      reason: "symlink",
      copied: false,
    });
    await expect(fsp.stat(target)).rejects.toThrow();
    expect(await fsp.readFile(path.join(shared, "Cookies"), "utf8")).toBe("shared-cookie");
  });

  it("keeps the worker flag off and the controller rejecting container fields", () => {
    expect(isAccountWorkerPrototypeEnabled(undefined, {})).toBe(false);
    expect(
      isAccountWorkerPrototypeEnabled(
        { data: { mode: "local" } },
        { OPENBOT_ACCOUNT_WORKER: "1", OPENBOT_SECURITY_PROFILE: "personal_local" },
      ),
    ).toBe(false);
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, "account-file-transfer.ts"), "utf8");
    expect(source).not.toMatch(
      /src\/account-computer|from "\.\/docker\.js"|OPENBOT_ACCOUNT_WORKER/,
    );
    for (const field of ["image", "mounts", "hostPath"]) {
      expect(() =>
        parseRuntimeControllerRequest({
          action: "start",
          runtimeLeaseId: "lease-1",
          tenantId: "tenant-a",
          userId: "user-a",
          agentId: "bot",
          snapshotVersion: 1,
          [field]: "nope",
        }),
      ).toThrow(RuntimeControllerRejectedError);
    }
  });
});
