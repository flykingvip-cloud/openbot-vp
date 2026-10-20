import { describe, expect, it, vi } from "vitest";
import { resolveChatSendCronContext, runAppChatSend } from "./chat-send.ts";

describe("chat-send wiring", () => {
  it("prefers explicit cronReplyContext over host state", () => {
    const host = {
      chatCronReplyContext: { jobId: "host-job" },
      chatMessages: [],
    };
    expect(
      resolveChatSendCronContext(host, {
        cronReplyContext: { jobId: "explicit-job" },
      }),
    ).toEqual({ jobId: "explicit-job" });
  });

  it("falls back to host chatCronReplyContext", () => {
    const host = {
      chatCronReplyContext: { jobId: "host-job", runId: "run-1" },
      chatMessages: [],
    };
    expect(resolveChatSendCronContext(host)).toEqual({
      jobId: "host-job",
      runId: "run-1",
    });
  });

  it("clears host cron context after send", async () => {
    const host = {
      chatCronReplyContext: { jobId: "host-job" },
      chatMessages: [],
    };
    const send = vi.fn().mockResolvedValue(undefined);
    await runAppChatSend(host, send, {} as never, "hello", undefined);
    expect(send).toHaveBeenCalledWith(
      {},
      "hello",
      expect.objectContaining({ cronReplyContext: { jobId: "host-job" } }),
    );
    expect(host.chatCronReplyContext).toBeNull();
  });

  it("does not infer cronReplyContext from a leftover cron result card (EA-B1)", () => {
    const host = {
      chatCronReplyContext: null,
      chatMessages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "定时任务结果" }],
          openclawCronResult: { jobId: "progress-ledger-job" },
        },
      ],
    };
    expect(resolveChatSendCronContext(host)).toBeUndefined();
  });

  it("forwards focusSwitchProceed through runAppChatSend options", async () => {
    const host = {
      chatCronReplyContext: null,
      chatMessages: [],
    };
    const send = vi.fn().mockResolvedValue(undefined);
    await runAppChatSend(host, send, {} as never, "新调研", {
      focusSwitchProceed: true,
    });
    expect(send).toHaveBeenCalledWith(
      {},
      "新调研",
      expect.objectContaining({ focusSwitchProceed: true }),
    );
  });

  it("forwards focusSwitchCancel through runAppChatSend options", async () => {
    const host = {
      chatCronReplyContext: null,
      chatMessages: [],
    };
    const send = vi.fn().mockResolvedValue(undefined);
    await runAppChatSend(host, send, {} as never, "新调研", {
      focusSwitchCancel: true,
    });
    expect(send).toHaveBeenCalledWith(
      {},
      "新调研",
      expect.objectContaining({ focusSwitchCancel: true }),
    );
  });

  it("forwards growthGateProceed through runAppChatSend options", async () => {
    const host = {
      chatCronReplyContext: null,
      chatMessages: [],
    };
    const send = vi.fn().mockResolvedValue(undefined);
    await runAppChatSend(host, send, {} as never, "继续原任务", {
      growthGateProceed: true,
    });
    expect(send).toHaveBeenCalledWith(
      {},
      "继续原任务",
      expect.objectContaining({ growthGateProceed: true }),
    );
  });
});
