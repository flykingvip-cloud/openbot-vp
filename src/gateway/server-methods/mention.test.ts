import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMentionState } from "../../organization/mention-state-tracker.js";
import type { RespondFn } from "./types.js";

const loadConfigMock = vi.hoisted(() => vi.fn());

vi.mock("../../config/config.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../config/config.js")>();
  return {
    ...original,
    loadConfig: loadConfigMock,
  };
});

const { mentionHandlers } = await import("./mention.js");

describe("mention gateway handlers", () => {
  beforeEach(() => {
    loadConfigMock.mockReset();
  });

  it("acknowledges an existing mention idempotently", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-mention-rpc-"));
    const cfg = { collaboration: { defaults: { workspace: root } } };
    loadConfigMock.mockReturnValue(cfg);
    await createMentionState({
      cfg,
      workspaceDir: root,
      organizationId: "org-1",
      mention_id: "mention-1",
      source_message_id: "message-1",
      source_agent_id: "agent-source",
      target_agent_id: "agent-target",
      now: "2026-05-12T00:00:00.000Z",
    });
    const respond = vi.fn();

    await mentionHandlers["mention.acknowledge"]({
      params: {
        mention_id: "mention-1",
        organizationId: "org-1",
        workspaceDir: root,
      },
      respond: respond as RespondFn,
      req: {} as never,
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    await mentionHandlers["mention.acknowledge"]({
      params: {
        mention_id: "mention-1",
        organizationId: "org-1",
        workspaceDir: root,
      },
      respond: respond as RespondFn,
      req: {} as never,
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(respond).toHaveBeenNthCalledWith(
      1,
      true,
      expect.objectContaining({
        mention_id: "mention-1",
        acknowledged: true,
        acknowledged_at: expect.any(String),
      }),
    );
    expect(respond).toHaveBeenNthCalledWith(
      2,
      true,
      expect.objectContaining({
        mention_id: "mention-1",
        acknowledged: true,
      }),
    );
  });

  it("rejects invalid acknowledge params", async () => {
    const respond = vi.fn();

    await mentionHandlers["mention.acknowledge"]({
      params: { organizationId: "org-1" },
      respond: respond as RespondFn,
      req: {} as never,
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
  });
});
