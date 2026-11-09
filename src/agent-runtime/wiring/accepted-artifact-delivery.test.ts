import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { enqueueDelivery, resolveDeliveryQueueDir } from "../../infra/outbound/delivery-queue.js";
import type { AcceptedArtifactIssuanceFacts } from "../policy/accepted-artifact-delivery.js";
import {
  acceptedArtifactDeliveryDirs,
  readAcceptedArtifactDelivery,
  recoverAcceptedArtifactDeliveries,
  requestAcceptedArtifactDelivery,
  revokeAcceptedArtifactDelivery,
} from "./accepted-artifact-delivery.js";

const roots: string[] = [];
const cfg = {} as OpenBotConfig;
const log = { info() {}, warn() {}, error() {} };
const text = "member-body";
const hash = createHash("sha256").update(text, "utf8").digest("hex");

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-m3-"));
  roots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function facts(patch: Partial<AcceptedArtifactIssuanceFacts> = {}): AcceptedArtifactIssuanceFacts {
  return {
    groupId: "grp-1",
    taskId: "task-1",
    itemId: "item-1",
    scope: "member_artifact",
    boardStatus: "accepted",
    acceptedSubmissionId: "sub-1",
    acceptedArtifactVersion: "art-v1",
    linkedDeliverableId: "del-1",
    linkedDeliverableVersion: 1,
    linkedContentSha256: hash,
    deliverableId: "del-1",
    deliverableVersion: 1,
    deliverableContentSha256: hash,
    plainText: text,
    ...patch,
  };
}

function issuerInput(patch: Record<string, string> = {}) {
  return {
    source: "resolveTrustedWriteContext",
    tenantId: "ten-a",
    actorId: "bot-b",
    groupId: "grp-1",
    groupAction: "write",
    ...patch,
  };
}

const target = { channel: "telegram", to: "chat-1" };

async function grantCount(authDir: string): Promise<number> {
  try {
    const names = await fs.readdir(authDir);
    return names.filter((name) => name.endsWith(".grant.json")).length;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

describe("accepted artifact public delivery chain", () => {
  it("does not create a grant or send without trusted issuance", async () => {
    const state = await tempDir();
    const dirs = acceptedArtifactDeliveryDirs(state);
    const missing = await requestAcceptedArtifactDelivery({
      issuerInput: null,
      facts: facts(),
      target,
      dirs,
    });
    const untrusted = await requestAcceptedArtifactDelivery({
      issuerInput: issuerInput({ groupAction: "read" }),
      facts: facts({ mediaUrl: "https://example.invalid/a.png" }),
      target,
      dirs,
    });
    expect(missing.ok).toBe(false);
    expect(untrusted.ok).toBe(false);
    expect(await grantCount(dirs.authDir)).toBe(0);
    const sendTelegram = vi.fn();
    await recoverAcceptedArtifactDeliveries({
      cfg,
      stateDir: state,
      log,
      deps: { sendTelegram },
      deliver: vi.fn(),
    });
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it("chains request, restart recovery, receipt, and query through one channel stub", async () => {
    const state = await tempDir();
    const dirs = acceptedArtifactDeliveryDirs(state);
    const smuggled = facts() as AcceptedArtifactIssuanceFacts & { grant?: { actorId: string } };
    smuggled.grant = { actorId: "body-actor" };
    const first = await requestAcceptedArtifactDelivery({
      issuerInput: issuerInput(),
      facts: smuggled,
      target,
      dirs,
      nowMs: 10,
    });
    const second = await requestAcceptedArtifactDelivery({
      issuerInput: issuerInput(),
      facts: facts(),
      target,
      dirs,
      nowMs: 11,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(await grantCount(dirs.authDir)).toBe(1);
    const grantFile = (await fs.readdir(dirs.authDir))[0];
    const stored = JSON.parse(await fs.readFile(path.join(dirs.authDir, grantFile), "utf8")) as {
      actorId: string;
    };
    expect(stored.actorId).toBe("bot-b");
    const before = await readAcceptedArtifactDelivery({
      tenantId: "ten-a",
      actorId: "reader",
      groupId: "grp-1",
      taskId: "task-1",
      itemId: "item-1",
      target,
      rootDir: dirs.rootDir,
    });
    expect(before.ok && before.delivery.phase).toBe("queued");
    const sendTelegram = vi.fn().mockResolvedValue({ messageId: "tg-m3", chatId: "chat-1" });
    const deliver = vi.fn();
    await recoverAcceptedArtifactDeliveries({
      cfg,
      stateDir: state,
      log,
      deps: { sendTelegram },
      deliver,
    });
    await recoverAcceptedArtifactDeliveries({
      cfg,
      stateDir: state,
      log,
      deps: { sendTelegram },
      deliver,
    });
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    expect(deliver).not.toHaveBeenCalled();
    const after = await readAcceptedArtifactDelivery({
      tenantId: "ten-a",
      actorId: "reader",
      groupId: "grp-1",
      taskId: "task-1",
      itemId: "item-1",
      target,
      rootDir: dirs.rootDir,
    });
    expect(after.ok && after.delivery.phase).toBe("delivered");
    expect(after.ok && after.delivery.receiptMessageIds).toEqual(["tg-m3"]);
  });

  it("does not send after a trusted revoke, and keeps an unknown effect isolated", async () => {
    const revokedState = await tempDir();
    const revokedDirs = acceptedArtifactDeliveryDirs(revokedState);
    expect(
      (
        await requestAcceptedArtifactDelivery({
          issuerInput: issuerInput(),
          facts: facts(),
          target,
          dirs: revokedDirs,
        })
      ).ok,
    ).toBe(true);
    const untrustedRevoke = await revokeAcceptedArtifactDelivery({
      issuerInput: issuerInput({ groupAction: "read" }),
      taskId: "task-1",
      itemId: "item-1",
      target,
      dirs: revokedDirs,
      nowMs: 20,
    });
    expect(untrustedRevoke.ok).toBe(false);
    expect(
      (
        await revokeAcceptedArtifactDelivery({
          issuerInput: issuerInput(),
          taskId: "task-1",
          itemId: "item-1",
          target,
          dirs: revokedDirs,
          nowMs: 21,
        })
      ).ok,
    ).toBe(true);
    const sendTelegram = vi.fn().mockResolvedValue({ messageId: "tg-no", chatId: "chat-1" });
    await recoverAcceptedArtifactDeliveries({
      cfg,
      stateDir: revokedState,
      log,
      deps: { sendTelegram },
      deliver: vi.fn(),
    });
    expect(sendTelegram).not.toHaveBeenCalled();

    const unknownState = await tempDir();
    const unknownDirs = acceptedArtifactDeliveryDirs(unknownState);
    await requestAcceptedArtifactDelivery({
      issuerInput: issuerInput(),
      facts: facts(),
      target,
      dirs: unknownDirs,
    });
    const failing = vi.fn().mockRejectedValue(new Error("timeout"));
    await recoverAcceptedArtifactDeliveries({
      cfg,
      stateDir: unknownState,
      log,
      deps: { sendTelegram: failing },
      deliver: vi.fn(),
    });
    await recoverAcceptedArtifactDeliveries({
      cfg,
      stateDir: unknownState,
      log,
      deps: { sendTelegram: failing },
      deliver: vi.fn(),
    });
    expect(failing).toHaveBeenCalledTimes(1);
    const queried = await readAcceptedArtifactDelivery({
      tenantId: "ten-a",
      actorId: "reader",
      groupId: "grp-1",
      taskId: "task-1",
      itemId: "item-1",
      target,
      rootDir: unknownDirs.rootDir,
    });
    expect(queried.ok && queried.delivery.phase).toBe("unknown");
  });

  it("leaves an ordinary queue entry on the existing recovery path", async () => {
    const state = await tempDir();
    await enqueueDelivery(
      { channel: "telegram", to: "plain", payloads: [{ text: "ordinary" }] },
      state,
    );
    const queueDir = resolveDeliveryQueueDir(state);
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
    const deliver = vi.fn().mockResolvedValue([{ messageId: "ord-1" }]);
    const sendTelegram = vi.fn();
    const summary = await recoverAcceptedArtifactDeliveries({
      cfg,
      stateDir: state,
      log,
      deliver,
      deps: { sendTelegram },
    });
    expect(summary.recovered).toBe(1);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(sendTelegram).not.toHaveBeenCalled();
    expect((await fs.readdir(queueDir)).includes("bridge-hold.json")).toBe(true);
  });
});
