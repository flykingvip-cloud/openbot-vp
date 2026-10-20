import { describe, expect, it } from "vitest";
import type { PlatformAuthStore } from "../gateway/platform-auth/store-types.js";
import { listTenantHumans, resolveTenantHuman } from "./tenant-human-notice.js";

function store(): PlatformAuthStore {
  return {
    users: {
      "user-wang": {
        id: "user-wang",
        email: "wang@example.com",
        normalizedEmail: "wang@example.com",
        displayName: "王军",
        passwordHash: "x",
        passwordUpdatedAt: "2026-01-01T00:00:00.000Z",
        loginFailedCount: 0,
        status: "active",
        source: "employee-activated",
        role: "operator",
        scopes: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      "user-other": {
        id: "user-other",
        email: "other@example.com",
        normalizedEmail: "other@example.com",
        displayName: "外人",
        passwordHash: "x",
        passwordUpdatedAt: "2026-01-01T00:00:00.000Z",
        loginFailedCount: 0,
        status: "active",
        source: "employee-activated",
        role: "operator",
        scopes: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    memberships: {
      m1: {
        id: "m1",
        userId: "user-wang",
        enterpriseId: "ent-a",
        membershipRole: "member",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      m2: {
        id: "m2",
        userId: "user-other",
        enterpriseId: "ent-b",
        membershipRole: "member",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
  } as unknown as PlatformAuthStore;
}

describe("tenant human notice directory", () => {
  it("lists only active people in the same tenant", () => {
    const humans = listTenantHumans(store(), "ent-a");
    expect(humans.map((human) => human.displayName)).toEqual(["王军"]);
  });

  it("resolves a colleague by display name and rejects another tenant", () => {
    const humans = listTenantHumans(store(), "ent-a");
    expect(resolveTenantHuman(humans, "王军")?.userId).toBe("user-wang");
    expect(resolveTenantHuman(humans, "外人")).toBeUndefined();
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { confirmTenantHumanNotice, recordTenantHumanNotice } from "./tenant-human-notice.js";

describe("tenant human notice confirmation", () => {
  it("drops the todo after confirm and reports the receipt", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tenant-notice-"));
    const previous = process.env.OPENBOT_STATE_DIR;
    process.env.OPENBOT_STATE_DIR = dir;
    try {
      const notice = recordTenantHumanNotice({
        tenantId: "ent-a",
        recipient: { userId: "user-wang", displayName: "王军", email: "wang@example.com" },
        message: "下午三点开会",
        fromAgentId: "bot-ceo",
        senderUserId: "user-ceo",
      });
      const pending = fs.readFileSync(path.join(dir, "tenant-human-notices.json"), "utf8");
      expect(pending).toContain("pending");
      const confirmed = await confirmTenantHumanNotice({
        tenantId: "ent-a",
        recipientUserId: "user-wang",
        noticeId: notice.id,
        deliverReceipt: async () => true,
      });
      expect(confirmed?.status).toBe("confirmed");
      expect(confirmed?.receiptDelivered).toBe(true);
      const { listPendingTenantHumanNotices } = await import("./tenant-human-notice.js");
      expect(
        listPendingTenantHumanNotices({ tenantId: "ent-a", recipientUserId: "user-wang" }),
      ).toEqual([]);
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_STATE_DIR;
      } else {
        process.env.OPENBOT_STATE_DIR = previous;
      }
    }
  });
});

describe("tenant human receipt session key", () => {
  it("prefers fromSessionKey over agent main fallback", async () => {
    const { resolveTenantHumanReceiptSessionKey } = await import("./tenant-human-notice.js");
    expect(
      resolveTenantHumanReceiptSessionKey({
        fromSessionKey: "agent:main:employee:u1",
        fromAgentId: "main",
      }),
    ).toBe("agent:main:employee:u1");
    expect(
      resolveTenantHumanReceiptSessionKey({
        fromAgentId: "main",
      }),
    ).toBe("agent:main:main");
    expect(resolveTenantHumanReceiptSessionKey({})).toBeUndefined();
  });

  it("persists fromSessionKey on the notice record", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tenant-notice-session-"));
    const previous = process.env.OPENBOT_STATE_DIR;
    process.env.OPENBOT_STATE_DIR = dir;
    try {
      const notice = recordTenantHumanNotice({
        tenantId: "ent-a",
        recipient: { userId: "user-wang", displayName: "王军", email: "wang@example.com" },
        message: "验收回执落点",
        fromAgentId: "main",
        fromSessionKey: "agent:main:employee:u-ceo",
        senderUserId: "u-ceo",
      });
      expect(notice.fromSessionKey).toBe("agent:main:employee:u-ceo");
      const stored = JSON.parse(
        fs.readFileSync(path.join(dir, "tenant-human-notices.json"), "utf8"),
      );
      expect(stored[0].fromSessionKey).toBe("agent:main:employee:u-ceo");
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_STATE_DIR;
      } else {
        process.env.OPENBOT_STATE_DIR = previous;
      }
    }
  });
});
