import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const text = "member-body";
const hash = createHash("sha256").update(text, "utf8").digest("hex");

const dirsState = vi.hoisted(() => ({
  current: null as null | { rootDir: string; authDir: string; queueStateDir: string },
}));

vi.mock("../../agent-runtime/command/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../agent-runtime/command/index.js")>();
  return {
    ...actual,
    acceptedArtifactDeliveryDirs: (stateDir?: string) => {
      if (dirsState.current) {
        return dirsState.current;
      }
      return actual.acceptedArtifactDeliveryDirs(stateDir);
    },
  };
});

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({
    channels: {
      telegram: {
        defaultTo: "chat-1",
      },
    },
  }),
}));

vi.mock("../../gateway/collaboration-learning/trusted-tenant.js", () => ({
  resolveCollaborationTenantResolution: vi.fn(async () => ({ tenantId: "ten-a" })),
}));

vi.mock("../../gateway/collaboration-learning/delivery-actor-binding.js", () => ({
  authenticatedSessionSubjects: vi.fn(() => []),
  resolveDeliveryAclActor: vi.fn(async () => "bot-b"),
}));

vi.mock("../../gateway/collaboration-learning/team-resource-auth.js", () => ({
  resolveHandlerTrustedTeamContext: vi.fn(async () => ({
    ok: true,
    auth: { kind: "trusted" },
    stores: {},
    trusted: { groupId: "grp-1" },
  })),
}));

vi.mock("../../gateway/collaboration-learning/team-deliverable-submit.js", () => ({
  readTeamDeliverable: vi.fn(async () => ({
    ok: true,
    deliverableId: "del-1",
    version: 1,
    contentSha256: hash,
    content: text,
  })),
}));

vi.mock("../../gateway/collaboration-learning.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>().catch(() => ({}));
  return {
    ...actual,
    listCollaborationBoardItems: vi.fn(async () => [
      {
        itemId: "item-1",
        status: "accepted",
        acceptedSubmissionId: "sub-1",
        acceptedArtifactVersion: "art-v1",
        linkedDeliverableId: "del-1",
        linkedDeliverableVersion: 1,
        linkedContentSha256: hash,
      },
    ]),
  };
});

import { readAcceptedArtifactDelivery } from "../../agent-runtime/state/collaboration/accepted-artifact-delivery-read.js";
import { validateCollaborationTaskRequestAcceptedArtifactDeliveryParams } from "../../gateway/protocol/index.js";
import { collaborationLearningHandlers } from "../../gateway/server-methods/collaboration-learning.js";

const roots: string[] = [];

async function tempDirs() {
  const queueStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-m3-entry-"));
  roots.push(queueStateDir);
  const rootDir = path.join(queueStateDir, "accepted-artifact-delivery");
  const authDir = path.join(rootDir, "grants");
  await fs.mkdir(authDir, { recursive: true });
  dirsState.current = { rootDir, authDir, queueStateDir };
  return dirsState.current;
}

afterEach(async () => {
  dirsState.current = null;
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("collaboration.task.requestAcceptedArtifactDelivery", () => {
  beforeEach(() => {
    dirsState.current = null;
  });

  it("rejects a request body that carries a grant", () => {
    const ok = validateCollaborationTaskRequestAcceptedArtifactDeliveryParams({
      groupId: "grp-1",
      taskId: "task-1",
      itemId: "item-1",
      target: { channel: "telegram", to: "chat-1" },
      grant: { actorId: "body-actor" },
    });
    expect(ok).toBe(false);
  });

  it("does not issue when the gateway client is unauthenticated", async () => {
    const { resolveDeliveryAclActor } =
      await import("../../gateway/collaboration-learning/delivery-actor-binding.js");
    vi.mocked(resolveDeliveryAclActor).mockResolvedValueOnce(null as never);
    const respond = vi.fn();
    await collaborationLearningHandlers["collaboration.task.requestAcceptedArtifactDelivery"]({
      params: {
        groupId: "grp-1",
        taskId: "task-1",
        itemId: "item-1",
        target: { channel: "telegram", to: "chat-1" },
      },
      client: null,
      respond,
      req: {} as never,
      context: {} as never,
      isWebchatConnect: () => false,
    });
    expect(respond).toHaveBeenCalled();
    expect(respond.mock.calls[0]?.[0]).toBe(false);
  });

  it("authenticated handler runs real ACL, artifact facts, grant issuance, and live send", async () => {
    const dirs = await tempDirs();
    const sendTelegram = vi.fn().mockResolvedValue({ messageId: "tg-h1", chatId: "chat-1" });
    const respond = vi.fn();
    await collaborationLearningHandlers["collaboration.task.requestAcceptedArtifactDelivery"]({
      params: {
        groupId: "grp-1",
        taskId: "task-1",
        itemId: "item-1",
        target: { channel: "telegram", to: "chat-1" },
      },
      client: { connect: { auth: { token: "t" } } } as never,
      respond,
      req: {} as never,
      context: { deps: { sendTelegram } } as never,
      isWebchatConnect: () => false,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        phase: "delivered",
        receiptMessageIds: ["tg-h1"],
      }),
      undefined,
    );
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    const grants = await fs.readdir(dirs.authDir);
    expect(grants.some((name) => name.endsWith(".grant.json"))).toBe(true);
    const read = await readAcceptedArtifactDelivery({
      tenantId: "ten-a",
      actorId: "bot-b",
      groupId: "grp-1",
      taskId: "task-1",
      itemId: "item-1",
      target: { channel: "telegram", to: "chat-1" },
      rootDir: dirs.rootDir,
    });
    expect(read.ok && read.delivery.phase).toBe("delivered");
  });
});
