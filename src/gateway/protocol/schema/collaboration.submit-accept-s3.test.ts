/**
 * FINAL v3 S3: gateway RPC schema must accept version-bound submit/accept/return
 * params (artifactVersion, expectedSubmissionId, reason, checkedAcceptanceCriteria).
 * Tip gray retest blocked on unexpected property `artifactVersion` before this align.
 *
 * LIVE_touched = false; no flag flips.
 */
import AjvPkg from "ajv";
import { describe, expect, it } from "vitest";
import {
  CollaborationTaskAcceptSubmissionParamsSchema,
  CollaborationTaskReturnSubmissionParamsSchema,
  CollaborationTaskSubmitForReviewParamsSchema,
} from "./collaboration.js";

const ajv = new (AjvPkg as unknown as new (opts?: object) => import("ajv").default)({
  allErrors: true,
  strict: false,
});

const validateSubmit = ajv.compile(CollaborationTaskSubmitForReviewParamsSchema);
const validateAccept = ajv.compile(CollaborationTaskAcceptSubmissionParamsSchema);
const validateReturn = ajv.compile(CollaborationTaskReturnSubmissionParamsSchema);

const baseIds = {
  groupId: "grp-daniel-hhd-gmail-com-upbeyond",
  taskId: "task-zhandui-2030-ai-strategy-1791822358535",
  itemId: "af907e35-a1d6-4003-8add-58cc4435a87e",
};

describe("CollaborationTaskSubmitForReviewParamsSchema S3", () => {
  it("accepts submissionId + artifactVersion (+ optional summary)", () => {
    expect(
      validateSubmit({
        ...baseIds,
        submissionId: "942755ff-d18e-40aa-8252-8c399069d675",
        artifactVersion: "v20261015-retest",
        submissionSummary: "正式交卷 RETEST-20K",
      }),
    ).toBe(true);
  });

  it("rejects missing artifactVersion", () => {
    expect(
      validateSubmit({
        ...baseIds,
        submissionId: "942755ff-d18e-40aa-8252-8c399069d675",
      }),
    ).toBe(false);
  });

  it("rejects unknown property (additionalProperties false)", () => {
    expect(
      validateSubmit({
        ...baseIds,
        submissionId: "942755ff-d18e-40aa-8252-8c399069d675",
        artifactVersion: "v1",
        unexpected: true,
      }),
    ).toBe(false);
  });
});

describe("CollaborationTaskAcceptSubmissionParamsSchema S3", () => {
  it("accepts expectedSubmissionId + reason + checkedAcceptanceCriteria (+ proxy)", () => {
    expect(
      validateAccept({
        ...baseIds,
        expectedSubmissionId: "942755ff-d18e-40aa-8252-8c399069d675",
        reason: "Acceptance 全覆盖；CJK≥20000；PDF 落盘可验",
        checkedAcceptanceCriteria: ["sources", "format", "cjk>=20000"],
        proxyForActorId: "group-owner",
        proxyBasis: "群主代理验收",
      }),
    ).toBe(true);
  });

  it("rejects bare ids without S3 fields (pre-align tip shape)", () => {
    expect(validateAccept({ ...baseIds })).toBe(false);
  });

  it("rejects missing reason", () => {
    expect(
      validateAccept({
        ...baseIds,
        expectedSubmissionId: "942755ff-d18e-40aa-8252-8c399069d675",
        checkedAcceptanceCriteria: ["sources"],
      }),
    ).toBe(false);
  });

  it("rejects missing expectedSubmissionId", () => {
    expect(
      validateAccept({
        ...baseIds,
        reason: "ok",
        checkedAcceptanceCriteria: ["sources"],
      }),
    ).toBe(false);
  });
});

describe("CollaborationTaskReturnSubmissionParamsSchema S3", () => {
  it("accepts reason + expectedSubmissionId", () => {
    expect(
      validateReturn({
        ...baseIds,
        reason: "need sources",
        expectedSubmissionId: "942755ff-d18e-40aa-8252-8c399069d675",
      }),
    ).toBe(true);
  });

  it("rejects return without expectedSubmissionId", () => {
    expect(
      validateReturn({
        ...baseIds,
        reason: "need sources",
      }),
    ).toBe(false);
  });
});
