/**
 * Personal learning approve/revoke ownership gates.
 *
 * Proves nonempty actorId alone is NOT authorization: spoofed actor, cross-tenant
 * same botId, and revoke refuse leave state unchanged.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearConfigCache, clearRuntimeConfigSnapshot } from "../config/config.js";
import {
  approvePersonalLearningCandidate,
  readPersonalLearningRecall,
  revokePersonalLearningAsset,
  writePersonalLearningCandidate,
  type PersonalLearningOwnerContext,
} from "./personal-learning-write.js";

const cleanup: string[] = [];
const envKeys = [
  "OPENBOT_STATE_DIR",
  "OPENBOT_CONFIG_PATH",
  "OPENCLAW_CONFIG_PATH",
  "OPENCLAW_DISABLE_CONFIG_CACHE",
] as const;
const savedEnv: Record<string, string | undefined> = {};

async function withIsolatedEnv<T>(run: () => Promise<T>): Promise<T> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "mem-own-state-"));
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "mem-own-ws-"));
  cleanup.push(stateDir, workspaceDir);
  const configPath = path.join(stateDir, "openbot.json");
  await fs.writeFile(
    configPath,
    JSON.stringify({
      agents: {
        list: [{ id: "bot-main" }],
        defaults: { workspace: workspaceDir },
      },
      collaboration: { defaults: { workspace: path.join(workspaceDir, "collab-root") } },
    }),
    "utf8",
  );
  for (const key of envKeys) {
    savedEnv[key] = process.env[key];
  }
  process.env.OPENBOT_STATE_DIR = stateDir;
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  process.env.OPENCLAW_DISABLE_CONFIG_CACHE = "1";
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  try {
    return await run();
  } finally {
    clearRuntimeConfigSnapshot();
    clearConfigCache();
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  }
}

describe("personal learning ownership gates", () => {
  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it("spoofed actor cannot approve; state stays candidate", async () => {
    await withIsolatedEnv(async () => {
      const ownership: PersonalLearningOwnerContext = {
        ownerUserId: "owner-alice",
        ownerAgentId: "bot-main",
        securityProfile: "personal_local",
      };
      const written = await writePersonalLearningCandidate({
        botId: "bot-main",
        actorId: "owner-alice",
        ownership,
        reason: "SPOOF_GATE",
      });
      expect(written.ok).toBe(true);
      if (!written.ok) {
        throw new Error(written.reason);
      }

      const spoofed = await approvePersonalLearningCandidate({
        botId: "bot-main",
        capsuleId: written.capsuleId,
        actorId: "attacker-eve",
        ownership: {
          ...ownership,
          // attacker presents forged ownership claiming to be eve while targeting alice bot
          ownerUserId: "owner-alice",
        },
      });
      expect(spoofed.approved).toBe(false);
      expect(spoofed.promoted).toBe(false);
      expect(spoofed.reason).toBe("actor_not_owner");

      const recall = await readPersonalLearningRecall({ botId: "bot-main" });
      expect(recall.lessons.every((l) => !l.lesson.includes("SPOOF_GATE"))).toBe(true);
    });
  });

  it("cross-tenant same botId cannot approve", async () => {
    await withIsolatedEnv(async () => {
      const ownershipA: PersonalLearningOwnerContext = {
        ownerUserId: "owner-alice",
        ownerAgentId: "bot-main",
        tenantId: "tenant-a",
        securityProfile: "managed_enterprise",
      };
      const written = await writePersonalLearningCandidate({
        botId: "bot-main",
        actorId: "owner-alice",
        ownership: ownershipA,
        reason: "CROSS_TENANT_GATE",
      });
      expect(written.ok).toBe(true);
      if (!written.ok) {
        throw new Error(written.reason);
      }

      const cross = await approvePersonalLearningCandidate({
        botId: "bot-main",
        capsuleId: written.capsuleId,
        actorId: "owner-alice",
        ownership: {
          ownerUserId: "owner-alice",
          ownerAgentId: "bot-main",
          tenantId: "tenant-b",
          securityProfile: "managed_enterprise",
        },
      });
      expect(cross.approved).toBe(false);
      expect(cross.promoted).toBe(false);
      expect(cross.reason).toBe("cross_tenant_ownership");
    });
  });

  it("revoke refuse (spoofed actor) leaves asset active / recall unchanged", async () => {
    await withIsolatedEnv(async () => {
      const ownership: PersonalLearningOwnerContext = {
        ownerUserId: "owner-alice",
        ownerAgentId: "bot-main",
        securityProfile: "personal_local",
      };
      const written = await writePersonalLearningCandidate({
        botId: "bot-main",
        actorId: "owner-alice",
        ownership,
        reason: "REVOKE_REFUSE_GATE",
      });
      expect(written.ok).toBe(true);
      if (!written.ok) {
        throw new Error(written.reason);
      }
      const approved = await approvePersonalLearningCandidate({
        botId: "bot-main",
        capsuleId: written.capsuleId,
        actorId: "owner-alice",
        ownership,
      });
      expect(approved.promoted).toBe(true);
      expect(approved.assetId).toBeTruthy();

      const before = await readPersonalLearningRecall({ botId: "bot-main" });
      expect(before.lessons.some((l) => l.assetId === approved.assetId)).toBe(true);

      const refused = await revokePersonalLearningAsset({
        botId: "bot-main",
        assetId: approved.assetId!,
        actorId: "attacker-eve",
        ownership,
      });
      expect(refused.ok).toBe(false);
      expect(refused.reason).toBe("actor_not_owner");

      const after = await readPersonalLearningRecall({ botId: "bot-main" });
      expect(after.lessons.some((l) => l.assetId === approved.assetId)).toBe(true);
      expect(after.lessons.some((l) => l.lesson.includes("REVOKE_REFUSE_GATE"))).toBe(true);
    });
  });

  it("managed ownership without tenant fails closed on write", async () => {
    await withIsolatedEnv(async () => {
      const written = await writePersonalLearningCandidate({
        botId: "bot-main",
        actorId: "owner-alice",
        ownership: {
          ownerUserId: "owner-alice",
          ownerAgentId: "bot-main",
          securityProfile: "managed_enterprise",
          // tenant omitted
        },
        reason: "MANAGED_NO_TENANT",
      });
      expect(written.ok).toBe(false);
      if (written.ok) {
        throw new Error("expected fail-closed");
      }
      expect(written.reason).toBe("managed_tenant_required");
    });
  });
});
