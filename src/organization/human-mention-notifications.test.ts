import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acknowledgeHumanMentionNotification,
  listHumanMentionNotifications,
  resolveHumanMentionNotificationStorePath,
  upsertHumanMentionNotification,
} from "./human-mention-notifications.js";

const TENANT = "tenant-human-mention-test";

describe("human-mention-notifications", () => {
  let previousRoot: string | undefined;
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "human-mention-"));
    previousRoot = process.env.OPENBOT_TENANTS_ROOT;
    process.env.OPENBOT_TENANTS_ROOT = tempRoot;
  });

  afterEach(async () => {
    if (previousRoot === undefined) {
      delete process.env.OPENBOT_TENANTS_ROOT;
    } else {
      process.env.OPENBOT_TENANTS_ROOT = previousRoot;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("persists a human mention notification and is idempotent by mentionId", async () => {
    const first = await upsertHumanMentionNotification({
      tenantId: TENANT,
      notification: {
        mentionId: "m-1",
        targetUserId: "alice",
        sourceUserId: "bob",
        groupId: "g1",
        sessionKey: "agent:main:space:g1",
        sourceMessageId: "msg-1",
        excerpt: "@Alice please review",
      },
    });
    expect(first.created).toBe(true);

    const second = await upsertHumanMentionNotification({
      tenantId: TENANT,
      notification: {
        mentionId: "m-1",
        targetUserId: "alice",
        sourceUserId: "bob",
        groupId: "g1",
        sessionKey: "agent:main:space:g1",
        sourceMessageId: "msg-1",
        excerpt: "retry",
      },
    });
    expect(second.created).toBe(false);
    expect(second.notification.excerpt).toBe("@Alice please review");

    const storePath = resolveHumanMentionNotificationStorePath(TENANT);
    const raw = await fs.readFile(storePath, "utf8");
    expect(raw).toContain("m-1");
  });

  it("lists only the target user's notifications and supports ack", async () => {
    await upsertHumanMentionNotification({
      tenantId: TENANT,
      notification: {
        mentionId: "m-alice",
        targetUserId: "alice",
        sourceUserId: "bob",
        groupId: "g1",
        sessionKey: "space:g1",
        sourceMessageId: "msg-a",
        excerpt: "for alice",
      },
    });
    await upsertHumanMentionNotification({
      tenantId: TENANT,
      notification: {
        mentionId: "m-carol",
        targetUserId: "carol",
        sourceUserId: "bob",
        groupId: "g1",
        sessionKey: "space:g1",
        sourceMessageId: "msg-c",
        excerpt: "for carol",
      },
    });

    const aliceItems = await listHumanMentionNotifications({
      tenantId: TENANT,
      targetUserId: "alice",
    });
    expect(aliceItems).toHaveLength(1);
    expect(aliceItems[0]?.mentionId).toBe("m-alice");
    expect(aliceItems[0]?.sessionKey).toBe("space:g1");
    expect(aliceItems[0]?.sourceMessageId).toBe("msg-a");

    const denied = await acknowledgeHumanMentionNotification({
      tenantId: TENANT,
      targetUserId: "eve",
      mentionId: "m-alice",
    });
    expect(denied).toBeNull();

    const acked = await acknowledgeHumanMentionNotification({
      tenantId: TENANT,
      targetUserId: "alice",
      mentionId: "m-alice",
    });
    expect(acked?.acknowledgedAt).toBeTruthy();

    const unread = await listHumanMentionNotifications({
      tenantId: TENANT,
      targetUserId: "alice",
      unreadOnly: true,
    });
    expect(unread).toHaveLength(0);
  });
});
