import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { enqueueDelivery, resolveDeliveryQueueDir } from "../../infra/outbound/delivery-queue.js";
import * as recoverMod from "../delivery/accepted-artifact-recover.js";
import type { AcceptedArtifactIssuanceFacts } from "../policy/accepted-artifact-delivery.js";
import {
  acceptedArtifactDeliveryDirs,
  readAcceptedArtifactDelivery,
  recoverAcceptedArtifactDeliveries,
  requestAcceptedArtifactDelivery,
  revokeAcceptedArtifactDelivery,
} from "./accepted-artifact-delivery.js";

const roots: string[] = [];
const log = { info() {}, warn() {}, error() {} };
const text = "member-body";
const hash = createHash("sha256").update(text, "utf8").digest("hex");

function cfgFor(to: string): OpenBotConfig {
  return {
    channels: {
      telegram: {
        defaultTo: to,
      },
    },
  } as OpenBotConfig;
}

const scopeChat1 = {
  channel: "telegram",
  accountId: null,
  accountEnabled: true,
  allowedDestinations: ["chat-1"],
};

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-m3-"));
  roots.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
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
    const cfg = cfgFor("chat-1");
    const missing = await requestAcceptedArtifactDelivery({
      issuerInput: null,
      facts: facts(),
      target,
      dirs,
      cfg,
      scopeFacts: scopeChat1,
    });
    const untrusted = await requestAcceptedArtifactDelivery({
      issuerInput: issuerInput({ groupAction: "read" }),
      facts: facts({ mediaUrl: "https://example.invalid/a.png" }),
      target,
      dirs,
      cfg,
      scopeFacts: scopeChat1,
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

  it("delivers in-process after request without a separate recover call (no-restart)", async () => {
    const state = await tempDir();
    const dirs = acceptedArtifactDeliveryDirs(state);
    const cfg = cfgFor("chat-1");
    const sendTelegram = vi.fn().mockResolvedValue({ messageId: "tg-live", chatId: "chat-1" });
    const first = await requestAcceptedArtifactDelivery({
      issuerInput: issuerInput(),
      facts: facts(),
      target,
      dirs,
      cfg,
      scopeFacts: scopeChat1,
      deps: { sendTelegram },
      log,
      nowMs: 10,
    });
    expect(first.ok).toBe(true);
    expect(first.ok && first.delivery.phase).toBe("delivered");
    expect(sendTelegram).toHaveBeenCalledTimes(1);
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
    expect(after.ok && after.delivery.receiptMessageIds).toEqual(["tg-live"]);
  });

  it("still recovers after an interrupt mid-publish, and duplicate recover sends once", async () => {
    const state = await tempDir();
    const dirs = acceptedArtifactDeliveryDirs(state);
    const cfg = cfgFor("chat-1");
    const spy = vi
      .spyOn(recoverMod, "recoverAcceptedArtifactDeliveries")
      .mockResolvedValue({ recovered: 0, failed: 0, deferred: 0 } as never);
    const queued = await requestAcceptedArtifactDelivery({
      issuerInput: issuerInput(),
      facts: facts(),
      target,
      dirs,
      cfg,
      scopeFacts: scopeChat1,
      log,
      nowMs: 10,
    });
    expect(queued.ok).toBe(true);
    expect(queued.ok && queued.delivery.phase).toBe("queued");
    expect(await grantCount(dirs.authDir)).toBe(1);
    spy.mockRestore();

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
  });

  it("refuses scope when defaultTo does not match target (no grant, no send)", async () => {
    const state = await tempDir();
    const dirs = acceptedArtifactDeliveryDirs(state);
    const cfg = cfgFor("other-chat");
    const sendTelegram = vi.fn().mockResolvedValue({ messageId: "tg-no", chatId: "chat-1" });
    const denied = await requestAcceptedArtifactDelivery({
      issuerInput: issuerInput(),
      facts: facts(),
      target,
      dirs,
      cfg,
      scopeFacts: {
        channel: "telegram",
        accountId: null,
        accountEnabled: true,
        allowedDestinations: ["other-chat"],
      },
      deps: { sendTelegram },
      log,
    });
    expect(denied.ok).toBe(false);
    expect(!denied.ok && denied.reason).toBe("outbound_target_out_of_scope");
    expect(await grantCount(dirs.authDir)).toBe(0);
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it("refuses missing outbound scope basis without writing a grant", async () => {
    const state = await tempDir();
    const dirs = acceptedArtifactDeliveryDirs(state);
    const pending = await requestAcceptedArtifactDelivery({
      issuerInput: issuerInput(),
      facts: facts(),
      target,
      dirs,
      cfg: {} as OpenBotConfig,
      scopeFacts: null,
      log,
    });
    expect(pending.ok).toBe(false);
    expect(!pending.ok && pending.reason).toBe("outbound_scope_basis_missing");
    expect(await grantCount(dirs.authDir)).toBe(0);
  });

  it("does not send after a trusted revoke, and keeps an unknown effect isolated", async () => {
    const revokedState = await tempDir();
    const revokedDirs = acceptedArtifactDeliveryDirs(revokedState);
    const cfg = cfgFor("chat-1");
    const holdRecover = vi
      .spyOn(recoverMod, "recoverAcceptedArtifactDeliveries")
      .mockResolvedValue({ recovered: 0, failed: 0, deferred: 0 } as never);
    expect(
      (
        await requestAcceptedArtifactDelivery({
          issuerInput: issuerInput(),
          facts: facts(),
          target,
          dirs: revokedDirs,
          cfg,
          scopeFacts: scopeChat1,
        })
      ).ok,
    ).toBe(true);
    holdRecover.mockRestore();
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
    const afterRevoke = await requestAcceptedArtifactDelivery({
      issuerInput: issuerInput(),
      facts: facts(),
      target,
      dirs: revokedDirs,
      cfg,
      scopeFacts: scopeChat1,
      deps: { sendTelegram },
      log,
    });
    expect(afterRevoke.ok).toBe(false);
    expect(!afterRevoke.ok && afterRevoke.reason).toBe("outbound_authorization_revoked");

    const unknownState = await tempDir();
    const unknownDirs = acceptedArtifactDeliveryDirs(unknownState);
    const failing = vi.fn().mockRejectedValue(new Error("timeout"));
    await requestAcceptedArtifactDelivery({
      issuerInput: issuerInput(),
      facts: facts(),
      target,
      dirs: unknownDirs,
      cfg,
      scopeFacts: scopeChat1,
      deps: { sendTelegram: failing },
      log,
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

  it("lets revoke win over a concurrent grant rewrite (CAS)", async () => {
    const state = await tempDir();
    const dirs = acceptedArtifactDeliveryDirs(state);
    const cfg = cfgFor("chat-1");
    const holdRecover = vi
      .spyOn(recoverMod, "recoverAcceptedArtifactDeliveries")
      .mockResolvedValue({ recovered: 0, failed: 0, deferred: 0 } as never);
    expect(
      (
        await requestAcceptedArtifactDelivery({
          issuerInput: issuerInput(),
          facts: facts(),
          target,
          dirs,
          cfg,
          scopeFacts: scopeChat1,
          nowMs: 1,
        })
      ).ok,
    ).toBe(true);

    const revokePromise = revokeAcceptedArtifactDelivery({
      issuerInput: issuerInput(),
      taskId: "task-1",
      itemId: "item-1",
      target,
      dirs,
      nowMs: 50,
    });
    const reissuePromise = requestAcceptedArtifactDelivery({
      issuerInput: issuerInput(),
      facts: facts(),
      target,
      dirs,
      cfg,
      scopeFacts: scopeChat1,
      nowMs: 51,
    });
    const [revoked, reissued] = await Promise.all([revokePromise, reissuePromise]);
    holdRecover.mockRestore();
    expect(revoked.ok).toBe(true);
    // Either reissue saw revoked before write, or CAS refused the fresh grant.
    if (reissued.ok) {
      const grantFile = (await fs.readdir(dirs.authDir))[0];
      const stored = JSON.parse(await fs.readFile(path.join(dirs.authDir, grantFile), "utf8")) as {
        revokedAtMs: number | null;
      };
      expect(stored.revokedAtMs).not.toBeNull();
    } else {
      expect(reissued.reason).toBe("outbound_authorization_revoked");
    }
    const sendTelegram = vi.fn().mockResolvedValue({ messageId: "tg-race", chatId: "chat-1" });
    await recoverAcceptedArtifactDeliveries({
      cfg,
      stateDir: state,
      log,
      deps: { sendTelegram },
      deliver: vi.fn(),
    });
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it("leaves an ordinary queue entry on the existing recovery path", async () => {
    const state = await tempDir();
    const cfg = cfgFor("chat-1");
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
