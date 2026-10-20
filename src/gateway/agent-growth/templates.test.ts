import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATE_ID,
  GENERIC_WORKER_TEMPLATE,
  getTemplate,
  listBuiltinTemplates,
  resolveTemplateOrDefault,
} from "./templates/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("agent-growth templates", () => {
  it("ships generic_worker as default and industry templates", () => {
    expect(DEFAULT_TEMPLATE_ID).toBe("generic_worker");
    const ids = listBuiltinTemplates().map((t) => t.templateId);
    expect(ids).toContain("generic_worker");
    expect(ids).toContain("contract_reviewer");
    expect(ids).toContain("sales_assistant");
    expect(GENERIC_WORKER_TEMPLATE.missionReadyThreshold).toBe(78);
    expect(GENERIC_WORKER_TEMPLATE.requiredCapabilities).toEqual([]);
  });

  it("industry templates declare required capabilities without schema change", () => {
    const contract = getTemplate("contract_reviewer");
    expect(contract?.requiredCapabilities.some((c) => c.key === "contract_review")).toBe(true);
    const sales = getTemplate("sales_assistant");
    expect(sales?.requiredCapabilities.some((c) => c.kind === "oauth")).toBe(true);
  });

  it("resolves unknown template id to generic_worker", () => {
    expect(getTemplate("nope")).toBeUndefined();
    expect(resolveTemplateOrDefault("nope").templateId).toBe("generic_worker");
    expect(resolveTemplateOrDefault(null).templateId).toBe("generic_worker");
  });

  it("TS constants stay in sync with JSON seeds", () => {
    for (const template of listBuiltinTemplates()) {
      const seed = JSON.parse(
        readFileSync(path.join(here, "templates", `${template.templateId}.json`), "utf8"),
      );
      expect(seed).toEqual(template);
    }
  });
});
