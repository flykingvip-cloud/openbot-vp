import { createHash } from "node:crypto";
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
import { sendAcceptedArtifactBridge } from "../../delivery/accepted-artifact-send.js";
import { writeAcceptedArtifactQueueFile } from "../../delivery/accepted-artifact-send.js";
import type { MemberArtifactDeliveryIdentity } from "../../policy/accepted-artifact-delivery.js";
import {
  claimMemberArtifactSendUnknown,
  commitMemberArtifactDeliveryAssociation,
  markMemberArtifactQueued,
  noteAssociationRenamedAwayFromStaged,
  prepareMemberArtifactQueuePublication,
  recordMemberArtifactReceipt,
  writeServerOutboundArtifactGrant,
} from "./accepted-artifact-delivery-txn.js";

const roots: string[] = [];
const log = { info() {}, warn() {}, error() {} };
const cfg = {} as OpenBotConfig;

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const body = "member-body";

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-send-"));
  roots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function identity(
  patch: Partial<MemberArtifactDeliveryIdentity> = {},
): MemberArtifactDeliveryIdentity {
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
    linkedContentSha256: digest(body),
    target: { channel: "telegram", to: "chat-1" },
    ...patch,
  };
}

async function associated(root: string, who = identity()): Promise<void> {
  expect(
    (await commitMemberArtifactDeliveryAssociation({ rootDir: root, identity: who, nowMs: 1 })).ok,
  ).toBe(true);
  expect(
    (await noteAssociationRenamedAwayFromStaged({ rootDir: root, identity: who, nowMs: 2 })).ok,
  ).toBe(true);
}

async function publish(
  root: string,
  auth: string,
  queueState: string,
  who = identity(),
  text = body,
) {
  await associated(root, who);
  await writeServerOutboundArtifactGrant({ authDir: auth, identity: who });
  const prepared = await prepareMemberArtifactQueuePublication({
    rootDir: root,
    authDir: auth,
    identity: who,
    payloadText: text,
    nowMs: 3,
  });
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) {
    throw new Error(prepared.reason);
  }
  await writeAcceptedArtifactQueueFile({
    queueStateDir: queueState,
    queueId: prepared.queueId,
    keyHash: prepared.keyHash,
    channel: prepared.channel,
    to: prepared.to,
    accountId: prepared.accountId,
    payloadText: text,
    contentSha256: prepared.contentSha256,
    nowMs: 4,
  });
  expect(
    (
      await markMemberArtifactQueued({
        rootDir: root,
        identity: who,
        queueId: prepared.queueId,
        nowMs: 5,
      })
    ).ok,
  ).toBe(true);
  return prepared;
}

function send(params: {
  root: string;
  queueState: string;
  who?: MemberArtifactDeliveryIdentity;
  sendTelegram: ReturnType<typeof vi.fn>;
}) {
  const who = params.who ?? identity();
  return async (snapshot: { id: string }) =>
    sendAcceptedArtifactBridge({
      snapshot: snapshot as never,
      queueStateDir: params.queueState,
      cfg,
      deps: { sendTelegram: params.sendTelegram },
      claim: (recheck) =>
        claimMemberArtifactSendUnknown({
          rootDir: params.root,
          identity: who,
          recheck,
        }),
      recordReceipt: async (ids) => {
        const recorded = await recordMemberArtifactReceipt({
          rootDir: params.root,
          identity: who,
          receiptMessageIds: ids,
        });
        if (!recorded.ok) {
          throw new Error(recorded.reason);
        }
      },
      recordUnknown: async () => {
        // The claim already marked the effect unknown before the channel call.
      },
    });
}

describe("accepted artifact send boundary", () => {
  it("does not send when the server grant is missing", async () => {
    const root = await tempDir();
    const auth = await tempDir();
    const queueState = await tempDir();
    await associated(root);
    const prepared = await prepareMemberArtifactQueuePublication({
      rootDir: root,
      authDir: auth,
      identity: identity(),
      payloadText: body,
    });
    expect(prepared).toEqual({ ok: false, reason: "outbound_auth_grant_missing" });
    await expect(fs.readdir(resolveDeliveryQueueDir(queueState))).rejects.toThrow();
  });

  it("does not send again after the effect is marked unknown", async () => {
    const root = await tempDir();
    const auth = await tempDir();
    const queueState = await tempDir();
    const prepared = await publish(root, auth, queueState);
    const sendTelegram = vi.fn().mockResolvedValue({ messageId: "tg-1", chatId: "chat-1" });
    const claimed = await claimMemberArtifactSendUnknown({ rootDir: root, identity: identity() });
    expect(claimed.ok && claimed.send).toBe(true);
    const entry = (await loadPendingDeliveries(queueState))[0];
    const outcome = await send({ root, queueState, sendTelegram })(entry);
    expect(outcome).toBe("deferred");
    expect(sendTelegram).not.toHaveBeenCalled();
    const raw = JSON.parse(
      await fs.readFile(path.join(root, "intents", `${prepared.keyHash}.intent.json`), "utf8"),
    );
    expect(raw.phase).toBe("unknown");
    expect(raw.retryable).toBe(false);
  });

  it("isolates a timeout instead of retrying", async () => {
    const root = await tempDir();
    const auth = await tempDir();
    const queueState = await tempDir();
    const prepared = await publish(root, auth, queueState);
    const sendTelegram = vi.fn().mockRejectedValue(new Error("timeout"));
    const entry = (await loadPendingDeliveries(queueState))[0];
    const run = send({ root, queueState, sendTelegram });
    expect(await run(entry)).toBe("failed");
    expect(await run(entry)).toBe("deferred");
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    const raw = JSON.parse(
      await fs.readFile(path.join(root, "intents", `${prepared.keyHash}.intent.json`), "utf8"),
    );
    expect(raw.phase).toBe("unknown");
    expect(raw.retryable).toBe(false);
  });

  it("blocks a tampered payload and does not send it", async () => {
    const root = await tempDir();
    const auth = await tempDir();
    const queueState = await tempDir();
    const prepared = await publish(root, auth, queueState);
    const file = path.join(resolveDeliveryQueueDir(queueState), `${prepared.queueId}.json`);
    const queued = JSON.parse(await fs.readFile(file, "utf8"));
    queued.payloads = [{ text: "tampered" }];
    await fs.writeFile(file, JSON.stringify(queued), "utf8");
    const sendTelegram = vi.fn().mockResolvedValue({ messageId: "tg-1", chatId: "chat-1" });
    const outcome = await send({ root, queueState, sendTelegram })(queued);
    expect(outcome).toBe("failed");
    expect(sendTelegram).not.toHaveBeenCalled();
    const raw = JSON.parse(
      await fs.readFile(path.join(root, "intents", `${prepared.keyHash}.intent.json`), "utf8"),
    );
    expect(raw.phase).toBe("blocked");
  });

  it("does not send a non-telegram target through telegram", async () => {
    const root = await tempDir();
    const auth = await tempDir();
    const queueState = await tempDir();
    const slack = identity({
      target: { channel: "slack", to: "C123" },
      linkedContentSha256: digest(body),
    });
    const prepared = await publish(root, auth, queueState, slack);
    expect(prepared.ok && prepared.channel).toBe("slack");
    const queued = JSON.parse(
      await fs.readFile(
        path.join(resolveDeliveryQueueDir(queueState), `${prepared.queueId}.json`),
        "utf8",
      ),
    );
    expect(queued.channel).toBe("slack");
    const sendTelegram = vi.fn().mockResolvedValue({ messageId: "tg-1", chatId: "chat-1" });
    await send({ root, queueState, who: slack, sendTelegram })(queued);
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it("does not let a stale snapshot send twice", async () => {
    const root = await tempDir();
    const auth = await tempDir();
    const queueState = await tempDir();
    await publish(root, auth, queueState);
    const entry = (await loadPendingDeliveries(queueState))[0];
    const sendTelegram = vi.fn().mockResolvedValue({ messageId: "tg-9", chatId: "chat-1" });
    const run = send({ root, queueState, sendTelegram });
    const [first, second] = await Promise.all([run(entry), run(entry)]);
    expect([first, second].toSorted()).toEqual(["deferred", "recovered"]);
    expect(sendTelegram).toHaveBeenCalledTimes(1);
  });

  it("leaves an ordinary queue entry on the existing recovery path", async () => {
    const queueState = await tempDir();
    await enqueueDelivery(
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
    expect((await fs.readdir(queueDir)).includes("bridge-hold.json")).toBe(true);
  });
});
