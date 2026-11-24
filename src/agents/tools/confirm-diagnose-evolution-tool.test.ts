import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED } from "../../diagnosis/diagnose-professional-protocol.js";
import { createOpenClawTools } from "../openclaw-tools.js";
import {
  createConfirmDiagnoseEvolutionTool,
  createConfirmDiagnosePrescriptionTool,
  executeConfirmDiagnosePrescription,
} from "./confirm-diagnose-evolution-tool.js";

const source = readFileSync(
  fileURLToPath(new URL("./confirm-diagnose-evolution-tool.ts", import.meta.url)),
  "utf8",
);
const tickSource = readFileSync(
  fileURLToPath(new URL("../../diagnosis/diagnose-tick.ts", import.meta.url)),
  "utf8",
);

describe("confirm diagnose prescription tool", () => {
  it("keeps Path B CONFIRM closed by default and shares one handler for the alias", () => {
    expect(DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED).toBe(false);
    expect(source).not.toContain("user.daibai.ask");
    expect(source).not.toContain("user.daibai.execute");
    expect(source).not.toContain("chat.send");
    expect(source).not.toContain("cron.add");
    expect(tickSource).toContain("allowSelfEvolutionConfirm: false");
    const canonical = createConfirmDiagnosePrescriptionTool();
    const alias = createConfirmDiagnoseEvolutionTool();
    expect(canonical.name).toBe("confirm_diagnose_prescription");
    expect(alias.name).toBe("confirm_diagnose_evolution");
    expect(canonical.execute).not.toBe(alias.execute);
    expect(source).toContain("executeConfirmDiagnosePrescription");
    expect(source).toContain('from "../../diagnosis/diagnose-self-evolution.js"');
    expect(source).not.toMatch(/params\.grant|record\.grant/);
    const visible = createOpenClawTools().filter((tool) =>
      tool.name.startsWith("confirm_diagnose"),
    );
    expect(visible.map((tool) => tool.name)).toEqual(["confirm_diagnose_prescription"]);
  });

  it("refuses canonical and alias tools before prescription lookup by default", async () => {
    const tool = createConfirmDiagnosePrescriptionTool({ tenantId: "001" });
    const result = await tool.execute("c1", {
      prescriptionId: "abc",
      professionalReportId: "pdr-1",
    });
    const details = result.details as { ok?: boolean; reason?: string };
    expect(details.ok).toBe(false);
    expect(details.reason).toBe("confirm_not_enabled");
    const alias = await executeConfirmDiagnosePrescription(
      { prescriptionId: "abc", professionalReportId: "pdr-1" },
      { tenantId: "001" },
    );
    expect((alias.details as { reason?: string }).reason).toBe("confirm_not_enabled");
  });
});
