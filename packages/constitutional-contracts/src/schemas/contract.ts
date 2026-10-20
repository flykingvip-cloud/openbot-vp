import { z } from "zod";

/**
 * Draft contract projection. One domain, one profile.
 * `crossDomainWriter` is fixed false: this view is not a cross-domain writer
 * and does not merge Profile A with Profile B.
 */
export const CONTRACT_DOMAINS = [
  "skill_delivery",
  "chat_turn",
  "collaboration_task",
  "evolution",
  "release",
] as const;

export const CONTRACT_PROFILES = ["personal_local", "managed_enterprise", "unspecified"] as const;

export const ConstitutionalContractSchema = z
  .object({
    schemaVersion: z.literal(1),
    contractId: z.string().min(1),
    domain: z.enum(CONTRACT_DOMAINS),
    subjectRef: z.string().min(1),
    obligation: z.string().min(1),
    /** Label of the domain-local terminal writer. The view does not write. */
    domainWriteAuthority: z.string().min(1),
    profile: z.enum(CONTRACT_PROFILES),
    sourceLedger: z.string().min(1),
    status: z.enum(["draft", "observed"]),
    crossDomainWriter: z.literal(false),
  })
  .strict();

export type ConstitutionalContract = z.infer<typeof ConstitutionalContractSchema>;
export type ContractDomain = z.infer<typeof ConstitutionalContractSchema>["domain"];
export type ContractProfile = z.infer<typeof ConstitutionalContractSchema>["profile"];
