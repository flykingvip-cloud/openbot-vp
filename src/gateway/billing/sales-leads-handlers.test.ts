// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { salesLeadsHandlers } from "./sales-leads-handlers.js";

type RespondCall = [boolean, unknown?, unknown?];

function invokeSubmit(params: Record<string, unknown>) {
  const calls: RespondCall[] = [];
  const respond = vi.fn((ok: boolean, result?: unknown, error?: unknown) => {
    calls.push([ok, result, error]);
  });
  const handler = salesLeadsHandlers["sales-leads.submit"];
  return { calls, respond, run: () => handler({ client: null, params, respond } as never) };
}

describe("sales-leads.submit validation", () => {
  it("缺少 company 被拒（不落库）", async () => {
    const { calls, run } = invokeSubmit({ contact: "a", phone: "1" });
    await run();
    expect(calls[0]?.[0]).toBe(false);
  });

  it("缺少 contact 被拒", async () => {
    const { calls, run } = invokeSubmit({ company: "A", phone: "1" });
    await run();
    expect(calls[0]?.[0]).toBe(false);
  });

  it("缺少 phone 被拒", async () => {
    const { calls, run } = invokeSubmit({ company: "A", contact: "a" });
    await run();
    expect(calls[0]?.[0]).toBe(false);
  });
});
