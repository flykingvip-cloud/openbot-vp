import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendWebhookMessageDiscord } from "./send.js";

const guardRelease = vi.hoisted(() => vi.fn());
const guardOptions = vi.hoisted(() => vi.fn());
vi.mock("../infra/net/fetch-guard.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infra/net/fetch-guard.js")>();
  return {
    ...actual,
    fetchWithSsrFGuard: async (params: Parameters<typeof actual.fetchWithSsrFGuard>[0]) => {
      guardOptions(params);
      const result = await actual.fetchWithSsrFGuard({
        ...params,
        lookupFn: (async () => [{ address: "93.184.216.34", family: 4 }]) as unknown as NonNullable<
          Parameters<typeof actual.fetchWithSsrFGuard>[0]["lookupFn"]
        >,
      });
      return {
        ...result,
        release: async () => {
          guardRelease();
          await result.release();
        },
      };
    },
  };
});

const recordChannelActivityMock = vi.hoisted(() => vi.fn());
const loadConfigMock = vi.hoisted(() => vi.fn(() => ({ channels: { discord: {} } })));

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => loadConfigMock(),
  };
});

vi.mock("../infra/channel-activity.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infra/channel-activity.js")>();
  return {
    ...actual,
    recordChannelActivity: (...args: unknown[]) => recordChannelActivityMock(...args),
  };
});

describe("sendWebhookMessageDiscord activity", () => {
  beforeEach(() => {
    guardRelease.mockClear();
    guardOptions.mockClear();
    recordChannelActivityMock.mockClear();
    loadConfigMock.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ id: "msg-1", channel_id: "thread-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records outbound channel activity for webhook sends", async () => {
    const cfg = {
      channels: {
        discord: {
          token: "resolved-token",
        },
      },
    };
    const result = await sendWebhookMessageDiscord("hello world", {
      cfg,
      webhookId: "wh-1",
      webhookToken: "tok-1",
      accountId: "runtime",
      threadId: "thread-1",
    });

    expect(result).toEqual({
      messageId: "msg-1",
      channelId: "thread-1",
    });
    expect(recordChannelActivityMock).toHaveBeenCalledWith({
      channel: "discord",
      accountId: "runtime",
      direction: "outbound",
    });
    expect(loadConfigMock).not.toHaveBeenCalled();
  });
  it("preserves webhook URL, reply payload and releases a successful response", async () => {
    await sendWebhookMessageDiscord("reply", {
      webhookId: "wh-1",
      webhookToken: "tok-1",
      threadId: "thread-1",
      replyTo: "parent",
      username: "robot",
    });
    expect(guardOptions).toHaveBeenCalledWith(
      expect.objectContaining({ redactPathInAudit: true, maxRedirects: 0 }),
    );
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(
      "https://discord.com/api/v10/webhooks/wh-1/tok-1?wait=true&thread_id=thread-1",
    );
    expect(init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(typeof init?.body).toBe("string");
    expect(JSON.parse(init?.body as string)).toMatchObject({
      content: "reply",
      username: "robot",
      message_reference: { message_id: "parent", fail_if_not_exists: false },
    });
    expect(guardRelease).toHaveBeenCalledTimes(1);
  });
  it("preserves wait=false empty responses and releases resources", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(
      await sendWebhookMessageDiscord("reply", {
        webhookId: "wh-1",
        webhookToken: "tok-1",
        threadId: "thread-1",
        wait: false,
      }),
    ).toEqual({ messageId: "unknown", channelId: "thread-1" });
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain("wait=false");
    expect(guardRelease).toHaveBeenCalledTimes(1);
  });
  it("releases resources after API failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    await expect(
      sendWebhookMessageDiscord("reply", { webhookId: "wh-1", webhookToken: "tok-1" }),
    ).rejects.toThrow("Discord webhook send failed (429: rate limited)");
    expect(guardRelease).toHaveBeenCalledTimes(1);
  });
  it("does not forward webhook credentials through redirects", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "https://example.com/collect" } }),
    );
    await expect(
      sendWebhookMessageDiscord("reply", { webhookId: "wh-1", webhookToken: "tok-1" }),
    ).rejects.toThrow(/redirect/i);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
