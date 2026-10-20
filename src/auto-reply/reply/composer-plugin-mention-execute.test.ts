import { describe, expect, it, vi } from "vitest";
import type { AnyAgentTool } from "../../agents/tools/common.js";
import type { ComposerPluginMentionBindings } from "./composer-plugin-mention-bindings.js";
import {
  buildToolArgsFromUserMessage,
  executeComposerPluginMentionsForTurn,
  resolveComposerPluginMentionTaskMessage,
} from "./composer-plugin-mention-execute.js";

function makeTool(params: {
  name: string;
  pluginId: string;
  properties: Record<string, unknown>;
  execute: AnyAgentTool["execute"];
}): AnyAgentTool & { __pluginId: string } {
  return {
    name: params.name,
    description: params.name,
    parameters: { type: "object", properties: params.properties },
    execute: params.execute,
    __pluginId: params.pluginId,
  } as AnyAgentTool & { __pluginId: string };
}

describe("buildToolArgsFromUserMessage", () => {
  it("maps the user message onto prompt (and action=run when present)", () => {
    expect(
      buildToolArgsFromUserMessage(
        {
          parameters: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["run", "resume"] },
              prompt: { type: "string" },
            },
          },
        },
        "summarize the report",
      ),
    ).toEqual({ action: "run", prompt: "summarize the report" });
  });

  it("prefers command when present (skill-dispatch style)", () => {
    expect(
      buildToolArgsFromUserMessage(
        {
          parameters: {
            type: "object",
            properties: { command: { type: "string" }, other: { type: "string" } },
          },
        },
        "do the thing",
      ),
    ).toEqual({ command: "do the thing" });
  });
});

describe("resolveComposerPluginMentionTaskMessage", () => {
  it("strips @plugin chips and keeps the task text", () => {
    const text = "请用 @GitHub 查一下 PR 321";
    const githubAt = text.indexOf("@GitHub");
    expect(
      resolveComposerPluginMentionTaskMessage({
        rawMessage: text,
        mentions: [
          {
            mention_id: "m1",
            displayName: "GitHub",
            offset: githubAt,
            length: "@GitHub".length,
            target: { kind: "plugin", pluginId: "plugin:connector:github-personal:id-github" },
            targetKind: "plugin",
            targetId: "plugin:connector:github-personal:id-github",
          },
        ],
      }),
    ).toBe("请用 查一下 PR 321");
  });
});

describe("executeComposerPluginMentionsForTurn", () => {
  it("host-executes OpenBot plugin tools with args derived from the user message", async () => {
    const execute = vi.fn(async () => ({
      content: [{ type: "text", text: "plugin-ran" }],
    }));
    const tool = makeTool({
      name: "origin_search",
      pluginId: "origin",
      properties: { prompt: { type: "string" } },
      execute: execute as unknown as AnyAgentTool["execute"],
    });

    const bindings: ComposerPluginMentionBindings = {
      connectors: [],
      plugins: [
        {
          openBotPluginId: "origin",
          pluginId: "plugin:ext:origin",
          displayName: "Origin",
        },
      ],
      pluginToolAllowlist: ["origin"],
    };

    const result = await executeComposerPluginMentionsForTurn({
      bindings,
      userMessage: "请用 @Origin 搜索 openbot PR",
      mentions: [
        {
          mention_id: "m-origin",
          displayName: "Origin",
          offset: 3,
          length: "@Origin".length,
          target: { kind: "plugin", pluginId: "plugin:ext:origin" },
          targetKind: "plugin",
          targetId: "plugin:ext:origin",
        },
      ],
      resolveTools: () => [tool],
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const [, args] = (execute.mock.calls[0] ?? []) as unknown[];
    expect(args).toEqual({ prompt: "请用 搜索 openbot PR" });
    expect(result.calls).toEqual([
      expect.objectContaining({
        kind: "plugin",
        pluginId: "plugin:ext:origin",
        toolName: "origin_search",
        ok: true,
        args: { prompt: "请用 搜索 openbot PR" },
        resultText: "plugin-ran",
      }),
    ]);
    expect(result.summaryPrompt).toContain("origin_search");
  });

  it("host-executes user_operational_identity for connector mentions with the message in args", async () => {
    const execute = vi.fn(async () => ({
      content: [{ type: "text", text: '{"ok":true,"entries":[]}' }],
    }));
    const identityTool = {
      name: "user_operational_identity",
      description: "identity",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string" },
          provider: { type: "string" },
          message: { type: "string" },
        },
      },
      execute,
    } as unknown as AnyAgentTool;

    const bindings: ComposerPluginMentionBindings = {
      connectors: [
        {
          provider: "github-personal",
          identityId: "id-github",
          displayName: "GitHub",
          pluginId: "plugin:connector:github-personal:id-github",
        },
      ],
      plugins: [],
      pluginToolAllowlist: [],
    };

    const result = await executeComposerPluginMentionsForTurn({
      bindings,
      userMessage: "@GitHub 查一下这个 PR",
      mentions: [
        {
          mention_id: "m-gh",
          displayName: "GitHub",
          offset: 0,
          length: "@GitHub".length,
          target: {
            kind: "plugin",
            pluginId: "plugin:connector:github-personal:id-github",
          },
          targetKind: "plugin",
          targetId: "plugin:connector:github-personal:id-github",
        },
      ],
      createIdentityTool: () => identityTool,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const [, args] = (execute.mock.calls[0] ?? []) as unknown[];
    expect(args).toMatchObject({
      action: "list",
      provider: "github-personal",
      message: "查一下这个 PR",
    });
    expect(String((args as { message?: string }).message)).toContain("查一下这个 PR");
    expect(result.calls[0]).toMatchObject({
      kind: "connector",
      toolName: "user_operational_identity",
      ok: true,
    });
  });

  it("does not call execute when there are no plugin mentions", async () => {
    const execute = vi.fn();
    const result = await executeComposerPluginMentionsForTurn({
      bindings: { connectors: [], plugins: [], pluginToolAllowlist: [] },
      userMessage: "hello",
      resolveTools: () => [
        makeTool({
          name: "x",
          pluginId: "x",
          properties: { prompt: { type: "string" } },
          execute,
        }),
      ],
    });
    expect(execute).not.toHaveBeenCalled();
    expect(result.calls).toEqual([]);
  });
});
