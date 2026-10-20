import type { GatewayBrowserClient } from "../gateway.ts";

export type AutofillJobStatus = "pending" | "running" | "succeeded" | "empty" | "failed";

export type SkillAutofillSuggestion = {
  category?: string;
  tags?: string[];
  inputDescription?: string;
  outputDescription?: string;
  usageExamples?: string[];
  avatar?: string;
  summaryRefinement?: string; // refined summary suggestion, does NOT override employee's original
};

export type AutofillEnhancementSource = {
  similarSkillId: string;
  similarSkillName: string;
  sharedTags: string[];
  sharedCategory: string | null;
};

export type AutofillJobState = {
  jobId: string;
  skillId: string;
  status: AutofillJobStatus;
  suggestion: SkillAutofillSuggestion | null;
  enhancementSources: AutofillEnhancementSource[];
  updatedAt: number;
};

export type SkillAutofillState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  jobsBySkillId: Record<string, AutofillJobState>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => stringValue(entry).trim()).filter(Boolean)
    : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeAutofillStatus(value: unknown): AutofillJobStatus {
  switch (value) {
    case "pending":
    case "running":
    case "succeeded":
    case "empty":
    case "failed":
      return value;
    default:
      return "pending";
  }
}

export function normalizeAutofillSuggestion(value: unknown): SkillAutofillSuggestion | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const suggestion: SkillAutofillSuggestion = {};
  const category = optionalString(record.category);
  if (category) {
    suggestion.category = category;
  }
  const tags = stringArray(record.tags);
  if (tags.length > 0) {
    suggestion.tags = tags;
  }
  const inputDescription = optionalString(record.inputDescription);
  if (inputDescription) {
    suggestion.inputDescription = inputDescription;
  }
  const outputDescription = optionalString(record.outputDescription);
  if (outputDescription) {
    suggestion.outputDescription = outputDescription;
  }
  const usageExamples = stringArray(record.usageExamples);
  if (usageExamples.length > 0) {
    suggestion.usageExamples = usageExamples;
  }
  const avatar = optionalString(record.avatar);
  if (avatar) {
    suggestion.avatar = avatar;
  }
  const summaryRefinement = optionalString(record.summaryRefinement);
  if (summaryRefinement) {
    suggestion.summaryRefinement = summaryRefinement;
  }
  // If all fields are empty, return null
  if (Object.keys(suggestion).length === 0) {
    return null;
  }
  return suggestion;
}

export function normalizeEnhancementSource(value: unknown): AutofillEnhancementSource | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const similarSkillId = stringValue(record.similarSkillId).trim();
  const similarSkillName = stringValue(record.similarSkillName).trim();
  if (!similarSkillId || !similarSkillName) {
    return null;
  }
  return {
    similarSkillId,
    similarSkillName,
    sharedTags: stringArray(record.sharedTags),
    sharedCategory:
      typeof record.sharedCategory === "string" && record.sharedCategory.trim()
        ? record.sharedCategory.trim()
        : null,
  };
}

function normalizeEnhancementSources(value: unknown): AutofillEnhancementSource[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(normalizeEnhancementSource)
    .filter((source): source is AutofillEnhancementSource => source !== null);
}

export function normalizeAutofillJob(value: unknown): AutofillJobState {
  const record = asRecord(value) ?? {};
  const status = normalizeAutofillStatus(record.status);
  return {
    jobId: stringValue(record.jobId).trim(),
    skillId: stringValue(record.skillId).trim(),
    status,
    suggestion: status === "succeeded" ? normalizeAutofillSuggestion(record.suggestion) : null,
    enhancementSources: normalizeEnhancementSources(record.enhancementSources),
    updatedAt:
      typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : Date.now(),
  };
}

export function isEmptyAutofill(job: AutofillJobState): boolean {
  return job.status === "empty";
}

export async function startAutofill(
  state: SkillAutofillState,
  skillId: string,
): Promise<string | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  try {
    const result = await state.client.request<{ jobId?: string }>("skill-autofill.start", {
      skillId,
    });
    const jobId = stringValue(result?.jobId).trim();
    if (!jobId) {
      return null;
    }
    state.jobsBySkillId[skillId] = {
      jobId,
      skillId,
      status: "pending",
      suggestion: null,
      enhancementSources: [],
      updatedAt: Date.now(),
    };
    return jobId;
  } catch {
    return null;
  }
}

export async function fetchAutofillResult(
  state: SkillAutofillState,
  skillId: string,
): Promise<AutofillJobState | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  try {
    const result = await state.client.request("skill-autofill.result", { skillId });
    const job = normalizeAutofillJob(result);
    // Ensure skillId is set correctly even if API response omits it
    job.skillId = job.skillId || skillId;
    state.jobsBySkillId[skillId] = job;
    return job;
  } catch {
    // On fetch failure, mark the job as failed if it exists
    const existing = state.jobsBySkillId[skillId];
    if (existing) {
      existing.status = "failed";
      existing.updatedAt = Date.now();
    }
    return null;
  }
}
