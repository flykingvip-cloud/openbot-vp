import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const ModelsManagementSnapshotParamsSchema = Type.Object(
  {
    enterpriseId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const ModelsManagementRoutingExplanationsParamsSchema = Type.Object(
  {
    enterpriseId: Type.Optional(NonEmptyString),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  },
  { additionalProperties: false },
);

export const ModelsManagementAorStatusParamsSchema = Type.Object(
  {
    enterpriseId: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);
