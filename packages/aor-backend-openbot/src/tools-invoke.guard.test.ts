import { describe, expect, it } from "vitest";
import { OpenBotToolsInvokeClient } from "./tools-invoke.js";

describe("OpenBotToolsInvokeClient URL guard", () => {
  it("rejects non-HTTP base URLs at construction", () => {
    expect(() => new OpenBotToolsInvokeClient({ baseUrl: "rpc://openbot-gateway" })).toThrow(
      /HTTP\(S\)/,
    );
  });
});
