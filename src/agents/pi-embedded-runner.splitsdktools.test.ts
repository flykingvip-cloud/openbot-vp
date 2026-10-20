import { describe, expect, it } from "vitest";
import {
  applyEmbeddedCustomToolPolicy,
  resolveEmbeddedCustomToolAllowlist,
  splitSdkTools,
} from "./pi-embedded-runner.js";
import { createStubTool } from "./test-helpers/pi-tool-stubs.js";

describe("splitSdkTools", () => {
  const tools = [
    createStubTool("read"),
    createStubTool("exec"),
    createStubTool("edit"),
    createStubTool("write"),
    createStubTool("browser"),
  ];

  it("routes all tools to customTools when sandboxed", () => {
    const { builtInTools, customTools } = splitSdkTools({
      tools,
      sandboxEnabled: true,
    });
    expect(builtInTools).toEqual([]);
    expect(customTools.map((tool) => tool.name)).toEqual([
      "read",
      "exec",
      "edit",
      "write",
      "browser",
    ]);
  });

  it("routes all tools to customTools even when not sandboxed", () => {
    const { builtInTools, customTools } = splitSdkTools({
      tools,
      sandboxEnabled: false,
    });
    expect(builtInTools).toEqual([]);
    expect(customTools.map((tool) => tool.name)).toEqual([
      "read",
      "exec",
      "edit",
      "write",
      "browser",
    ]);
  });

  it("keeps custom tool names for the noTools:all allowlist", () => {
    expect(
      resolveEmbeddedCustomToolAllowlist([
        { name: "exec" },
        { name: " web_search " },
        { name: "exec" },
        { name: "" },
        {},
      ]),
    ).toEqual(["exec", "web_search"]);
  });

  it("drops blocked tool names from the embedded allowlist", () => {
    expect(
      resolveEmbeddedCustomToolAllowlist(
        [{ name: "exec" }, { name: "web_search" }, { name: "read" }],
        { block: ["web_search", "exec"] },
      ),
    ).toEqual(["read"]);
  });
});

describe("applyEmbeddedCustomToolPolicy", () => {
  const searchBlockTools = [
    { name: "exec" },
    { name: "web_search" },
    { name: "read" },
    { name: "ob_sk_weather__web_search" },
    { name: "ob_sk_search__notes" },
  ];

  it("maps block:search onto web_search and identity search/web_search tools", () => {
    const result = applyEmbeddedCustomToolPolicy(searchBlockTools, { block: ["search"] });
    expect(result.tools.map((t) => t.name)).toEqual(["exec", "read"]);
    expect(result.allowlist).toEqual(["exec", "read"]);
  });

  it("maps block:exec onto exec identity tools and keeps web_search", () => {
    const tools = [{ name: "exec" }, { name: "web_search" }, { name: "ob_sk_foo__exec" }];
    const result = applyEmbeddedCustomToolPolicy(tools, { block: ["exec"] });
    expect(result.tools.map((t) => t.name)).toEqual(["web_search"]);
    expect(result.allowlist).toEqual(["web_search"]);
  });

  it("keeps only weather-matching tools for allow:weather", () => {
    const tools = [
      { name: "weather" },
      { name: "exec" },
      { name: "web_search" },
      { name: "ob_sk_weather__web_search" },
      { name: "ob_sk_weather__notes" },
      { name: "ob_sk_search__notes" },
    ];
    const result = applyEmbeddedCustomToolPolicy(tools, { allow: ["weather"], block: [] });
    expect(result.tools.map((t) => t.name)).toEqual([
      "weather",
      "ob_sk_weather__web_search",
      "ob_sk_weather__notes",
    ]);
    expect(result.allowlist).toEqual([
      "weather",
      "ob_sk_weather__web_search",
      "ob_sk_weather__notes",
    ]);
  });

  it("keeps the full list for unrestricted personal-steward policy", () => {
    const result = applyEmbeddedCustomToolPolicy(searchBlockTools, { block: [] });
    expect(result.tools.map((t) => t.name)).toEqual(searchBlockTools.map((t) => t.name));
    expect(result.allowlist).toEqual([
      "exec",
      "web_search",
      "read",
      "ob_sk_weather__web_search",
      "ob_sk_search__notes",
    ]);
  });
});
