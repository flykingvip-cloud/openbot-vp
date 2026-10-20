// @vitest-environment node
import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONTROL_UI_PLATFORM_AUTH_BASE_PATH } from "../control-ui-contract.js";
import { renderEnterpriseCoAdminInviteEmail } from "../platform-auth-email.js";
import { makeMockHttpResponse } from "../test-http-response.js";
import { hashPassword } from "./auth-helpers.js";
import { resolvePlatformAuthConfig, type ResolvedPlatformAuthConfig } from "./config.js";
import { handleControlUiPlatformAuthRequest } from "./control-ui-dispatcher.js";
import { resolveMembershipSelectionForUser } from "./memberships.js";
import type { PlatformAuthStore } from "./store-types.js";
import { loadStore, saveStore } from "./store.js";

const ADMIN_PASSWORD = "Admin-pass-123";
const MEMBER_PASSWORD = "Member-pass-123";
const SECOND_PASSWORD = "Second-pass-123";
const NOW = "2026-10-01T00:00:00.000Z";

type JsonPayload = {
  ok?: boolean;
  code?: string;
  error?: string;
  session?: { user?: string };
  emailDelivery?: { status?: string; reason?: string };
  platformAuth?: {
    sessionKind?: string;
    membershipRole?: string;
    members?: Array<{
      user: string;
      membershipRole: string;
      membershipRoles?: string[];
      adminInvitePendingExpiresAt?: string;
    }>;
  };
};

function makeJsonRequest(params: {
  url: string;
  body?: Record<string, unknown>;
  cookie?: string;
}): IncomingMessage {
  const body = params.body ? JSON.stringify(params.body) : "";
  const req = Readable.from(body ? [body] : []) as IncomingMessage;
  Object.assign(req, {
    url: params.url,
    method: "POST",
    headers: {
      host: "127.0.0.1:18789",
      ...(params.cookie ? { cookie: params.cookie } : {}),
    },
  });
  Object.defineProperty(req, "socket", {
    value: { remoteAddress: "127.0.0.1" },
    configurable: true,
  });
  return req;
}

function readCookie(setHeader: ReturnType<typeof makeMockHttpResponse>["setHeader"]): string {
  const raw = setHeader.mock.calls.find((call) => call[0] === "Set-Cookie")?.[1];
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const cookie = values
    .filter((value): value is string => typeof value === "string")
    .find((value) => !/Max-Age=0/.test(value));
  return cookie ? (cookie.split(";")[0] ?? "") : "";
}

function makeUser(id: string, email: string, displayName: string, password: string) {
  return {
    id,
    email,
    normalizedEmail: email,
    displayName,
    passwordHash: hashPassword(password),
    passwordUpdatedAt: NOW,
    loginFailedCount: 0,
    status: "active" as const,
    source: "employee-activated" as const,
    role: "operator" as const,
    scopes: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeSeedStore(): PlatformAuthStore {
  return {
    version: 5,
    secret: "co-admin-test-secret",
    policy: {
      defaultTrialDays: 14,
      allowedTrialDays: [14],
      defaultTrialSeatCount: 5,
      trialSeatOptions: [5],
      allowCustomTrialSeatCount: false,
      trialExpiryPolicy: "choose",
      trialExpiryHandling: "auto_stop",
      trialGraceDays: 0,
      updatedAt: NOW,
    },
    enterprises: {
      "ent-co": {
        id: "ent-co",
        name: "四惠物流",
        slug: "sihui",
        status: "paid",
        plan: "paid",
        billingStatus: "active",
        createdSource: "self-service",
        createdAt: NOW,
        updatedAt: NOW,
        seatQuota: 10,
        seatUsed: 3,
      },
    },
    users: {
      "u-admin": {
        ...makeUser("u-admin", "admin@sihui.test", "李管理员", ADMIN_PASSWORD),
        source: "self-created",
      },
      "u-member": makeUser("u-member", "zhang@sihui.test", "张三", MEMBER_PASSWORD),
      "u-second": makeUser("u-second", "wang@sihui.test", "王五", SECOND_PASSWORD),
    },
    sessions: {},
    memberships: {
      "m-admin": {
        id: "m-admin",
        userId: "u-admin",
        enterpriseId: "ent-co",
        membershipRole: "enterprise-admin",
        createdAt: NOW,
        updatedAt: NOW,
      },
      "m-member": {
        id: "m-member",
        userId: "u-member",
        enterpriseId: "ent-co",
        membershipRole: "member",
        createdAt: NOW,
        updatedAt: NOW,
      },
      "m-second": {
        id: "m-second",
        userId: "u-second",
        enterpriseId: "ent-co",
        membershipRole: "member",
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    adminProvisions: {},
    employeeProvisions: {},
    activationCodes: {},
    trialApplications: {},
    leadNotifications: {},
  };
}

describe("enterprise co-admin invite (邀请管理员 → 双重身份)", () => {
  let tempDir = "";
  let config: ResolvedPlatformAuthConfig;
  let trustedProxy: Parameters<typeof handleControlUiPlatformAuthRequest>[2]["trustedProxy"];
  const savedSmtpEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-co-admin-"));
    process.env.OPENCLAW_HOME = tempDir;
    for (const key of Object.keys(process.env)) {
      if (/SMTP/i.test(key)) {
        savedSmtpEnv[key] = process.env[key];
        delete process.env[key];
      }
    }
    trustedProxy = {
      userHeader: "x-forwarded-user",
      platformAuth: {
        enabled: true,
        requireMfaForPlatformAdmins: false,
        store: path.join(tempDir, "platform-auth.json"),
      },
    };
    const resolved = resolvePlatformAuthConfig(trustedProxy);
    expect(resolved).toBeTruthy();
    config = resolved!;
    await saveStore(config, makeSeedStore());
  });

  afterEach(async () => {
    delete process.env.OPENCLAW_HOME;
    for (const [key, value] of Object.entries(savedSmtpEnv)) {
      if (value !== undefined) {
        process.env[key] = value;
      }
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function post(
    route: string,
    body: Record<string, unknown>,
    cookie?: string,
  ): Promise<{ status: number; payload: JsonPayload; cookie: string }> {
    const mock = makeMockHttpResponse();
    await handleControlUiPlatformAuthRequest(
      makeJsonRequest({ url: `${CONTROL_UI_PLATFORM_AUTH_BASE_PATH}${route}`, body, cookie }),
      mock.res,
      { trustedProxy, localDirect: true },
    );
    const payload = JSON.parse(String(mock.end.mock.calls[0]?.[0] ?? "{}")) as JsonPayload;
    return { status: mock.res.statusCode, payload, cookie: readCookie(mock.setHeader) };
  }

  async function loginAdmin(): Promise<string> {
    const result = await post("/login", {
      email: "admin@sihui.test",
      password: ADMIN_PASSWORD,
      expectedSessionKind: "enterprise-admin",
    });
    expect(result.payload.ok).toBe(true);
    expect(result.cookie).toBeTruthy();
    return result.cookie;
  }

  async function latestInviteCode(email: string): Promise<string> {
    const store = await loadStore(config);
    const notification = Object.values(store.leadNotifications)
      .filter((entry) => entry.type === "enterprise-co-admin-invite-email" && entry.email === email)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    const rawInviteUrl = notification?.payload.inviteUrl;
    const inviteUrl = typeof rawInviteUrl === "string" ? rawInviteUrl : "";
    return new URL(inviteUrl).searchParams.get("adminInvite") ?? "";
  }

  it("rejects invites from non-admin sessions", async () => {
    const member = await post("/login", { email: "zhang@sihui.test", password: MEMBER_PASSWORD });
    expect(member.payload.platformAuth?.sessionKind).toBe("member");
    const denied = await post(
      "/enterprise/admin/invite",
      { user: "wang@sihui.test" },
      member.cookie,
    );
    expect(denied.status).toBe(403);
    expect(denied.payload.code).toBe("PLATFORM_AUTH_ADMIN_INVITE_FORBIDDEN");

    const anonymous = await post("/enterprise/admin/invite", { user: "wang@sihui.test" });
    expect(anonymous.status).toBe(403);
  });

  it("invites an existing employee, accepts at enterprise login without changing the password, and yields dual identity", async () => {
    const adminCookie = await loginAdmin();
    const before = await loadStore(config);
    const passwordHashBefore = before.users["u-member"]?.passwordHash;

    const invite = await post(
      "/enterprise/admin/invite",
      { user: "zhang@sihui.test" },
      adminCookie,
    );
    expect(invite.status).toBe(201);
    expect(invite.payload.ok).toBe(true);
    expect(invite.payload.emailDelivery?.status).toBe("queued");
    const invitedRow = invite.payload.platformAuth?.members?.find(
      (row) => row.user === "zhang@sihui.test",
    );
    expect(invitedRow?.membershipRole).toBe("member");
    expect(invitedRow?.adminInvitePendingExpiresAt).toBeTruthy();

    const afterInvite = await loadStore(config);
    const notification = Object.values(afterInvite.leadNotifications).find(
      (entry) => entry.type === "enterprise-co-admin-invite-email",
    );
    expect(notification?.email).toBe("zhang@sihui.test");
    const inviteUrl = new URL(String(notification?.payload.inviteUrl));
    expect(inviteUrl.pathname).toBe("/enterprise/login");
    expect(inviteUrl.searchParams.get("authMode")).toBe("login");
    expect(inviteUrl.searchParams.get("email")).toBe("zhang@sihui.test");
    const firstCode = inviteUrl.searchParams.get("adminInvite") ?? "";
    expect(firstCode).toBeTruthy();
    // The platform admin-activation flow is untouched: no new admin provision.
    expect(Object.keys(afterInvite.adminProvisions)).toHaveLength(0);

    // Idempotency: a second invite is a conflict unless explicitly resent.
    const duplicate = await post(
      "/enterprise/admin/invite",
      { user: "zhang@sihui.test" },
      adminCookie,
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.payload.code).toBe("PLATFORM_AUTH_ADMIN_INVITE_PENDING");

    const resent = await post(
      "/enterprise/admin/invite",
      { user: "zhang@sihui.test", resend: true },
      adminCookie,
    );
    expect(resent.status).toBe(201);
    const code = await latestInviteCode("zhang@sihui.test");
    expect(code).toBeTruthy();
    expect(code).not.toBe(firstCode);

    // Wrong / replaced codes are refused after password verification.
    const wrong = await post("/login", {
      email: "zhang@sihui.test",
      password: MEMBER_PASSWORD,
      adminInviteCode: "not-a-real-code",
    });
    expect(wrong.status).toBe(404);
    expect(wrong.payload.code).toBe("PLATFORM_AUTH_ADMIN_INVITE_INVALID");
    const replaced = await post("/login", {
      email: "zhang@sihui.test",
      password: MEMBER_PASSWORD,
      adminInviteCode: firstCode,
    });
    expect(replaced.status).toBe(410);
    expect(replaced.payload.code).toBe("PLATFORM_AUTH_ADMIN_INVITE_EXPIRED");
    // A wrong password never reaches the invite.
    const badPassword = await post("/login", {
      email: "zhang@sihui.test",
      password: "wrong-password-1",
      adminInviteCode: code,
    });
    expect(badPassword.status).toBe(401);

    // Before accepting, the enterprise entry refuses the plain employee account.
    const notYetAdmin = await post("/login", {
      email: "zhang@sihui.test",
      password: MEMBER_PASSWORD,
      expectedSessionKind: "enterprise-admin",
    });
    expect(notYetAdmin.payload.ok).not.toBe(true);

    const accepted = await post("/login", {
      email: "zhang@sihui.test",
      password: MEMBER_PASSWORD,
      expectedSessionKind: "enterprise-admin",
      adminInviteCode: code,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.payload.ok).toBe(true);
    expect(accepted.payload.platformAuth?.sessionKind).toBe("enterprise-admin");
    expect(accepted.cookie).toBeTruthy();

    const afterAccept = await loadStore(config);
    const memberships = Object.values(afterAccept.memberships).filter(
      (membership) => membership.userId === "u-member" && membership.enterpriseId === "ent-co",
    );
    expect(memberships.map((membership) => membership.membershipRole).toSorted()).toEqual([
      "enterprise-admin",
      "member",
    ]);
    expect(afterAccept.users["u-member"]?.passwordHash).toBe(passwordHashBefore);
    expect(afterAccept.users["u-member"]?.passwordUpdatedAt).toBe(NOW);
    expect(afterAccept.enterprises["ent-co"]?.seatUsed).toBe(3);
    const claimed = Object.values(afterAccept.activationCodes).filter(
      (entry) => entry.codeType === "enterpriseCoAdminInvite" && entry.status === "claimed",
    );
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.claimedByUserId).toBe("u-member");

    // Channel-pinned selection: same email, same password, two identities.
    expect(
      resolveMembershipSelectionForUser({
        store: afterAccept,
        userId: "u-member",
        intent: "employee",
      })?.membershipRole,
    ).toBe("member");
    expect(
      resolveMembershipSelectionForUser({
        store: afterAccept,
        userId: "u-member",
        intent: "enterprise-admin",
      })?.membershipRole,
    ).toBe("enterprise-admin");
    const employeeEntry = await post("/login", {
      email: "zhang@sihui.test",
      password: MEMBER_PASSWORD,
    });
    expect(employeeEntry.payload.ok).toBe(true);
    expect(employeeEntry.payload.platformAuth?.sessionKind).toBe("member");
    const enterpriseEntry = await post("/login", {
      email: "zhang@sihui.test",
      password: MEMBER_PASSWORD,
      expectedSessionKind: "enterprise-admin",
    });
    expect(enterpriseEntry.payload.ok).toBe(true);
    expect(enterpriseEntry.payload.platformAuth?.sessionKind).toBe("enterprise-admin");

    // Directory collapses the dual-identity account into one row.
    const roster = enterpriseEntry.payload.platformAuth?.members?.filter(
      (row) => row.user === "zhang@sihui.test",
    );
    expect(roster).toHaveLength(1);
    expect(roster?.[0]?.membershipRole).toBe("enterprise-admin");
    expect(roster?.[0]?.membershipRoles).toEqual(["enterprise-admin", "member"]);
    expect(roster?.[0]?.adminInvitePendingExpiresAt).toBeUndefined();

    // Replaying the claimed link is idempotent for the same account.
    const replay = await post("/login", {
      email: "zhang@sihui.test",
      password: MEMBER_PASSWORD,
      adminInviteCode: code,
    });
    expect(replay.payload.ok).toBe(true);
    expect(replay.payload.platformAuth?.sessionKind).toBe("enterprise-admin");

    // Already an admin → conflict.
    const again = await post("/enterprise/admin/invite", { user: "zhang@sihui.test" }, adminCookie);
    expect(again.status).toBe(409);
    expect(again.payload.code).toBe("PLATFORM_AUTH_ALREADY_ENTERPRISE_ADMIN");
  });

  it("refuses non-employees, self, and suspended employees", async () => {
    const adminCookie = await loginAdmin();
    const stranger = await post(
      "/enterprise/admin/invite",
      { user: "nobody@sihui.test" },
      adminCookie,
    );
    expect(stranger.status).toBe(404);
    expect(stranger.payload.code).toBe("PLATFORM_AUTH_MEMBER_NOT_FOUND");

    const self = await post("/enterprise/admin/invite", { user: "admin@sihui.test" }, adminCookie);
    expect(self.status).toBe(409);
    expect(self.payload.code).toBe("PLATFORM_AUTH_ALREADY_ENTERPRISE_ADMIN");

    const invalid = await post("/enterprise/admin/invite", { user: "not-an-email" }, adminCookie);
    expect(invalid.status).toBe(400);

    const store = await loadStore(config);
    store.users["u-second"].status = "suspended";
    await saveStore(config, store);
    const suspended = await post(
      "/enterprise/admin/invite",
      { user: "wang@sihui.test" },
      adminCookie,
    );
    expect(suspended.status).toBe(409);
    expect(suspended.payload.code).toBe("PLATFORM_AUTH_MEMBER_INACTIVE");
  });

  it("accepts with a signed-in employee session and rejects a different account", async () => {
    const adminCookie = await loginAdmin();
    const invite = await post("/enterprise/admin/invite", { user: "wang@sihui.test" }, adminCookie);
    expect(invite.status).toBe(201);
    const code = await latestInviteCode("wang@sihui.test");

    const anonymous = await post("/enterprise/admin/invite/accept", { code });
    expect(anonymous.status).toBe(401);

    const other = await post("/login", { email: "zhang@sihui.test", password: MEMBER_PASSWORD });
    const wrongAccount = await post("/enterprise/admin/invite/accept", { code }, other.cookie);
    expect(wrongAccount.status).toBe(404);
    expect(wrongAccount.payload.code).toBe("PLATFORM_AUTH_ADMIN_INVITE_INVALID");

    const employee = await post("/login", { email: "wang@sihui.test", password: SECOND_PASSWORD });
    expect(employee.payload.platformAuth?.sessionKind).toBe("member");
    const accepted = await post("/enterprise/admin/invite/accept", { code }, employee.cookie);
    expect(accepted.status).toBe(200);
    expect(accepted.payload.ok).toBe(true);
    // Current employee session is unchanged; admin identity is via the biz entry.
    expect(accepted.payload.platformAuth?.sessionKind).toBe("member");

    const store = await loadStore(config);
    expect(
      Object.values(store.memberships)
        .filter((membership) => membership.userId === "u-second")
        .map((membership) => membership.membershipRole)
        .toSorted(),
    ).toEqual(["enterprise-admin", "member"]);
    const adminEntry = await post("/login", {
      email: "wang@sihui.test",
      password: SECOND_PASSWORD,
      expectedSessionKind: "enterprise-admin",
    });
    expect(adminEntry.payload.platformAuth?.sessionKind).toBe("enterprise-admin");
  });
});

describe("renderEnterpriseCoAdminInviteEmail", () => {
  it("renders a co-admin invite distinct from new-admin activation", () => {
    const message = renderEnterpriseCoAdminInviteEmail({
      id: "n1",
      type: "enterprise-co-admin-invite-email",
      email: "zhang@sihui.test",
      enterpriseId: "ent-co",
      payload: {
        enterpriseName: "四惠物流",
        inviteeName: "张三",
        inviteeEmail: "zhang@sihui.test",
        inviteUrl: "https://biz.example.test/enterprise/login?authMode=login&adminInvite=abc",
        expiresAt: "2026-10-08T00:00:00.000Z",
        issuedByDisplayName: "李管理员",
      },
      status: "queued",
      createdAt: NOW,
    });
    expect(message?.to).toBe("zhang@sihui.test");
    expect(message?.subject).toContain("企业管理员");
    expect(message?.text).toContain("密码保持不变");
    expect(message?.text).toContain("adminInvite=abc");
    expect(message?.html).toContain("接受管理员邀请");
    expect(message?.text).not.toContain("激活码");
  });

  it("ignores other notification types", () => {
    expect(
      renderEnterpriseCoAdminInviteEmail({
        id: "n2",
        type: "admin-activation-email",
        payload: {},
        status: "queued",
        createdAt: NOW,
      }),
    ).toBeNull();
  });
});
