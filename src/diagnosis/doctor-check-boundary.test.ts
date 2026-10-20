import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOCTOR_CHECK_ENTRY, DOCTOR_REPAIR_ENTRY } from "./doctor-check-contract.js";
import { assertDoctorCheckNotRepair, createDoctorCheckContractAdapter } from "./phase2.js";
import type { TrustedTenantContext } from "./types.js";

const TRUSTED: TrustedTenantContext = { tenantId: "tenant-fixture-a" };
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

const FORBIDDEN_IMPORT_FROM = [
  /from ["'][^"']*\/doctor\.js["']/,
  /from ["'][^"']*\/doctor-prompter\.js["']/,
  /from ["'][^"']*\/doctor-gateway-daemon-flow\.js["']/,
  /from ["'][^"']*\/security\/fix\.js["']/,
];

const FORBIDDEN_CALLS = [
  "doctorCommand(",
  "maybeRepair",
  "writeConfigFile(",
  "runLegacyStateMigrations(",
  "fixSecurityFootguns(",
  "createDoctorPrompter(",
  "repairLaunchAgentBootstrap(",
];

function readRepo(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("Phase 2 increment 4.3 — Doctor check/repair boundary", () => {
  it("maps contract check rows into doctor_check Evidence", async () => {
    const adapter = createDoctorCheckContractAdapter({
      config: { gateway: { mode: "local" } },
      env: {},
    });
    const result = await adapter.collect(
      {
        schemaVersion: 1,
        evidenceType: "config_check",
        source: "doctor_check",
        targetType: "gateway",
        fields: ["checkId", "verdict"],
        sensitivity: "restricted",
        cost: "medium",
        required: true,
      },
      TRUSTED,
    );
    expect(result.missing).toEqual([]);
    expect(result.evidences.length).toBeGreaterThan(0);
    expect(result.evidences.every((evidence) => evidence.source === "doctor_check")).toBe(true);
    expect(result.evidences.every((evidence) => evidence.evidenceType === "config_check")).toBe(
      true,
    );
    expect(result.evidences.some((evidence) => evidence.summary.checkId === "gateway-mode")).toBe(
      true,
    );
  });

  it("rejects repair/fix/yes on the Diagnosis path", () => {
    expect(() => assertDoctorCheckNotRepair({ repair: true })).toThrow(/refuses repair/);
    expect(() => assertDoctorCheckNotRepair({ fix: true })).toThrow(/refuses repair/);
    expect(() => assertDoctorCheckNotRepair({ yes: true })).toThrow(/refuses repair/);
    expect(() => createDoctorCheckContractAdapter({ config: {}, env: {} }, { fix: true })).toThrow(
      /refuses repair/,
    );
  });

  it("keeps Diagnosis and Doctor repair on separate mutable entry points", () => {
    expect(DOCTOR_CHECK_ENTRY).toBe("runDoctorChecks");
    expect(DOCTOR_REPAIR_ENTRY).toBe("cli-doctor-entry");
    expect(DOCTOR_CHECK_ENTRY).not.toBe(DOCTOR_REPAIR_ENTRY);

    const diagnosisPhase2 = readRepo("src/diagnosis/phase2.ts");
    const contract = readRepo("src/diagnosis/doctor-check-contract.ts");
    const cli = readRepo("src/commands/doctor.ts");
    const register = readRepo("src/cli/program/register.maintenance.ts");

    for (const pattern of FORBIDDEN_IMPORT_FROM) {
      expect(diagnosisPhase2).not.toMatch(pattern);
      expect(contract).not.toMatch(pattern);
    }
    for (const token of FORBIDDEN_CALLS) {
      expect(diagnosisPhase2).not.toContain(token);
      expect(contract).not.toContain(token);
    }
    expect(cli).toContain("export async function doctorCommand");
    expect(cli).toContain("writeConfigFile");
    expect(cli).toContain("maybeRepair");
    expect(register).toContain('option("--fix"');
    expect(register).toContain('option("--repair"');
    expect(register).toContain('option("--yes"');
    expect(register).toContain("repair: Boolean(opts.repair) || Boolean(opts.fix)");
    expect(register).not.toContain("runDoctorChecks");
    expect(cli).toContain("runDoctorChecks");
    expect(cli.indexOf("runDoctorChecks")).toBeLessThan(cli.indexOf("maybeRepairSandboxImages"));
    expect(cli.indexOf("runDoctorChecks")).toBeLessThan(cli.indexOf("maybeRepairGatewayDaemon"));
    expect(readRepo("src/commands/doctor-sandbox.ts")).toContain("runDoctorChecks");
    expect(readRepo("src/commands/doctor-sandbox.ts")).not.toContain("resolveSandboxScope");
  });
});
