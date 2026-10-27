import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

const CapabilityId = NonEmptyString;
const AutoRouting = Type.Union([
  Type.Literal("disabled"),
  Type.Literal("eligible"),
  Type.Literal("restricted"),
  Type.Literal("paused"),
]);
const VerificationMode = Type.Union([
  Type.Literal("protocol_probe"),
  Type.Literal("specialized_eval"),
]);

export const ModelsAdmissionDiscoverParamsSchema = Type.Object(
  {
    modelRef: NonEmptyString,
    declaredCapabilities: Type.Optional(Type.Array(CapabilityId)),
    callType: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const ModelsAdmissionCreateVerificationParamsSchema = Type.Object(
  {
    modelRef: NonEmptyString,
    capabilityIds: Type.Array(CapabilityId, { minItems: 1 }),
    mode: Type.Optional(VerificationMode),
    configFingerprint: Type.Optional(NonEmptyString),
    estimatedCalls: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
    connectionOk: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const ModelsAdmissionGetVerificationParamsSchema = Type.Object(
  {
    taskId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const ModelsAdmissionListVerificationParamsSchema = Type.Object(
  {
    modelRef: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const ModelsAdmissionCancelVerificationParamsSchema = Type.Object(
  {
    taskId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const ModelsAdmissionBatchVerificationParamsSchema = Type.Object(
  {
    items: Type.Array(ModelsAdmissionCreateVerificationParamsSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export const ModelsAdmissionSetRoutingEligibilityParamsSchema = Type.Object(
  {
    modelRef: NonEmptyString,
    autoRouting: AutoRouting,
    reason: Type.Optional(NonEmptyString),
    taskCategories: Type.Optional(Type.Array(NonEmptyString)),
    tenantSelectable: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const ModelsAdmissionGetModelParamsSchema = Type.Object(
  {
    modelRef: NonEmptyString,
  },
  { additionalProperties: false },
);

export const ModelsAdmissionListModelsParamsSchema = Type.Object(
  {},
  { additionalProperties: false },
);

export const ModelsAdmissionPreviewRoutingParamsSchema = Type.Object(
  {
    request: Type.Object(
      {
        taskText: Type.Optional(Type.String()),
        taskProfileId: Type.Optional(NonEmptyString),
        planId: Type.Optional(NonEmptyString),
        outputType: Type.Optional(
          Type.Union([
            Type.Literal("text"),
            Type.Literal("image"),
            Type.Literal("music"),
            Type.Literal("audio"),
          ]),
        ),
        budget: Type.Optional(
          Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
        ),
        requiredCapabilities: Type.Optional(Type.Array(CapabilityId)),
        minContextWindow: Type.Optional(Type.Integer({ minimum: 0 })),
      },
      { additionalProperties: false },
    ),
    candidates: Type.Array(
      Type.Object(
        {
          modelId: NonEmptyString,
          health: Type.Optional(NonEmptyString),
          costTier: Type.Optional(NonEmptyString),
          contextWindow: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
