import { expect, it } from "vitest";
import {
  extractAsyncWaitRecoveryAppendix,
  mergeContinuePromptWithRecoveryAppendix,
} from "./claim-queued-execution.js";

it("extractAsyncWaitRecoveryAppendix keeps WARNING and evidence lines", () => {
  const prompt = [
    "Continue the unfinished task.",
    "",
    "Async-wait job recovery context (Package2):",
    "jobId=job-1",
    "evidenceKind=process_missing_unconfirmed",
    "WARNING: pid was gone after restart; this is NOT proof the original job completed successfully.",
  ].join("\n");
  const appendix = extractAsyncWaitRecoveryAppendix(prompt);
  expect(appendix).toContain("Async-wait job recovery context (Package2):");
  expect(appendix).toContain("WARNING:");
  expect(appendix).toContain("process_missing_unconfirmed");
});

it("mergeContinuePromptWithRecoveryAppendix preserves appendix when wake.prompt replaces base", () => {
  const input = [
    "stale board line",
    "",
    "Async-wait job recovery context (Package2):",
    "jobId=job-x",
    "WARNING: pid was gone after restart; this is NOT proof the original job completed successfully.",
  ].join("\n");
  const wake = "Continue task task-a (revision 2).";
  const merged = mergeContinuePromptWithRecoveryAppendix(wake, input);
  expect(merged.startsWith("Continue task task-a")).toBe(true);
  expect(merged).toContain("Async-wait job recovery context (Package2):");
  expect(merged).toContain("WARNING:");
  expect(merged).toContain("jobId=job-x");
});
