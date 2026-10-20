import { describe, expect, it } from "vitest";
import { compileEmployeeDesignAsync } from "./compile.js";
import { extractDesignIntent } from "./extract-intent.js";
import { mergeWithRuleIntent, parseLlmDesignExtraction } from "./llm-compiler.js";

// ─── parseLlmDesignExtraction ────────────────────────────────────────────────

describe("parseLlmDesignExtraction", () => {
  it("parses a well-formed JSON fence", () => {
    const raw = `\`\`\`json
{
  "roleName": "销售助理",
  "roleFamily": "sales_customer",
  "desiredOutcomes": ["每周发送销售周报", "跟进CRM线索"],
  "responsibilities": ["整理销售数据", "安排客户拜访"],
  "constraints": [],
  "policyRequirements": ["可读取CRM"],
  "schedule": "每周一早9点",
  "delivery": "销售周报",
  "skills": ["crm", "email"]
}
\`\`\``;
    const result = parseLlmDesignExtraction(raw);
    expect(result).not.toBeNull();
    expect(result?.roleName).toBe("销售助理");
    expect(result?.roleFamily).toBe("sales_customer");
    expect(result?.desiredOutcomes).toContain("每周发送销售周报");
    expect(result?.schedule).toBe("每周一早9点");
    expect(result?.skills).toEqual(["crm", "email"]);
  });

  it("parses bare JSON without fences", () => {
    const raw = `{"roleName":"客服机器人","roleFamily":"customer_service","desiredOutcomes":["处理退款申请"],"responsibilities":[],"constraints":[],"policyRequirements":[]}`;
    const result = parseLlmDesignExtraction(raw);
    expect(result?.roleName).toBe("客服机器人");
    expect(result?.roleFamily).toBe("customer_service");
  });

  it("returns null for invalid JSON", () => {
    expect(parseLlmDesignExtraction("这不是JSON")).toBeNull();
    expect(parseLlmDesignExtraction("")).toBeNull();
  });

  it("silently ignores non-string array items", () => {
    const raw = `{"roleName":"助手","desiredOutcomes":[1,null,"有效目标"],"responsibilities":[],"constraints":[],"policyRequirements":[]}`;
    const result = parseLlmDesignExtraction(raw);
    expect(result?.desiredOutcomes).toEqual(["有效目标"]);
  });
});

// ─── mergeWithRuleIntent ─────────────────────────────────────────────────────

describe("mergeWithRuleIntent", () => {
  it("merges LLM outcomes into rule-based intent without duplicates", () => {
    const base = extractDesignIntent("销售助理每周给我销售周报");
    const merged = mergeWithRuleIntent(base, {
      roleName: "销售助理",
      roleFamily: "sales_customer",
      desiredOutcomes: ["每周发销售周报", "跟进CRM线索"],
      responsibilities: ["整理数据"],
      constraints: [],
      policyRequirements: ["可读取CRM"],
    });
    expect(merged.desiredOutcomes).toContain("每周发销售周报");
    expect(merged.desiredOutcomes).toContain("跟进CRM线索");
    expect(merged.responsibilities).toContain("整理数据");
    expect(merged.policyRequirements).toContain("可读取CRM");
  });

  it("encodes skills as skill:-prefixed desiredOutcomes entries", () => {
    const base = extractDesignIntent("发邮件给客户");
    const merged = mergeWithRuleIntent(base, { skills: ["email", "crm"] });
    expect(merged.desiredOutcomes).toContain("skill:email");
    expect(merged.desiredOutcomes).toContain("skill:crm");
  });

  it("preserves base schedule when LLM provides none", () => {
    const base = extractDesignIntent("每周一发周报");
    const merged = mergeWithRuleIntent(base, { desiredOutcomes: ["发周报"] });
    expect(merged.schedule).toBe(base.schedule);
  });

  it("LLM schedule overrides rule schedule when both present", () => {
    const base = extractDesignIntent("每周一发周报");
    const merged = mergeWithRuleIntent(base, { schedule: "每月1号" });
    expect(merged.schedule).toBe("每月1号");
  });
});

// ─── compileEmployeeDesignAsync — offline (no LLM) ───────────────────────────

describe("compileEmployeeDesignAsync", () => {
  it("uses rule engine when no llm option provided, usedLlm=false", async () => {
    const result = await compileEmployeeDesignAsync({
      rawRequest: "帮我创建一个体验官，负责跟进客户满意度",
      draftId: "test-draft-1",
    });
    expect(result.usedLlm).toBe(false);
    expect(result.intent.rawRequest).toBe("帮我创建一个体验官，负责跟进客户满意度");
    expect(result.draft).toBeDefined();
  });

  it("produces a draft for a generic request", async () => {
    const result = await compileEmployeeDesignAsync({
      rawRequest: "销售助理，每周一发销售周报，跟进CRM线索",
      draftId: "test-draft-3",
    });
    const status = result.draft.validation.status;
    expect(["valid", "valid_with_gaps", "invalid"]).toContain(status);
    expect(result.intent.rawRequest).toBe("销售助理，每周一发销售周报，跟进CRM线索");
  });

  it("merges extras into intent", async () => {
    const result = await compileEmployeeDesignAsync({
      rawRequest: "客服助手",
      draftId: "test-draft-4",
      extras: { desiredOutcomes: ["处理退款"], responsibilities: ["接听客户咨询"] },
    });
    expect(result.intent.desiredOutcomes).toContain("处理退款");
    expect(result.intent.responsibilities).toContain("接听客户咨询");
  });
});
