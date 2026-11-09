import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import type { QueuedDelivery } from "../../infra/outbound/delivery-queue.js";
import { recoverAcceptedArtifactBridgeEntry } from "../delivery/accepted-artifact-recover.js";
import { readMemberArtifactDeliveryIntent } from "../state/collaboration/accepted-artifact-delivery-txn.js";
import {
  acceptedArtifactDeliveryDirs,
  requestAcceptedArtifactDelivery,
  requestGroupFinalDelivery,
  revokeAcceptedArtifactDelivery,
} from "./accepted-artifact-delivery.js";

const tmpRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tmpRoots.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

function cfg(): OpenBotConfig {
  return {
    channels: {
      telegram: {
        enabled: true,
        defaultTo: "chat-1",
        accounts: { acct: { enabled: true, defaultTo: "chat-1" } },
      },
    },
  } as OpenBotConfig;
}

function facts(scope: "member_artifact" | "group_final") {
  const plainText = "group final body";
  const hash = createHash("sha256").update(plainText, "utf8").digest("hex");
  return {
    groupId: "grp-1",
    taskId: "task-1",
    itemId: "item-1",
    scope,
    boardStatus: "accepted",
    acceptedSubmissionId: "sub-1",
    acceptedArtifactVersion: "art-v1",
    linkedDeliverableId: "del-1",
    linkedDeliverableVersion: 1,
    linkedContentSha256: hash,
    deliverableId: "del-1",
    deliverableVersion: 1,
    deliverableContentSha256: hash,
    plainText,
  };
}

describe("requestGroupFinalDelivery", () => {
  it("denies without overall acceptance and does not upgrade member requests", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-gf-"));
    tmpRoots.push(root);
    const dirs = acceptedArtifactDeliveryDirs(root);
    const issuerInput = {
      source: "resolveTrustedWriteContext",
      tenantId: "ten-a",
      actorId: "bot-coord",
      groupId: "grp-1",
      groupAction: "write",
    };
    const target = { channel: "telegram", accountId: "acct", to: "chat-1" };

    const denied = await requestGroupFinalDelivery({
      issuerInput,
      facts: facts("group_final"),
      overallAcceptance: {
        boardStatus: "submitted_for_review",
        acceptanceReason: "not yet",
        acceptedArtifactVersion: "art-v1",
        pinnedArtifactVersion: "art-v1",
      },
      target,
      dirs,
      cfg: cfg(),
    });
    expect(denied).toEqual({ ok: false, reason: "not_accepted" });

    const memberBlocked = await requestAcceptedArtifactDelivery({
      issuerInput,
      facts: facts("group_final"),
      target,
      dirs,
      cfg: cfg(),
    });
    expect(memberBlocked).toEqual({ ok: false, reason: "group_final_not_member_artifact" });
  });

  it("associates + grants without sending; revoke blocks later recover", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-gf-"));
    tmpRoots.push(root);
    const dirs = acceptedArtifactDeliveryDirs(root);
    const issuerInput = {
      source: "resolveTrustedWriteContext",
      tenantId: "ten-a",
      actorId: "bot-coord",
      groupId: "grp-1",
      groupAction: "write",
    };
    const target = { channel: "telegram", accountId: "acct", to: "chat-1" };

    const ok = await requestGroupFinalDelivery({
      issuerInput,
      facts: facts("group_final"),
      overallAcceptance: {
        boardStatus: "accepted",
        acceptanceReason: "整体验收通过 art-v1",
        boardAcceptanceCriteria: ["A"],
        checkedAcceptanceCriteria: ["A"],
        acceptedArtifactVersion: "art-v1",
        pinnedArtifactVersion: "art-v1",
      },
      target,
      dirs,
      cfg: cfg(),
      nowMs: 1_000,
    });
    expect(ok, JSON.stringify(ok)).toMatchObject({ ok: true });
    if (!ok.ok) {
      throw new Error(`expected ok: ${JSON.stringify(ok)}`);
    }
    expect(ok.delivery.scope).toBe("group_final");
    expect(ok.delivery.phase === "delivered").toBe(false);

    expect(ok.delivery.keyHash).toBeTruthy();
    const keyHash = ok.delivery.keyHash as string;
    const intent = await readMemberArtifactDeliveryIntent(dirs.rootDir, keyHash);
    expect(intent?.scope).toBe("group_final");

    const revoked = await revokeAcceptedArtifactDelivery({
      issuerInput,
      taskId: "task-1",
      itemId: "item-1",
      target,
      dirs,
      nowMs: 2_000,
    });
    expect(revoked).toEqual({ ok: true });

    const entry = {
      id: "q1",
      channel: "telegram",
      to: "chat-1",
      accountId: "acct",
      payloads: [{ text: "group final body" }],
      bridgeKeyHash: keyHash,
      bridgeLinkedContentSha256: createHash("sha256")
        .update("group final body", "utf8")
        .digest("hex"),
      enqueuedAt: 1_000,
      retryCount: 0,
    } as unknown as QueuedDelivery;

    const outcome = await recoverAcceptedArtifactBridgeEntry({
      entry,
      rootDir: dirs.rootDir,
      authDir: dirs.authDir,
      queueStateDir: dirs.queueStateDir,
      cfg: cfg(),
      deps: {
        sendTelegram: async () => {
          throw new Error("should not send after revoke");
        },
      } as never,
    });
    // Revoked grant → claim refuses → deferred/failed without channel send.
    expect(["deferred", "failed"].includes(outcome)).toBe(true);
  });
});
