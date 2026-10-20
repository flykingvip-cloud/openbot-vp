import { z } from "zod";
import { ClaimLevelSchema } from "./common.js";

/**
 * Draft identity projection.
 * `workflowRef` is a named process space. `selectedPath` stays null:
 * this package does not paint a Path (Workflow ≠ Path).
 * `installed` is a plugin-registry fact. `capabilityAuthorized` is a
 * separate grant-ledger fact (plugin installed ≠ capability authorized).
 */
export const IDENTITY_KINDS = [
  "principal",
  "plugin_install",
  "agent",
  "device_node",
  "session_route",
] as const;

export const ConstitutionalIdentitySchema = z
  .object({
    schemaVersion: z.literal(1),
    identityId: z.string().min(1),
    kind: z.enum(IDENTITY_KINDS),
    principalRef: z.string().min(1),
    tenantScope: z.string().min(1).nullable(),
    sourceLedger: z.string().min(1),
    workflowRef: z.string().min(1).nullable(),
    selectedPath: z.null(),
    installed: z.boolean().nullable(),
    capabilityAuthorized: z.boolean(),
    authorizationSourceLedger: z.string().min(1).nullable(),
    claimLevel: ClaimLevelSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.capabilityAuthorized) {
      if (!value.authorizationSourceLedger) {
        ctx.addIssue({
          code: "custom",
          path: ["authorizationSourceLedger"],
          message: "capability authorization requires a grant ledger distinct from install",
        });
        return;
      }
      if (
        value.kind === "plugin_install" &&
        value.authorizationSourceLedger === value.sourceLedger
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["capabilityAuthorized"],
          message: "plugin install ledger cannot authorize a capability",
        });
      }
      return;
    }
    if (value.authorizationSourceLedger) {
      ctx.addIssue({
        code: "custom",
        path: ["authorizationSourceLedger"],
        message: "authorization ledger is recorded only when capabilityAuthorized is true",
      });
    }
  });

export type ConstitutionalIdentity = z.infer<typeof ConstitutionalIdentitySchema>;
