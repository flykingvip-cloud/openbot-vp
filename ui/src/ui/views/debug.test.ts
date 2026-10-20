// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderDebug } from "./debug.ts";

function createDebugProps(
  overrides: Partial<Parameters<typeof renderDebug>[0]> = {},
): Parameters<typeof renderDebug>[0] {
  return {
    loading: false,
    status: {},
    health: {},
    models: [],
    heartbeat: {},
    eventLog: [],
    onRefresh: () => undefined,
    ...overrides,
  };
}

describe("debug page permissions (browser)", () => {
  it("renders snapshots without exposing manual rpc controls", async () => {
    const container = document.createElement("div");
    render(renderDebug(createDebugProps()), container);
    await Promise.resolve();

    expect(container.textContent ?? "").toContain("Snapshots");
    expect(container.textContent ?? "").not.toContain("Manual RPC");
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
  });
});
