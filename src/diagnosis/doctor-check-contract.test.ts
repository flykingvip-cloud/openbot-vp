import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import {
  DOCTOR_CHECK_ENTRY,
  DOCTOR_REPAIR_ENTRY,
  assertDoctorCheckInputReadOnly,
  runDoctorChecks,
} from "./doctor-check-contract.js";
import { createDoctorCheckContractAdapter } from "./phase2.js";
import type { TrustedTenantContext } from "./types.js";

function config(partial: OpenBotConfig = {}): OpenBotConfig {
  return partial;
}

describe("Doctor read-only check contract", () => {
  it("emits only structured check rows", () => {
    const rows = runDoctorChecks({
      config: config({ gateway: { mode: "local" } }),
      env: {},
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => typeof row.checkId === "string")).toBe(true);
    expect(rows.every((row) => ["pass", "warn", "fail"].includes(row.verdict))).toBe(true);
    expect(rows.every((row) => typeof row.pathLabel === "string")).toBe(true);
  });

  it("fails when gateway.mode is unset and when auth mode is ambiguous", () => {
    const unset = runDoctorChecks({ config: config({}), env: {} });
    expect(unset.find((row) => row.checkId === "gateway-mode")?.verdict).toBe("fail");

    const ambiguous = runDoctorChecks({
      config: config({
        gateway: {
          mode: "local",
          auth: { token: "token-a", password: "password-b" },
        },
      }),
      env: {},
    });
    expect(ambiguous.find((row) => row.checkId === "gateway-auth-mode")?.verdict).toBe("fail");
  });

  it("rejects repair/fix/yes on the check contract", () => {
    expect(() => assertDoctorCheckInputReadOnly({ repair: true })).toThrow(/refuses repair/);
    expect(() =>
      runDoctorChecks({
        config: config({}),
        env: {},
        repair: true,
      } as never),
    ).toThrow(/refuses repair/);
    expect(DOCTOR_CHECK_ENTRY).toBe("runDoctorChecks");
    expect(DOCTOR_REPAIR_ENTRY).not.toBe(DOCTOR_CHECK_ENTRY);
  });

  it("returns the same check rows for CLI reuse and the Diagnosis adapter", async () => {
    const input = {
      config: config({
        gateway: { mode: "local" },
        agents: {
          defaults: { sandbox: { scope: "shared" } },
          list: [
            {
              id: "work",
              sandbox: { scope: "shared", docker: { setupCommand: "echo work" } },
            },
          ],
        },
      }),
      env: {},
    };
    const rows = runDoctorChecks(input);
    const adapter = createDoctorCheckContractAdapter(input);
    const collected = await adapter.collect(
      {
        schemaVersion: 1,
        evidenceType: "config_check",
        source: "doctor_check",
        targetType: "gateway",
        fields: ["checkId", "verdict", "pathLabel"],
        sensitivity: "restricted",
        cost: "medium",
        required: true,
      },
      { tenantId: "tenant-fixture-a" } satisfies TrustedTenantContext,
    );
    expect(collected.evidences.map((evidence) => evidence.summary.checkId)).toEqual(
      rows.map((row) => row.checkId),
    );
    expect(collected.evidences.map((evidence) => evidence.summary.verdict)).toEqual(
      rows.map((row) => row.verdict),
    );
    expect(rows.some((row) => row.checkId === "sandbox-shared-override")).toBe(true);
  });
});
