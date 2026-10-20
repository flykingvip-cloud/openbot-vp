import { describe, expect, it, vi } from "vitest";
import {
  TENCENT_MEETING_MCP_URL,
  callTencentMeetingMcpTool,
  unwrapTencentMeetingMcpPayload,
  verifyTencentMeetingMcpToken,
} from "./enterprise-operational-identity-tencent-meeting-mcp.js";
import { recordOrNull as asRecord } from "./records.js";

describe("verifyTencentMeetingMcpToken", () => {
  it("sends tools/list with X-Tencent-Meeting-Token", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { tools: [{ name: "schedule_meeting" }] },
        }),
    }));
    await verifyTencentMeetingMcpToken({
      token: "skill-token",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as readonly [string, RequestInit];
    expect(url).toBe(TENCENT_MEETING_MCP_URL);
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Tencent-Meeting-Token"]).toBe("skill-token");
    expect(typeof init.body).toBe("string");
    const body = JSON.parse(init.body as string) as { method: string };
    expect(body.method).toBe("tools/list");
  });
});

describe("callTencentMeetingMcpTool", () => {
  it("unwraps meeting_info_list from data.body", async () => {
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
                    status_code: 200,
                    body: JSON.stringify({
                      total_count: 1,
                      meeting_info_list: [
                        {
                          meeting_id: "mid-1",
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
    const result = await callTencentMeetingMcpTool({
      token: "mcp-token",
      name: "get_user_meetings",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(result.data.meeting_info_list).toEqual([
      { meeting_id: "mid-1", subject: "acceptance", status: "MEETING_STATE_CANCELLED" },
    ]);
    expect(result.data.data).toBeUndefined();
  });

  it("keeps a direct meeting payload", async () => {
    const result = await callTencentMeetingMcpTool({
      token: "mcp-token",
      name: "get_meeting",
      fetchImpl: toolText({ meeting_id: "mid-direct", subject: "direct" }),
    });
    expect(result.data.meeting_id).toBe("mid-direct");
  });

  it("unwraps a data.body object", async () => {
    const result = await callTencentMeetingMcpTool({
      token: "mcp-token",
      name: "schedule_meeting",
      fetchImpl: toolText({
        data: { status_code: 200, body: { meeting_id: "mid-obj", subject: "obj" } },
      }),
    });
    expect(result.data.meeting_id).toBe("mid-obj");
  });

  it("keeps the outer object when data.body is empty", () => {
    expect(unwrapTencentMeetingMcpPayload({ data: { body: "" }, meeting_id: "outer" })).toEqual({
      data: { body: "" },
      meeting_id: "outer",
    });
  });

  it("keeps the outer object when data.body is invalid JSON", () => {
    expect(unwrapTencentMeetingMcpPayload({ data: { body: "{" } })).toEqual({
      data: { body: "{" },
    });
  });

  it("rejects an MCP error response", async () => {
    await expect(
      callTencentMeetingMcpTool({
        token: "mcp-token",
        name: "cancel_meeting",
        fetchImpl: rpcText({ error: { code: -32000, message: "rejected" } }),
      }),
    ).rejects.toThrow("rejected");
  });

  it("keeps the outer object when data.body is whitespace", () => {
    expect(unwrapTencentMeetingMcpPayload({ data: { body: "  \n" }, meeting_id: "outer" })).toEqual(
      {
        data: { body: "  \n" },
        meeting_id: "outer",
      },
    );
  });

  it.each(["[]", "1", '"text"'])(
    "keeps the outer object when data.body JSON is not an object (%s)",
    (body) => {
      expect(unwrapTencentMeetingMcpPayload({ data: { body }, marker: "outer" }).marker).toBe(
        "outer",
      );
    },
  );

  it("does not unwrap a second nested body", () => {
    const once = unwrapTencentMeetingMcpPayload({
      data: {
        body: JSON.stringify({ data: { body: JSON.stringify({ meeting_id: "inner" }) } }),
      },
    });
    expect(once.meeting_id).toBeUndefined();
    expect(asRecord(once.data)?.body).toEqual(JSON.stringify({ meeting_id: "inner" }));
  });

  it("rejects an HTTP provider error", async () => {
    await expect(
      callTencentMeetingMcpTool({
        token: "mcp-token",
        name: "get_meeting",
        fetchImpl: (async () => ({
          ok: false,
          status: 502,
          text: async () => "",
        })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("502");
  });

  it("rejects an outer business status", async () => {
    await expect(
      callTencentMeetingMcpTool({
        token: "mcp-token",
        name: "list_meetings",
        fetchImpl: toolText({ data: { status_code: 403, body: {} } }),
      }),
    ).rejects.toThrow("403");
  });

  it("rejects a nested business error code", async () => {
    await expect(
      callTencentMeetingMcpTool({
        token: "mcp-token",
        name: "list_meetings",
        fetchImpl: toolText({
          data: {
            status_code: 200,
            body: JSON.stringify({ error_code: 190001, message: "denied" }),
          },
        }),
      }),
    ).rejects.toThrow("190001");
  });
});

function toolText(payload: Record<string, unknown>) {
  return rpcText({
    result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
  });
}

function rpcText(payload: Record<string, unknown>) {
  return (async () => ({
    ok: true,
    text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, ...payload }),
  })) as unknown as typeof fetch;
}
