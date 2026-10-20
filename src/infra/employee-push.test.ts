import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertEmployeePushIsolatedFromNode,
  buildEmployeeApnsAlertPayload,
  buildMentionDeepLink,
  employeePushStorePath,
  enqueueEmployeePushForPlatformUser,
  listEmployeePushRegistrationsForAccount,
  listEmployeePushRegistrationsForPlatformUser,
  registerEmployeePushToken,
  resolveEmployeeApnsAuthConfigFromEnv,
  unregisterEmployeePushToken,
} from "./employee-push.js";
import { registerApnsToken } from "./push-apns.js";

const tempDirs: string[] = [];
const testAuthPrivateKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  .privateKey.export({ format: "pem", type: "pkcs8" })
  .toString();

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-employee-push-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("employee push registration store isolation", () => {
  it("stores under employee path, not node registrationsByNodeId file", async () => {
    const baseDir = await makeTempDir();
    const { employeePath, nodePath } = assertEmployeePushIsolatedFromNode(baseDir);
    expect(employeePath).toContain("employee-registrations.json");
    expect(nodePath).toContain("apns-registrations.json");
    expect(employeePath).not.toBe(nodePath);
    expect(employeePushStorePath(baseDir)).toBe(employeePath);

    await registerEmployeePushToken({
      accountId: "acct-1",
      deviceId: "dev-1",
      platform: "ios",
      platformUserId: "user-1",
      token: "ABCD1234ABCD1234ABCD1234ABCD1234",
      topic: "ai.openbot.employee",
      environment: "sandbox",
      baseDir,
    });

    // Node companion registration in parallel must not collide.
    await registerApnsToken({
      nodeId: "ios-node-1",
      token: "FFFF1234ABCD1234ABCD1234ABCD1234",
      topic: "ai.openbot.ios",
      environment: "sandbox",
      baseDir,
    });

    const employeeRaw = await fs.readFile(employeePath, "utf8");
    const nodeRaw = await fs.readFile(nodePath, "utf8");
    expect(employeeRaw).toContain("acct-1");
    expect(employeeRaw).not.toContain("registrationsByNodeId");
    expect(nodeRaw).toContain("registrationsByNodeId");
    expect(nodeRaw).not.toContain("acct-1");
  });

  it("upserts by accountId+deviceId+platform and supports multi-device", async () => {
    const baseDir = await makeTempDir();
    await registerEmployeePushToken({
      accountId: "acct-1",
      deviceId: "iphone",
      platform: "ios",
      platformUserId: "user-1",
      token: "AAAA1234ABCD1234ABCD1234ABCD1234",
      topic: "ai.openbot.employee",
      baseDir,
    });
    await registerEmployeePushToken({
      accountId: "acct-1",
      deviceId: "ipad",
      platform: "ios",
      platformUserId: "user-1",
      token: "BBBB1234ABCD1234ABCD1234ABCD1234",
      topic: "ai.openbot.employee",
      baseDir,
    });
    // upsert same device
    await registerEmployeePushToken({
      accountId: "acct-1",
      deviceId: "iphone",
      platform: "ios",
      platformUserId: "user-1",
      token: "CCCC1234ABCD1234ABCD1234ABCD1234",
      topic: "ai.openbot.employee",
      baseDir,
    });

    const forAccount = await listEmployeePushRegistrationsForAccount("acct-1", baseDir);
    expect(forAccount).toHaveLength(2);
    const iphone = forAccount.find((r) => r.deviceId === "iphone");
    expect(iphone?.token).toBe("cccc1234abcd1234abcd1234abcd1234");

    const forUser = await listEmployeePushRegistrationsForPlatformUser("user-1", baseDir);
    expect(forUser).toHaveLength(2);
  });

  it("unregisters device and allDevices for account", async () => {
    const baseDir = await makeTempDir();
    await registerEmployeePushToken({
      accountId: "acct-1",
      deviceId: "iphone",
      platform: "ios",
      platformUserId: "user-1",
      token: "AAAA1234ABCD1234ABCD1234ABCD1234",
      topic: "ai.openbot.employee",
      baseDir,
    });
    await registerEmployeePushToken({
      accountId: "acct-1",
      deviceId: "ipad",
      platform: "ios",
      platformUserId: "user-1",
      token: "BBBB1234ABCD1234ABCD1234ABCD1234",
      topic: "ai.openbot.employee",
      baseDir,
    });

    const one = await unregisterEmployeePushToken({
      accountId: "acct-1",
      deviceId: "iphone",
      platform: "ios",
      baseDir,
    });
    expect(one.removed).toBe(1);
    expect(await listEmployeePushRegistrationsForAccount("acct-1", baseDir)).toHaveLength(1);

    const all = await unregisterEmployeePushToken({
      accountId: "acct-1",
      allDevices: true,
      baseDir,
    });
    expect(all.removed).toBe(1);
    expect(await listEmployeePushRegistrationsForAccount("acct-1", baseDir)).toHaveLength(0);
  });
});

describe("employee push payload shape", () => {
  it("requires deepLink with openclaw/openbot scheme", () => {
    expect(() =>
      buildEmployeeApnsAlertPayload({
        deepLink: "",
        title: "t",
        body: "b",
      }),
    ).toThrow("deepLink required");
    expect(() =>
      buildEmployeeApnsAlertPayload({
        deepLink: "https://evil.example/x",
        title: "t",
        body: "b",
      }),
    ).toThrow("openclaw:// or openbot://");

    const payload = buildEmployeeApnsAlertPayload({
      deepLink: "openclaw://chat?sessionKey=s1",
      title: "有人提到你",
      body: "来自协作空间",
      accountId: "acct-1",
    }) as {
      aps: { alert: { title: string; body: string } };
      deepLink: string;
      accountId: string;
    };
    expect(payload.deepLink).toBe("openclaw://chat?sessionKey=s1");
    expect(payload.aps.alert.title).toBe("有人提到你");
    expect(payload.accountId).toBe("acct-1");
    // must not embed a full message body field beyond short alert
    expect(JSON.stringify(payload)).not.toContain("messageText");
  });

  it("builds mention deep links", () => {
    expect(buildMentionDeepLink({ sessionKey: "sk/1" })).toBe("openclaw://chat?sessionKey=sk%2F1");
    expect(buildMentionDeepLink({ groupId: "g1" })).toBe("openclaw://space/g1");
    expect(buildMentionDeepLink({})).toBe("openclaw://employee/overview");
  });
});

describe("employee APNs env", () => {
  it("resolves employee env independently of OPENCLAW_APNS_*", async () => {
    const missing = await resolveEmployeeApnsAuthConfigFromEnv({
      OPENCLAW_APNS_TEAM_ID: "NODE_TEAM",
      OPENCLAW_APNS_KEY_ID: "NODE_KEY",
      OPENCLAW_APNS_PRIVATE_KEY_P8: testAuthPrivateKey,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error).toContain("OPENBOT_EMPLOYEE_APNS");
    }

    const ok = await resolveEmployeeApnsAuthConfigFromEnv({
      OPENBOT_EMPLOYEE_APNS_TEAM_ID: "EMP_TEAM",
      OPENBOT_EMPLOYEE_APNS_KEY_ID: "EMP_KEY",
      OPENBOT_EMPLOYEE_APNS_PRIVATE_KEY_P8: testAuthPrivateKey.replace(/\n/g, "\\n"),
    });
    expect(ok.ok).toBe(true);
  });
});

describe("enqueueEmployeePushForPlatformUser", () => {
  it("skips with no_credentials when employee APNs env missing", async () => {
    const baseDir = await makeTempDir();
    await registerEmployeePushToken({
      accountId: "acct-1",
      deviceId: "iphone",
      platform: "ios",
      platformUserId: "user-1",
      token: "AAAA1234ABCD1234ABCD1234ABCD1234",
      topic: "ai.openbot.employee",
      baseDir,
    });

    const results = await enqueueEmployeePushForPlatformUser({
      platformUserId: "user-1",
      payload: {
        deepLink: "openclaw://chat?sessionKey=s1",
        title: "mention",
        body: "hi",
      },
      baseDir,
      env: {},
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.skipped).toBe("no_credentials");
    expect(results[0]?.ok).toBe(false);
  });

  it("sends when auth + registration present", async () => {
    const baseDir = await makeTempDir();
    await registerEmployeePushToken({
      accountId: "acct-1",
      deviceId: "iphone",
      platform: "ios",
      platformUserId: "user-1",
      token: "AAAA1234ABCD1234ABCD1234ABCD1234",
      topic: "ai.openbot.employee",
      baseDir,
    });

    const sendAlert = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      tokenSuffix: "abcd1234",
      topic: "ai.openbot.employee",
      environment: "sandbox",
    });

    const results = await enqueueEmployeePushForPlatformUser({
      platformUserId: "user-1",
      payload: {
        deepLink: "openclaw://chat?sessionKey=s1",
        title: "mention",
        body: "hi",
      },
      baseDir,
      resolveAuth: async () => ({
        ok: true,
        value: {
          teamId: "T",
          keyId: "K",
          privateKey: testAuthPrivateKey,
        },
      }),
      sendAlert,
    });
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(results[0]?.ok).toBe(true);
    const call = sendAlert.mock.calls[0]?.[0];
    expect(call?.payload.deepLink).toBe("openclaw://chat?sessionKey=s1");
  });
});
