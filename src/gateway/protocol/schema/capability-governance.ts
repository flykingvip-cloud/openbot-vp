// Protocol schemas for capabilities.governance.* methods.

import { Type, type Static } from "@sinclair/typebox";

const NonEmptyString = Type.String({ minLength: 1 });
const EmployeeVisibilityModeSchema = Type.Union(
  [Type.Literal("enterprise_review_required"), Type.Literal("direct_employee_visible")],
  {
    description:
      "Whether the capability is only visible after enterprise review/push, or directly visible to employees on matched tenants.",
  },
);

// --- Params ---

export const CapabilitiesGovernanceListProposalsParamsSchema = Type.Object(
  {
    status: Type.Optional(
      Type.String({
        description:
          "Filter by proposal status (proposed, under_review, approved, rejected, withdrawn)",
      }),
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);
export type CapabilitiesGovernanceListProposalsParams = Static<
  typeof CapabilitiesGovernanceListProposalsParamsSchema
>;

export const CapabilitiesGovernanceListRegistryParamsSchema = Type.Object(
  {
    lifecycleState: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);
export type CapabilitiesGovernanceListRegistryParams = Static<
  typeof CapabilitiesGovernanceListRegistryParamsSchema
>;

export const CapabilitiesGovernanceSubmitProposalParamsSchema = Type.Object(
  {
    proposalId: NonEmptyString,
    manifest: Type.Object({}, { additionalProperties: true }),
    findings: Type.Optional(Type.Array(Type.Object({}, { additionalProperties: true }))),
    submittedBy: Type.Optional(Type.String()),
    enterpriseId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export type CapabilitiesGovernanceSubmitProposalParams = Static<
  typeof CapabilitiesGovernanceSubmitProposalParamsSchema
>;

export const CapabilitiesGovernanceApproveProposalParamsSchema = Type.Object(
  {
    proposalId: NonEmptyString,
    reviewerId: NonEmptyString,
    note: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export type CapabilitiesGovernanceApproveProposalParams = Static<
  typeof CapabilitiesGovernanceApproveProposalParamsSchema
>;

export const CapabilitiesGovernanceRejectProposalParamsSchema = Type.Object(
  {
    proposalId: NonEmptyString,
    reviewerId: NonEmptyString,
    note: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export type CapabilitiesGovernanceRejectProposalParams = Static<
  typeof CapabilitiesGovernanceRejectProposalParamsSchema
>;

export const CapabilitiesGovernanceUpdateLifecycleParamsSchema = Type.Object(
  {
    manifestId: NonEmptyString,
    state: Type.String({ description: "Target lifecycle state" }),
  },
  { additionalProperties: false },
);
export type CapabilitiesGovernanceUpdateLifecycleParams = Static<
  typeof CapabilitiesGovernanceUpdateLifecycleParamsSchema
>;

export const CapabilitiesGovernanceUpdateDistributionParamsSchema = Type.Object(
  {
    manifestId: NonEmptyString,
    scope: Type.Optional(
      Type.Object(
        {
          tenantIds: Type.Optional(Type.Array(Type.String())),
          channelIds: Type.Optional(Type.Array(Type.String())),
          agentIds: Type.Optional(Type.Array(Type.String())),
        },
        { additionalProperties: false },
      ),
    ),
    defaultEnabled: Type.Optional(Type.Boolean()),
    employeeVisibilityMode: Type.Optional(EmployeeVisibilityModeSchema),
    updatedBy: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export type CapabilitiesGovernanceUpdateDistributionParams = Static<
  typeof CapabilitiesGovernanceUpdateDistributionParamsSchema
>;

export const CapabilitiesGovernanceUpdateManifestParamsSchema = Type.Object(
  {
    manifestId: NonEmptyString,
    patch: Type.Object(
      {
        name: Type.Optional(Type.String()),
        description: Type.Optional(Type.String()),
        descriptionZh: Type.Optional(Type.String()),
        categoryId: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type CapabilitiesGovernanceUpdateManifestParams = Static<
  typeof CapabilitiesGovernanceUpdateManifestParamsSchema
>;
