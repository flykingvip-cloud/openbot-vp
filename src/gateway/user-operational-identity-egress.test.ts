import { describe, expect, it, vi } from "vitest";
import { resolveUserOperationalIdentityGatewayEgressIp } from "./user-operational-identity-egress.js";

describe("resolveUserOperationalIdentityGatewayEgressIp", () => {
  it("parses json ip payload", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ ip: "203.0.113.25" }),
    ) as unknown as typeof fetch;
    await expect(resolveUserOperationalIdentityGatewayEgressIp({ fetchImpl })).resolves.toBe(
      "203.0.113.25",
    );
  });

  it("returns null when lookup fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(resolveUserOperationalIdentityGatewayEgressIp({ fetchImpl })).resolves.toBeNull();
  });
});
