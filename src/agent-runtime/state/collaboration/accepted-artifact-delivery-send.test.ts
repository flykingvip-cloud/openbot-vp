import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../../config/config.js";
import {
  enqueueDelivery,
  loadPendingDeliveries,
  recoverPendingDeliveries,
  resolveDeliveryQueueDir,
} from "../../../infra/outbound/delivery-queue.js";
import type { ServerOutboundAuthFacts } from "../../policy/accepted-artifact-delivery.js";
import type { MemberArtifactDeliveryIdentity } from "../../policy/accepted-artifact-delivery.js";
import {
  commitMemberArtifactDeliveryAssociation,
  noteAssociationRenamedAwayFromStaged,
  publishMemberArtifactDelivery,
  recoverMemberArtifactBridgeDelivery,
} from "./accepted-artifact-delivery-txn.js";

const roots: string[] = [];
const log = { info() {}, warn() {}, error() {} };
const cfg = {} as OpenBotConfig;

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-send-"));
  roots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function identity(): MemberArtifactDeliveryIdentity {
  return {
    tenantId: "ten-a",
    groupId: "grp-1",
    taskId: "task-1",
    itemId: "item-1",
    actorId: "bot-b",
    scope: "member_artifact",
    boardStatus: "accepted",
    acceptedSubmissionId: "sub-1",
    acceptedArtifactVersion: "art-v1",
    linkedDeliverableId: "del-1",
    linkedDeliverableVersion: 1,
    linkedContentSha256: "abc",
    target: { channel: "telegram", to: "chat-1" },
  };
}

function allowFacts(): ServerOutboundAuthFacts {
  return { factsLoaded: true, memberActorIds: ["bot-b"], allowFrom: ["chat-1"] };
}

async function associated(root: string): Promise<void> {
  const created = await commitMemberArtifactDeliveryAssociation({
    rootDir: root,
    identity: identity(),
    nowMs: 1,
  });
  expect(created.ok).toBe(true);
  const renamed = await noteAssociationRenamedAwayFromStaged({
    rootDir: root,
    identity: identity(),
    nowMs: 2,
  });
  expect(renamed.ok).toBe(true);
}

describe("publishMemberArtifactDelivery", () => {
  it("does not publish a sendable json before authorization", async () => {
    const root = await tempDir();
    const queueState = await tempDir();
    await associated(root);
    const pending = await publishMemberArtifactDelivery({
      rootDir: root,
      queueStateDir: queueState,
      identity: identity(),
      contentSha256: "abc",
      payloadText: "body",
      authFacts: { factsLoaded: false },
      nowMs: 3,
    });
    expect(pending).toEqual({ ok: false, reason: "outbound_auth_facts_missing" });
    await expect(fs.readdir(resolveDeliveryQueueDir(queueState))).rejects.toThrow();
  });

  it("retries a failure that had no external effect", async () => {
    const root = await tempDir();
    const queueState = await tempDir();
    await associated(root);
    const published = await publishMemberArtifactDelivery({
      rootDir: root,
      queueStateDir: queueState,
      identity: identity(),
      contentSha256: "abc",
      payloadText: "body",
      authFacts: allowFacts(),
      nowMs: 4,
    });
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const sendTelegram = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket closed before send"))
      .mockResolvedValueOnce({ messageId: "tg-1", chatId: "chat-1" });
    const pending = await loadPendingDeliveries(queueState);
    const entry = pending.find((row) => row.bridgeMarker === true);
    expect(entry).toBeTruthy();
    const failed = await recoverMemberArtifactBridgeDelivery({
      rootDir: root,
      queueStateDir: queueState,
      entry: entry!,
      authFacts: allowFacts(),
      cfg,
      deps: { sendTelegram },
    });
    expect(failed).toBe("failed");
    expect(published.intent.phase).toBe("queued");
    const again = await loadPendingDeliveries(queueState);
    const retried = await recoverMemberArtifactBridgeDelivery({
      rootDir: root,
      queueStateDir: queueState,
      entry: again[0],
      authFacts: allowFacts(),
      cfg,
      deps: { sendTelegram },
    });
    expect(retried).toBe("recovered");
    expect(sendTelegram).toHaveBeenCalledTimes(2);
    const intentRaw = await fs.readFile(
      path.join(root, "intents", `${published.intent.keyHash}.intent.json`),
      "utf8",
    );
    expect(JSON.parse(intentRaw).phase).toBe("delivered");
    expect(JSON.parse(intentRaw).receiptMessageIds).toEqual(["tg-1"]);
  });

  it("does not resend when the channel receipt is unknown", async () => {
    const root = await tempDir();
    const queueState = await tempDir();
    await associated(root);
    await publishMemberArtifactDelivery({
      rootDir: root,
      queueStateDir: queueState,
      identity: identity(),
      contentSha256: "abc",
      payloadText: "body",
      authFacts: allowFacts(),
      nowMs: 6,
    });
    const sendTelegram = vi.fn().mockResolvedValue({ messageId: "unknown" });
    const entry = (await loadPendingDeliveries(queueState))[0];
    expect(entry).toBeTruthy();
    await recoverMemberArtifactBridgeDelivery({
      rootDir: root,
      queueStateDir: queueState,
      entry: entry,
      authFacts: allowFacts(),
      cfg,
      deps: { sendTelegram },
    });
    await recoverMemberArtifactBridgeDelivery({
      rootDir: root,
      queueStateDir: queueState,
      entry: entry,
      authFacts: allowFacts(),
      cfg,
      deps: { sendTelegram },
    });
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    const intentRaw = await fs.readFile(
      path.join(root, "intents", `${entry.bridgeKeyHash}.intent.json`),
      "utf8",
    );
    expect(JSON.parse(intentRaw).phase).toBe("unknown");
    expect(JSON.parse(intentRaw).retryable).toBe(false);
  });

  it("acks only after the receipt is stored, and revocation does not send", async () => {
    const root = await tempDir();
    const queueState = await tempDir();
    await associated(root);
    await publishMemberArtifactDelivery({
      rootDir: root,
      queueStateDir: queueState,
      identity: identity(),
      contentSha256: "abc",
      payloadText: "body",
      authFacts: allowFacts(),
      nowMs: 5,
    });
    const sendTelegram = vi.fn().mockResolvedValue({ messageId: "tg-2", chatId: "chat-1" });
    const revoked = await recoverPendingDeliveries({
      cfg,
      stateDir: queueState,
      log,
      deliver: async () => {
        throw new Error("ordinary deliver must not run");
      },
      recoverBridge: (entry) =>
        recoverMemberArtifactBridgeDelivery({
          rootDir: root,
          queueStateDir: queueState,
          entry,
          authFacts: { factsLoaded: true, memberActorIds: ["bot-b"], allowFrom: ["revoked"] },
          cfg,
          deps: { sendTelegram },
        }),
    });
    expect(revoked.failed).toBe(1);
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it("leaves an ordinary queue entry on the existing recovery path", async () => {
    const queueState = await tempDir();
    const ordinary = await enqueueDelivery(
      { channel: "telegram", to: "plain", payloads: [{ text: "ordinary" }] },
      queueState,
    );
    const queueDir = resolveDeliveryQueueDir(queueState);
    await fs.writeFile(
      path.join(queueDir, "bridge-hold.json"),
      JSON.stringify({
        id: "bridge-hold",
        enqueuedAt: 1,
        retryCount: 0,
        channel: "telegram",
        to: "chat-1",
        payloads: [{ text: "hidden" }],
        bridgeMarker: true,
        associationReady: false,
      }),
      "utf8",
    );
    const seen: string[] = [];
    const summary = await recoverPendingDeliveries({
      cfg,
      stateDir: queueState,
      log,
      deliver: async (entry) => {
        seen.push(entry.to);
        return [{ messageId: "ord-1" }];
      },
    });
    expect(summary.recovered).toBe(1);
    expect(seen).toEqual(["plain"]);
    expect(ordinary).toBeTruthy();
    const left = await fs.readdir(queueDir);
    expect(left.some((name) => name === "bridge-hold.json")).toBe(true);
  });
});
