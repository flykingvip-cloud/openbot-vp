import { expect, test } from "vitest";
import { reviewSubmissionAdmission } from "./review-admission.js";
const item = {
  status: "submitted_for_review",
  claimantId: "bot:a",
  submissionId: "s",
  artifactVersion: "v1",
  pendingEventRelay: {
    businessEvent: "submitted_for_review",
    sourceId: "s",
    artifactVersion: "v1",
    targetAgentIds: ["bot:b"],
    opKey: "op",
    recordedAt: 1,
    status: "pending",
  },
} satisfies Parameters<typeof reviewSubmissionAdmission>[0];
test("formal review binds current submission/version and independent targets", () => {
  expect(reviewSubmissionAdmission(item)).toMatchObject({
    allowed: true,
    purpose: "formal_review",
    submissionId: "s",
    artifactVersion: "v1",
  });
  expect(reviewSubmissionAdmission({ ...item, artifactVersion: "v2" })).toMatchObject({
    allowed: false,
  });
  expect(reviewSubmissionAdmission({ ...item, status: "accepted" })).toMatchObject({
    allowed: false,
  });
  expect(
    reviewSubmissionAdmission({
      ...item,
      pendingEventRelay: { ...item.pendingEventRelay, targetAgentIds: ["bot:a"] },
    }),
  ).toMatchObject({ allowed: false, reason: "independent_reviewer_required" });
});
