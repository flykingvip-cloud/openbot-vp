import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const MeshOwnershipRecordSchema = Type.Object(
  {
    tenantId: NonEmptyString,
    subjectKind: Type.Union([Type.Literal("agent"), Type.Literal("group")]),
    subjectId: NonEmptyString,
    positionId: NonEmptyString,
    positionLabel: NonEmptyString,
    createdByUserId: NonEmptyString,
    createdByUserLabel: NonEmptyString,
    currentManagerUserId: NonEmptyString,
    currentManagerLabel: NonEmptyString,
    bindingStatus: Type.Union([
      Type.Literal("active"),
      Type.Literal("revoked"),
      Type.Literal("transferred"),
    ]),
    createdAt: NonEmptyString,
    updatedAt: NonEmptyString,
  },
  { additionalProperties: false },
);

export const MeshOwnershipListParamsSchema = Type.Object(
  {
    tenantId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MeshOwnershipListResultSchema = Type.Object(
  {
    records: Type.Array(MeshOwnershipRecordSchema),
  },
  { additionalProperties: false },
);
