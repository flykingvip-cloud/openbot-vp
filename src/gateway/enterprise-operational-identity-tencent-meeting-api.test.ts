import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  buildTencentMeetingSignature,
  resolveTencentMeetingClientConfig,
  scheduleTencentMeeting,
  tencentMeetingApiRequest,
  verifyTencentMeetingCredentials,
} from "./enterprise-operational-identity-tencent-meeting-api.js";

describe("buildTencentMeetingSignature", () => {
  it("matches Tencent Meeting AK/SK signing example shape", () => {
    const signed = buildTencentMeetingSignature({
      secretId: "SecretIdExample",
      secretKey: "SecretKeyExample",
      httpMethod: "POST",
      requestUri: "/v1/meetings",
      requestBody: '{"userid":"operator1","instanceid":1}',
      timestamp: "1590067957",
      nonce: "1590067957",
    });
    const expectedSignStr = [
      "POST",
      "X-TC-Key=SecretIdExample&X-TC-Nonce=1590067957&X-TC-Timestamp=1590067957",
      "/v1/meetings",
      '{"userid":"operator1","instanceid":1}',
    ].join("\n");
    const digestHex = createHmac("sha256", "SecretKeyExample")
      .update(expectedSignStr)
      .digest("hex");
    const expectedSignature = Buffer.from(digestHex, "utf8").toString("base64");
    expect(signed.signature).toBe(expectedSignature);
  });
});

describe("resolveTencentMeetingClientConfig", () => {
  it("requires secretId, secretKey and defaultUserId", () => {
    expect(
      resolveTencentMeetingClientConfig({
        secretId: "sid",
        secretKey: "skey",
        defaultUserId: "operator1",
      }),
    ).toMatchObject({
      secretId: "sid",
      secretKey: "skey",
      defaultUserId: "operator1",
      defaultInstanceId: 1,
      defaultTimeZone: "Asia/Shanghai",
    });
    expect(resolveTencentMeetingClientConfig({ secretId: "sid" })).toBeNull();
  });
});

describe("verifyTencentMeetingCredentials", () => {
  it("calls list meetings probe with signed headers", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ meeting_number: 0, meeting_info_list: [] }),
    }));
    await verifyTencentMeetingCredentials({
      config: {
        secretId: "sid",
        secretKey: "skey",
        defaultUserId: "operator1",
        defaultInstanceId: 1,
        defaultTimeZone: "Asia/Shanghai",
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const probeCall = fetchMock.mock.calls[0] as unknown as readonly [string, RequestInit];
    const url = probeCall[0];
    const init = probeCall[1];
    expect(url).toContain("/v1/meetings?");
    expect(url).toContain("userid=operator1");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-TC-Key"]).toBe("sid");
    expect(headers["X-TC-Signature"]).toBeTruthy();
  });
});

describe("scheduleTencentMeeting", () => {
  it("returns joinUrl from meeting_info_list", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          meeting_info_list: [
            {
              meeting_id: "7567173273889276131",
              meeting_code: "123456789",
              subject: "Weekly sync",
              join_url: "https://meeting.tencent.com/dm/abc",
              start_time: "1700000000",
              end_time: "1700003600",
            },
          ],
        }),
    }));
    const result = await scheduleTencentMeeting({
      config: {
        secretId: "sid",
        secretKey: "skey",
        defaultUserId: "operator1",
        defaultInstanceId: 1,
        defaultTimeZone: "Asia/Shanghai",
      },
      subject: "Weekly sync",
      startTime: 1700000000,
      endTime: 1700003600,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.meetingInfoList[0]?.join_url).toBe("https://meeting.tencent.com/dm/abc");
    const scheduleCall = fetchMock.mock.calls[0] as unknown as readonly [string, RequestInit];
    const headers = scheduleCall[1].headers as Record<string, string>;
    expect(headers["X-TC-Registered"]).toBe("1");
    const rawBody = scheduleCall[1].body;
    expect(typeof rawBody).toBe("string");
    const requestBody = JSON.parse(rawBody as string) as Record<string, unknown>;
    expect(requestBody.start_time).toBe("1700000000");
    expect(requestBody.end_time).toBe("1700003600");
  });
});

describe("tencentMeetingApiRequest", () => {
  it("throws API error payload message", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          error_info: { error_code: 200003, message: "signature failed" },
        }),
    })) as unknown as typeof fetch;
    await expect(
      tencentMeetingApiRequest({
        config: {
          secretId: "sid",
          secretKey: "skey",
          defaultUserId: "operator1",
          defaultInstanceId: 1,
          defaultTimeZone: "Asia/Shanghai",
        },
        method: "GET",
        requestUri: "/v1/meetings?userid=operator1&instanceid=1&page=1&page_size=1",
        fetchImpl,
      }),
    ).rejects.toThrow("signature failed");
  });
});
