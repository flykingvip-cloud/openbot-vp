// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  runtimeMessageFromError,
  runtimeMessageGatewayStaleHint,
} from "./knowledge-universe-runtime-messages.ts";

describe("knowledge-universe runtime messages", () => {
  it("maps unknown knowledge gateway methods to a stale-gateway hint", () => {
    expect(
      runtimeMessageFromError(
        new Error("unknown method: knowledge.actions.list"),
        () => "fallback",
      ),
    ).toBe(runtimeMessageGatewayStaleHint());
  });

  it("preserves other error messages", () => {
    expect(runtimeMessageFromError(new Error("network timeout"), () => "fallback")).toBe(
      "network timeout",
    );
  });
});
