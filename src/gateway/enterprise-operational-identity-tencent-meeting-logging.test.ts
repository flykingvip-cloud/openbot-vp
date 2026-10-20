import { afterEach, describe, expect, it } from "vitest";
import { scheduleTencentMeeting } from "./enterprise-operational-identity-tencent-meeting-api.js";
import {
  buildTencentMeetingScheduleOutboundMeta,
  setTencentMeetingScheduleLogSinkForTests,
} from "./enterprise-operational-identity-tencent-meeting-logging.js";
import { callTencentMeetingMcpTool } from "./enterprise-operational-identity-tencent-meeting-mcp.js";

afterEach(() => {
  setTencentMeetingScheduleLogSinkForTests(null);
});

describe("buildTencentMeetingScheduleOutboundMeta", () => {
  it("keeps only desensitized schedule fields", () => {
    expect(
      buildTencentMeetingScheduleOutboundMeta({
        channel: "api",
        action: "schedule_meeting",
        subject: "Weekly sync",
        startTime: "1700000000",
        endTime: "1700003600",
        timeZone: "Asia/Shanghai",
        requestUri: "/v1/meetings",
      }),
    ).toEqual({
      channel: "api",
      action: "schedule_meeting",
      subject: "Weekly sync",
      startTime: "1700000000",
      endTime: "1700003600",
      timeZone: "Asia/Shanghai",
      requestUri: "/v1/meetings",
    });
  });
});

describe("schedule outbound logging", () => {
  it("logs API schedule start/end without secrets", async () => {
    const events: Array<{ message: string; meta: Record<string, unknown> }> = [];
    setTencentMeetingScheduleLogSinkForTests((message, meta) => {
      events.push({ message, meta });
    });
    const fetchMock = async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          meeting_info_list: [
            {
              meeting_id: "m1",
              join_url: "https://meeting.tencent.com/dm/abc",
              start_time: "1700000000",
              end_time: "1700003600",
            },
          ],
        }),
    });
    await scheduleTencentMeeting({
      config: {
        secretId: "sid-secret",
        secretKey: "skey-secret",
        defaultUserId: "operator1",
        defaultInstanceId: 1,
        defaultTimeZone: "Asia/Shanghai",
      },
      subject: "Weekly sync",
      startTime: 1700000000,
      endTime: 1700003600,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.message).toBe("tencent-meeting schedule outbound");
    expect(events[0]?.meta).toMatchObject({
      channel: "api",
      action: "schedule_meeting",
      subject: "Weekly sync",
      startTime: "1700000000",
      endTime: "1700003600",
      timeZone: "Asia/Shanghai",
      requestUri: "/v1/meetings",
    });
    const serialized = JSON.stringify(events[0]?.meta);
    expect(serialized).not.toContain("sid-secret");
    expect(serialized).not.toContain("skey-secret");
  });

  it("logs MCP schedule_meeting arguments without token", async () => {
    const events: Array<{ message: string; meta: Record<string, unknown> }> = [];
    setTencentMeetingScheduleLogSinkForTests((message, meta) => {
      events.push({ message, meta });
    });
    const fetchMock = async () => ({
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
                    status_code: 200,
                    body: {
                      meeting_id: "mid-obj",
                      subject: "obj",
                      start_time: "2026-07-01T10:00:00.000Z",
                    },
                  },
                }),
              },
            ],
          },
        }),
    });
    await callTencentMeetingMcpTool({
      token: "mcp-token-secret",
      name: "schedule_meeting",
      arguments: {
        subject: "obj",
        start_time: "2026-07-01T10:00:00.000Z",
        end_time: "2026-07-01T11:00:00.000Z",
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.meta).toMatchObject({
      channel: "mcp",
      action: "schedule_meeting",
      toolName: "schedule_meeting",
      subject: "obj",
      startTime: "2026-07-01T10:00:00.000Z",
      endTime: "2026-07-01T11:00:00.000Z",
    });
    expect(JSON.stringify(events[0]?.meta)).not.toContain("mcp-token-secret");
  });
});
