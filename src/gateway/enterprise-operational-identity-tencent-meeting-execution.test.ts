import { describe, expect, it, vi } from "vitest";
import * as api from "./enterprise-operational-identity-tencent-meeting-api.js";
import {
  executeTencentMeetingOperationalAction,
  parseEnterpriseOperationalIdentityTencentMeetingPayload,
} from "./enterprise-operational-identity-tencent-meeting-execution.js";

const secret = {
  credentialBindingId: "cb-1",
  tenantId: "t-1",
  connectorId: "tencent-meeting",
  kind: "oauth_token" as const,
  accessToken: "secret-key",
  metadata: {
    secretId: "sid",
    defaultUserId: "operator1",
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("parseEnterpriseOperationalIdentityTencentMeetingPayload", () => {
  it("accepts snake_case aliases", () => {
    expect(
      parseEnterpriseOperationalIdentityTencentMeetingPayload({
        subject: "Standup",
        start_time: 1700000000,
        end_time: 1700003600,
        meeting_id: "mid-1",
      }),
    ).toMatchObject({
      subject: "Standup",
      startTime: 1700000000,
      endTime: 1700003600,
      meetingId: "mid-1",
    });
  });
});

describe("executeTencentMeetingOperationalAction", () => {
  it("schedule_meeting returns joinUrl", async () => {
    vi.spyOn(api, "scheduleTencentMeeting").mockResolvedValue({
      meetingInfoList: [
        {
          meeting_id: "mid-1",
          meeting_code: "123456789",
          join_url: "https://meeting.tencent.com/dm/abc",
          subject: "Standup",
        },
      ],
    });
    const output = await executeTencentMeetingOperationalAction({
      action: "schedule_meeting",
      payload: {
        subject: "Standup",
        startTime: 1700000000,
        endTime: 1700003600,
      },
      secret,
    });
    expect(output.joinUrl).toBe("https://meeting.tencent.com/dm/abc");
    expect(output.meetingId).toBe("mid-1");
    vi.restoreAllMocks();
  });

  it("list_meetings returns the inner MCP list instead of an empty outer object", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  data: {
                    body: JSON.stringify({
                      total_count: 1,
                      meeting_info_list: [
                        {
                          meeting_id: "mid-cancelled",
                          subject: "acceptance",
                          status: "MEETING_STATE_CANCELLED",
                        },
                      ],
                    }),
                  },
                }),
              },
            ],
          },
        }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const output = await executeTencentMeetingOperationalAction({
        action: "list_meetings",
        payload: {},
        secret: {
          ...secret,
          accessToken: "mcp-token",
          metadata: {},
        },
      });
      expect(output.meetingNumber).toBe(1);
      const meetings = output.meetingInfoList as Array<Record<string, unknown>>;
      expect(meetings).toHaveLength(1);
      expect(meetings[0]?.status).toBe("MEETING_STATE_CANCELLED");
      expect(meetings[0]?.subject).toBe("acceptance");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ["get_meeting", { meetingId: "mid-get" }, { meeting_id: "mid-get", subject: "read" }],
    [
      "schedule_meeting",
      { subject: "book", startTime: 1700000000, endTime: 1700003600 },
      { meeting_id: "mid-new", subject: "book" },
    ],
    [
      "cancel_meeting",
      { meetingId: "mid-cancel" },
      { meeting_id: "mid-cancel", subject: "cancelled-row" },
    ],
  ] as const)("MCP %s reads the unwrapped body", async (action, payload, body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ data: { status_code: 200, body: JSON.stringify(body) } }),
                },
              ],
            },
          }),
      })),
    );
    try {
      const output = await executeTencentMeetingOperationalAction({
        action,
        payload,
        secret: { ...secret, accessToken: "mcp-token", metadata: {} },
      });
      expect(output.meetingId).toBe(body.meeting_id);
      if ("subject" in body) {
        expect(output.subject).toBe(body.subject);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects schedule_meeting without required fields", async () => {
    await expect(
      executeTencentMeetingOperationalAction({
        action: "schedule_meeting",
        payload: { subject: "Standup" },
        secret,
      }),
    ).rejects.toThrow("startTime");
  });
});
