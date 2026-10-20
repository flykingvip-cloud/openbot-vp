import { describe, expect, it } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  fetchAutofillResult,
  isEmptyAutofill,
  normalizeAutofillJob,
  normalizeAutofillSuggestion,
  normalizeEnhancementSource,
  startAutofill,
  type AutofillJobState,
  type SkillAutofillState,
} from "./skill-autofill.ts";

type RequestHandler = (method: string, params?: unknown) => unknown;

function toGatewayRequest(handler: RequestHandler): GatewayBrowserClient["request"] {
  return ((method, params) =>
    Promise.resolve(handler(method, params))) as GatewayBrowserClient["request"];
}

function createState(request: RequestHandler): SkillAutofillState {
  return {
    client: { request: toGatewayRequest(request) } as GatewayBrowserClient,
    connected: true,
    jobsBySkillId: {},
  };
}

describe("skill-autofill controller", () => {
  describe("startAutofill", () => {
    it("stores pending job in jobsBySkillId", async () => {
      const state = createState(async () => ({ jobId: "job-123" }));

      const jobId = await startAutofill(state, "skill-abc");

      expect(jobId).toBe("job-123");
      expect(state.jobsBySkillId["skill-abc"]).toMatchObject({
        jobId: "job-123",
        skillId: "skill-abc",
        status: "pending",
        suggestion: null,
      });
    });

    it("returns null when client is not connected", async () => {
      const state = createState(async () => ({ jobId: "job-123" }));
      state.connected = false;

      const jobId = await startAutofill(state, "skill-abc");

      expect(jobId).toBeNull();
      expect(state.jobsBySkillId["skill-abc"]).toBeUndefined();
    });

    it("returns null when API returns no jobId", async () => {
      const state = createState(async () => ({}));

      const jobId = await startAutofill(state, "skill-abc");

      expect(jobId).toBeNull();
    });

    it("returns null on request error without crashing", async () => {
      const state = createState(async () => {
        throw new Error("network error");
      });

      const jobId = await startAutofill(state, "skill-abc");

      expect(jobId).toBeNull();
    });
  });

  describe("fetchAutofillResult", () => {
    it("updates job with suggestion on success", async () => {
      const state = createState(async () => ({
        jobId: "job-123",
        skillId: "skill-abc",
        status: "succeeded",
        suggestion: {
          category: "办公效率",
          tags: ["周报", "自动化"],
          inputDescription: "项目进展数据",
          outputDescription: "格式化周报",
          usageExamples: ["每周五自动生成周报"],
          avatar: "📊",
          summaryRefinement: "自动整理项目进展并生成结构化周报",
        },
        updatedAt: 1700000000000,
      }));

      const job = await fetchAutofillResult(state, "skill-abc");

      expect(job).not.toBeNull();
      expect(job!.status).toBe("succeeded");
      expect(job!.suggestion).toMatchObject({
        category: "办公效率",
        tags: ["周报", "自动化"],
        inputDescription: "项目进展数据",
        outputDescription: "格式化周报",
        usageExamples: ["每周五自动生成周报"],
        avatar: "📊",
        summaryRefinement: "自动整理项目进展并生成结构化周报",
      });
      expect(state.jobsBySkillId["skill-abc"]).toBe(job);
    });

    it("handles empty status (no suggestions available)", async () => {
      const state = createState(async () => ({
        jobId: "job-456",
        skillId: "skill-abc",
        status: "empty",
        suggestion: null,
        updatedAt: 1700000000000,
      }));

      const job = await fetchAutofillResult(state, "skill-abc");

      expect(job).not.toBeNull();
      expect(job!.status).toBe("empty");
      expect(job!.suggestion).toBeNull();
      expect(isEmptyAutofill(job!)).toBe(true);
    });

    it("handles failed status", async () => {
      const state = createState(async () => ({
        jobId: "job-789",
        skillId: "skill-abc",
        status: "failed",
        suggestion: null,
        updatedAt: 1700000000000,
      }));

      const job = await fetchAutofillResult(state, "skill-abc");

      expect(job).not.toBeNull();
      expect(job!.status).toBe("failed");
      expect(job!.suggestion).toBeNull();
    });

    it("marks existing job as failed on request error", async () => {
      const state = createState(async () => {
        throw new Error("timeout");
      });
      state.jobsBySkillId["skill-abc"] = {
        jobId: "job-existing",
        skillId: "skill-abc",
        status: "running",
        suggestion: null,
        enhancementSources: [],
        updatedAt: 1700000000000,
      };

      const result = await fetchAutofillResult(state, "skill-abc");

      expect(result).toBeNull();
      expect(state.jobsBySkillId["skill-abc"].status).toBe("failed");
    });
  });

  describe("isEmptyAutofill", () => {
    it("returns true when status is empty", () => {
      const job: AutofillJobState = {
        jobId: "job-1",
        skillId: "skill-1",
        status: "empty",
        suggestion: null,
        enhancementSources: [],
        updatedAt: Date.now(),
      };
      expect(isEmptyAutofill(job)).toBe(true);
    });

    it("returns false for other statuses", () => {
      const statuses = ["pending", "running", "succeeded", "failed"] as const;
      for (const status of statuses) {
        const job: AutofillJobState = {
          jobId: "job-1",
          skillId: "skill-1",
          status,
          suggestion: null,
          enhancementSources: [],
          updatedAt: Date.now(),
        };
        expect(isEmptyAutofill(job)).toBe(false);
      }
    });
  });

  describe("normalizeAutofillSuggestion", () => {
    it("handles partial fields gracefully", () => {
      const result = normalizeAutofillSuggestion({
        category: "客户运营",
        tags: ["客服"],
      });

      expect(result).toMatchObject({
        category: "客户运营",
        tags: ["客服"],
      });
      expect(result!.inputDescription).toBeUndefined();
      expect(result!.outputDescription).toBeUndefined();
      expect(result!.usageExamples).toBeUndefined();
      expect(result!.avatar).toBeUndefined();
      expect(result!.summaryRefinement).toBeUndefined();
    });

    it("returns null for null/undefined input", () => {
      expect(normalizeAutofillSuggestion(null)).toBeNull();
      expect(normalizeAutofillSuggestion(undefined)).toBeNull();
    });

    it("returns null for empty object (no valid fields)", () => {
      expect(normalizeAutofillSuggestion({})).toBeNull();
    });

    it("returns null when all string fields are empty/whitespace", () => {
      expect(
        normalizeAutofillSuggestion({
          category: "  ",
          tags: [],
          inputDescription: "",
          outputDescription: "",
          usageExamples: [],
          avatar: "",
          summaryRefinement: "   ",
        }),
      ).toBeNull();
    });

    it("trims string values and filters empty array entries", () => {
      const result = normalizeAutofillSuggestion({
        category: "  办公效率  ",
        tags: ["周报", "", "  ", "自动化"],
        usageExamples: ["", "每周五生成周报"],
      });

      expect(result).toMatchObject({
        category: "办公效率",
        tags: ["周报", "自动化"],
        usageExamples: ["每周五生成周报"],
      });
    });

    it("handles non-object input gracefully", () => {
      expect(normalizeAutofillSuggestion("string")).toBeNull();
      expect(normalizeAutofillSuggestion(42)).toBeNull();
      expect(normalizeAutofillSuggestion([])).toBeNull();
    });
  });

  describe("normalizeAutofillJob", () => {
    it("normalizes a complete API response", () => {
      const job = normalizeAutofillJob({
        jobId: "job-1",
        skillId: "skill-1",
        status: "succeeded",
        suggestion: { category: "效率工具" },
        updatedAt: 1700000000000,
      });

      expect(job.jobId).toBe("job-1");
      expect(job.skillId).toBe("skill-1");
      expect(job.status).toBe("succeeded");
      expect(job.suggestion).toMatchObject({ category: "效率工具" });
      expect(job.updatedAt).toBe(1700000000000);
    });

    it("defaults unknown status to pending", () => {
      const job = normalizeAutofillJob({ status: "unknown" });
      expect(job.status).toBe("pending");
    });

    it("only includes suggestion when status is succeeded", () => {
      const job = normalizeAutofillJob({
        status: "running",
        suggestion: { category: "should be ignored" },
      });
      expect(job.suggestion).toBeNull();
    });

    it("handles completely empty input", () => {
      const job = normalizeAutofillJob(null);
      expect(job.jobId).toBe("");
      expect(job.skillId).toBe("");
      expect(job.status).toBe("pending");
      expect(job.suggestion).toBeNull();
    });

    it("extracts enhancementSources when present", () => {
      const job = normalizeAutofillJob({
        jobId: "job-1",
        skillId: "skill-1",
        status: "succeeded",
        suggestion: { category: "效率工具" },
        enhancementSources: [
          {
            similarSkillId: "skill-similar-1",
            similarSkillName: "周报生成",
            sharedTags: ["周报", "自动化"],
            sharedCategory: "办公效率",
          },
          {
            similarSkillId: "skill-similar-2",
            similarSkillName: "日报整理",
            sharedTags: ["日报"],
            sharedCategory: null,
          },
        ],
        updatedAt: 1700000000000,
      });

      expect(job.enhancementSources).toHaveLength(2);
      expect(job.enhancementSources[0]).toMatchObject({
        similarSkillId: "skill-similar-1",
        similarSkillName: "周报生成",
        sharedTags: ["周报", "自动化"],
        sharedCategory: "办公效率",
      });
      expect(job.enhancementSources[1]).toMatchObject({
        similarSkillId: "skill-similar-2",
        similarSkillName: "日报整理",
        sharedTags: ["日报"],
        sharedCategory: null,
      });
    });

    it("defaults to empty array when enhancementSources missing", () => {
      const job = normalizeAutofillJob({
        jobId: "job-1",
        skillId: "skill-1",
        status: "succeeded",
        suggestion: { category: "效率工具" },
        updatedAt: 1700000000000,
      });

      expect(job.enhancementSources).toEqual([]);
    });

    it("defaults to empty array when enhancementSources is not an array", () => {
      const job = normalizeAutofillJob({
        jobId: "job-1",
        skillId: "skill-1",
        status: "succeeded",
        suggestion: { category: "效率工具" },
        enhancementSources: "invalid",
        updatedAt: 1700000000000,
      });

      expect(job.enhancementSources).toEqual([]);
    });
  });

  describe("normalizeEnhancementSource", () => {
    it("normalizes a valid enhancement source", () => {
      const result = normalizeEnhancementSource({
        similarSkillId: "skill-1",
        similarSkillName: "周报生成",
        sharedTags: ["周报", "自动化"],
        sharedCategory: "办公效率",
      });

      expect(result).toMatchObject({
        similarSkillId: "skill-1",
        similarSkillName: "周报生成",
        sharedTags: ["周报", "自动化"],
        sharedCategory: "办公效率",
      });
    });

    it("returns null when similarSkillId is missing", () => {
      const result = normalizeEnhancementSource({
        similarSkillName: "周报生成",
        sharedTags: ["周报"],
        sharedCategory: "办公效率",
      });

      expect(result).toBeNull();
    });

    it("returns null when similarSkillName is missing", () => {
      const result = normalizeEnhancementSource({
        similarSkillId: "skill-1",
        sharedTags: ["周报"],
        sharedCategory: "办公效率",
      });

      expect(result).toBeNull();
    });

    it("returns null for null/undefined/non-object input", () => {
      expect(normalizeEnhancementSource(null)).toBeNull();
      expect(normalizeEnhancementSource(undefined)).toBeNull();
      expect(normalizeEnhancementSource("string")).toBeNull();
      expect(normalizeEnhancementSource(42)).toBeNull();
    });

    it("handles missing sharedTags gracefully", () => {
      const result = normalizeEnhancementSource({
        similarSkillId: "skill-1",
        similarSkillName: "周报生成",
        sharedCategory: "办公效率",
      });

      expect(result).toMatchObject({
        similarSkillId: "skill-1",
        similarSkillName: "周报生成",
        sharedTags: [],
        sharedCategory: "办公效率",
      });
    });

    it("handles empty/whitespace sharedCategory as null", () => {
      const result = normalizeEnhancementSource({
        similarSkillId: "skill-1",
        similarSkillName: "周报生成",
        sharedTags: [],
        sharedCategory: "   ",
      });

      expect(result).toMatchObject({
        similarSkillId: "skill-1",
        similarSkillName: "周报生成",
        sharedTags: [],
        sharedCategory: null,
      });
    });

    it("trims string values", () => {
      const result = normalizeEnhancementSource({
        similarSkillId: "  skill-1  ",
        similarSkillName: "  周报生成  ",
        sharedTags: ["  周报  ", "", "自动化"],
        sharedCategory: "  办公效率  ",
      });

      expect(result).toMatchObject({
        similarSkillId: "skill-1",
        similarSkillName: "周报生成",
        sharedTags: ["周报", "自动化"],
        sharedCategory: "办公效率",
      });
    });
  });
});
