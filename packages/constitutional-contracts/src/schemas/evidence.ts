import { z } from "zod";
import { ClaimLevelSchema } from "./common.js";

/**
 * Draft evidence projection.
 * Receipt and proof stay separate grades (receipt ≠ proof).
 * In-request traces and model text cannot become verified proof.
 */
export const EVIDENCE_GRADES = [
  "proof",
  "receipt",
  "in_request_trace",
  "audit_chain",
  "model_text",
] as const;

export const PROOF_GRADES = ["none", "linked-only", "verified"] as const;

export const ConstitutionalEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    evidenceId: z.string().min(1),
    grade: z.enum(EVIDENCE_GRADES),
    receiptOnly: z.boolean(),
    proofGrade: z.enum(PROOF_GRADES),
    sourceLedger: z.string().min(1),
    sourceEventType: z.string().min(1),
    subjectRef: z.string().min(1),
    tenantScope: z.string().min(1).nullable(),
    claimLevel: ClaimLevelSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.receiptOnly && (value.grade === "proof" || value.proofGrade !== "none")) {
      ctx.addIssue({
        code: "custom",
        path: ["grade"],
        message: "receipt is not proof",
      });
    }
    if (value.grade === "receipt" && (!value.receiptOnly || value.proofGrade !== "none")) {
      ctx.addIssue({
        code: "custom",
        path: ["grade"],
        message: "receipt grade cannot carry a proof grade",
      });
    }
    if (value.grade === "proof" && (value.receiptOnly || value.proofGrade === "none")) {
      ctx.addIssue({
        code: "custom",
        path: ["proofGrade"],
        message: "proof requires a non-receipt verification grade",
      });
    }
    if (value.grade === "model_text" && (value.proofGrade !== "none" || value.receiptOnly)) {
      ctx.addIssue({
        code: "custom",
        path: ["grade"],
        message: "model text is not proof and is not a receipt",
      });
    }
    if (value.grade === "in_request_trace" && value.proofGrade === "verified") {
      ctx.addIssue({
        code: "custom",
        path: ["proofGrade"],
        message: "in-request trace is not verified proof",
      });
    }
  });

export type ConstitutionalEvidence = z.infer<typeof ConstitutionalEvidenceSchema>;
