import { Type, type Static } from "@sinclair/typebox";
import AjvPkg from "ajv";
import { NonEmptyString } from "../gateway/protocol/schema/primitives.js";

const ajv = new (AjvPkg as unknown as new (opts?: object) => import("ajv").default)({
  allErrors: true,
  strict: false,
});

export const DigitalEmployeeCompileParamsSchema = Type.Object(
  {
    rawRequest: NonEmptyString,
    sessionId: Type.Optional(NonEmptyString),
    source: Type.Optional(
      Type.Unsafe<"ai" | "role_chip" | "enterprise_template">({
        type: "string",
        enum: ["ai", "role_chip", "enterprise_template"],
      }),
    ),
  },
  { additionalProperties: false },
);

export const DigitalEmployeeReviseParamsSchema = Type.Object(
  {
    sessionId: NonEmptyString,
    rawRevision: NonEmptyString,
  },
  { additionalProperties: false },
);

export const DigitalEmployeeSessionParamsSchema = Type.Object(
  {
    sessionId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const DigitalEmployeeInstantiateParamsSchema = Type.Object(
  {
    sessionId: NonEmptyString,
    agentId: NonEmptyString,
  },
  { additionalProperties: false },
);

export type DigitalEmployeeCompileParams = Static<typeof DigitalEmployeeCompileParamsSchema>;
export type DigitalEmployeeReviseParams = Static<typeof DigitalEmployeeReviseParamsSchema>;
export type DigitalEmployeeSessionParams = Static<typeof DigitalEmployeeSessionParamsSchema>;
export type DigitalEmployeeInstantiateParams = Static<
  typeof DigitalEmployeeInstantiateParamsSchema
>;

export const validateDigitalEmployeeCompileParams = ajv.compile<DigitalEmployeeCompileParams>(
  DigitalEmployeeCompileParamsSchema,
);
export const validateDigitalEmployeeReviseParams = ajv.compile<DigitalEmployeeReviseParams>(
  DigitalEmployeeReviseParamsSchema,
);
export const validateDigitalEmployeeSessionParams = ajv.compile<DigitalEmployeeSessionParams>(
  DigitalEmployeeSessionParamsSchema,
);
export const validateDigitalEmployeeInstantiateParams =
  ajv.compile<DigitalEmployeeInstantiateParams>(DigitalEmployeeInstantiateParamsSchema);
