import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../protocol/index.js";
import { employeePushHandlers } from "./employee-push.js";

vi.mock("../../infra/employee-push.js", () => ({
  registerEmployeePushToken: vi.fn(),
  unregisterEmployeePushToken: vi.fn(),
  enqueueEmployeePushForPlatformUser: vi.fn(),
}));

import {
  enqueueEmployeePushForPlatformUser,
  registerEmployeePushToken,
  unregisterEmployeePushToken,
} from "../../infra/employee-push.js";

type RespondCall = [boolean, unknown?, { code: number; message: string }?];

function createInvoke(
  method: keyof typeof employeePushHandlers,
  params: Record<string, unknown>,
  client: { platformUserId?: string } | null,
) {
  const respond = vi.fn();
  return {
    respond,
    invoke: async () =>
      await employeePushHandlers[method]({
        params,
        respond: respond as never,
        context: {} as never,
        client: client as never,
        req: { type: "req", id: "req-1", method },
        isWebchatConnect: () => false,
      }),
  };
}

describe("employee.push handlers", () => {
  beforeEach(() => {
    vi.mocked(registerEmployeePushToken).mockReset();
    vi.mocked(unregisterEmployeePushToken).mockReset();
    vi.mocked(enqueueEmployeePushForPlatformUser).mockReset();
  });

  it("register rejects without platformUserId (isolation from anonymous/node)", async () => {
    const { respond, invoke } = createInvoke(
      "employee.push.register",
      {
        accountId: "a1",
        deviceId: "d1",
        platform: "ios",
        token: "abcd",
      },
      null,
    );
    await invoke();
    const call = respond.mock.calls[0] as RespondCall;
    expect(call[0]).toBe(false);
    expect(call[2]?.code).toBe(ErrorCodes.INVALID_REQUEST);
    expect(call[2]?.message).toContain("platformUserId");
    expect(registerEmployeePushToken).not.toHaveBeenCalled();
  });

  it("register upserts with session platformUserId", async () => {
    vi.mocked(registerEmployeePushToken).mockResolvedValue({
      accountId: "a1",
      deviceId: "d1",
      platform: "ios",
      platformUserId: "user-1",
      token: "abcd1234abcd1234abcd1234abcd1234",
      topic: "ai.openbot.employee",
      environment: "sandbox",
      updatedAtMs: 1,
    });
    const { respond, invoke } = createInvoke(
      "employee.push.register",
      {
        accountId: "a1",
        deviceId: "d1",
        platform: "ios",
        token: "ABCD1234ABCD1234ABCD1234ABCD1234",
        topic: "ai.openbot.employee",
      },
      { platformUserId: "user-1" },
    );
    await invoke();
    expect(registerEmployeePushToken).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "a1",
        platformUserId: "user-1",
        platform: "ios",
      }),
    );
    const call = respond.mock.calls[0] as RespondCall;
    expect(call[0]).toBe(true);
  });

  it("test requires deepLink-capable enqueue and reports credentials-required", async () => {
    vi.mocked(enqueueEmployeePushForPlatformUser).mockResolvedValue([
      {
        accountId: "a1",
        deviceId: "d1",
        platform: "ios",
        ok: false,
        status: 0,
        skipped: "no_credentials",
        reason:
          "Employee APNs auth missing: set OPENBOT_EMPLOYEE_APNS_TEAM_ID and OPENBOT_EMPLOYEE_APNS_KEY_ID",
      },
    ]);
    const { respond, invoke } = createInvoke(
      "employee.push.test",
      { deepLink: "openclaw://employee/overview" },
      { platformUserId: "user-1" },
    );
    await invoke();
    expect(enqueueEmployeePushForPlatformUser).toHaveBeenCalledWith(
      expect.objectContaining({
        platformUserId: "user-1",
        payload: expect.objectContaining({
          deepLink: "openclaw://employee/overview",
        }),
      }),
    );
    const call = respond.mock.calls[0] as RespondCall;
    expect(call[0]).toBe(false);
    expect(call[2]?.message).toMatch(/credentials|OPENBOT_EMPLOYEE_APNS/i);
  });

  it("unregister requires session and calls store", async () => {
    vi.mocked(unregisterEmployeePushToken).mockResolvedValue({ removed: 1 });
    const { respond, invoke } = createInvoke(
      "employee.push.unregister",
      { accountId: "a1", deviceId: "d1", platform: "ios" },
      { platformUserId: "user-1" },
    );
    await invoke();
    expect(unregisterEmployeePushToken).toHaveBeenCalled();
    expect(respond.mock.calls[0]?.[0]).toBe(true);
  });
});
