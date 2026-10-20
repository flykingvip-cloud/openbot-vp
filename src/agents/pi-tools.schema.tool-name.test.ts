import { describe, expect, it } from "vitest";
import {
  isValidProviderToolName,
  normalizeClientToolNamesForProvider,
  normalizeToolNamesForProvider,
  sanitizeToolName,
} from "./pi-tools.schema.js";
import type { AnyAgentTool } from "./pi-tools.types.js";
import {
  planProviderToolNames,
  sanitizeStreamContextForProvider,
  scrubProviderToolPayload,
} from "./provider-tool-names.js";

function fakeTool(name: string): AnyAgentTool {
  return {
    name,
    label: name,
    description: "test",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
  } as unknown as AnyAgentTool;
}

describe("provider tool name sanitization", () => {
  it("accepts OpenAI-compatible names", () => {
    expect(isValidProviderToolName("web_search")).toBe(true);
    expect(isValidProviderToolName("ob_sk_weather__web_search")).toBe(true);
    expect(isValidProviderToolName("read-file")).toBe(true);
  });

  it("rejects illegal characters and overlong names", () => {
    expect(isValidProviderToolName("file.read")).toBe(false);
    expect(isValidProviderToolName("db:query")).toBe(false);
    expect(isValidProviderToolName("数据查询")).toBe(false);
    expect(isValidProviderToolName("read file")).toBe(false);
    expect(isValidProviderToolName("a".repeat(65))).toBe(false);
  });

  it("sanitizes illegal characters and truncates", () => {
    expect(sanitizeToolName("file.read")).toBe("file_read");
    expect(sanitizeToolName("db:query")).toBe("db_query");
    expect(sanitizeToolName("read file")).toBe("read_file");
    expect(sanitizeToolName("数据查询")).toBe("unknown_tool");
    expect(sanitizeToolName(`x.${"a".repeat(80)}`)).toHaveLength(64);
  });

  it("renames agent tools and keeps dispatch name aligned", () => {
    const tools = normalizeToolNamesForProvider(
      [fakeTool("file.read"), fakeTool("web_search"), fakeTool("file.read")],
      { logWarnings: false },
    );
    expect(tools.map((tool) => tool.name)).toEqual(["file_read", "web_search", "file_read_2"]);
  });

  it("renames client tool function.name values", () => {
    const tools = normalizeClientToolNamesForProvider(
      [
        { type: "function" as const, function: { name: "db:query", description: "q" } },
        { type: "function" as const, function: { name: "ok_tool" } },
      ],
      { logWarnings: false },
    );
    expect(tools.map((tool) => tool.function.name)).toEqual(["db_query", "ok_tool"]);
  });
});

describe("last-mile provider tool name scrub", () => {
  const pattern = /^[a-zA-Z0-9_-]+$/;

  function assertLegal(names: string[]) {
    for (const name of names) {
      expect(name).toMatch(pattern);
      expect(name.length).toBeGreaterThan(0);
      expect(name.length).toBeLessThanOrEqual(64);
    }
    expect(new Set(names).size).toBe(names.length);
  }

  it("covers dots, colons, spaces, slashes, unicode, empty, duplicates, and length", () => {
    const originals = [
      "local_file.stat",
      "db:query",
      "read file",
      "src/path",
      "数据查询",
      "",
      "local_file.stat",
      "a".repeat(65),
      "ok_tool",
    ];
    const planned = planProviderToolNames(originals);
    assertLegal(planned.names);
    expect(planned.names[0]).toBe("local_file_stat");
    expect(planned.names[6]).toBe("local_file_stat_2");
    expect(planned.names[4]).toBe("unknown_tool");
    expect(planned.names[5]).toBe("unknown_tool_2");
    expect(planned.names[7]).toHaveLength(64);
    expect(planned.names[8]).toBe("ok_tool");
    expect(planned.reverse.get("local_file_stat")).toBe("local_file.stat");
  });

  it("rewrites a context copy and leaves registered tool objects unchanged", () => {
    const tool = fakeTool("local_file.stat");
    const other = fakeTool("web_search");
    const context = {
      tools: [tool, other],
      messages: [
        {
          role: "assistant",
          content: [{ type: "toolCall", name: "local_file.stat", arguments: { path: "a" } }],
        },
        { role: "toolResult", toolName: "local_file.stat", content: "ok" },
      ],
    };
    const sanitized = sanitizeStreamContextForProvider(context, { logWarnings: false });
    expect(tool.name).toBe("local_file.stat");
    expect(sanitized.context.tools?.[0]?.name).toBe("local_file_stat");
    expect(sanitized.context.tools?.[1]).toBe(other);
    const assistant = sanitized.context.messages?.[0] as {
      content: Array<{ name: string }>;
    };
    expect(assistant.content[0]?.name).toBe("local_file_stat");
    const toolResult = sanitized.context.messages?.[1] as { toolName?: string } | undefined;
    expect(toolResult?.toolName).toBe("local_file_stat");
    expect((context.messages[0]?.content[0] as { name?: string } | undefined)?.name).toBe(
      "local_file.stat",
    );
  });

  it("scrubs function.name on a provider payload after a late mutation", () => {
    const payload = {
      tools: [
        { type: "function", function: { name: "local_file.stat" } },
        { type: "function", function: { name: "read file" } },
        { type: "custom", custom: { name: "ns/tool" } },
      ],
      messages: [
        {
          role: "assistant",
          tool_calls: [{ function: { name: "local_file.stat", arguments: "{}" } }],
        },
      ],
      tool_choice: { type: "function", function: { name: "read file" } },
    };
    const reverse = scrubProviderToolPayload(payload);
    const names = [
      payload.tools[0].function!.name,
      payload.tools[1].function!.name,
      payload.tools[2].custom!.name,
    ];
    assertLegal(names);
    expect(names).toEqual(["local_file_stat", "read_file", "ns_tool"]);
    expect(payload.messages[0].tool_calls[0].function.name).toBe("local_file_stat");
    expect(payload.tool_choice.function.name).toBe("read_file");
    expect(reverse.get("local_file_stat")).toBe("local_file.stat");
  });
});
