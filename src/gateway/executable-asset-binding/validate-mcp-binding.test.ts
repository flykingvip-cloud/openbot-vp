import { describe, expect, it } from "vitest";
import { validateMcpAssetBinding } from "./validate-mcp-binding.js";

describe("validateMcpAssetBinding", () => {
  it("accepts stdio binding", () => {
    const result = validateMcpAssetBinding({
      serverName: "consult-win-advisor",
      transport: "stdio",
      command: "node",
      args: ["server.js"],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects missing command and url", () => {
    const result = validateMcpAssetBinding({
      serverName: "broken",
      transport: "stdio",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.field === "transport")).toBe(true);
    }
  });
});
