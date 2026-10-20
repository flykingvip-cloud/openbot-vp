/**
 * OGUI v1 (chat-inline Generative UI) — TypeBox source of truth.
 *
 * Aligns with control-ui fences already on main (`schema_version: "ogui/v1"`):
 *   - assistant: ```ogui-form```  → OguiFormSchema
 *   - user submit: ```ogui-answer``` → OguiAnswerSchema
 *   - thin choice surface: OguiChoiceSchema (not forced through Canvas)
 *
 * Non-goals for this module:
 *   - new ui.* RPC / ChatSendParamsSchema widen
 *   - merging Wizard session stepper with OGUI (see ogui-wizard-adapter)
 *   - A2UI v0.9 / multi_select UX
 */
import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const OGUI_SCHEMA_VERSION = "ogui/v1" as const;

export const OguiSchemaVersionSchema = Type.Literal(OGUI_SCHEMA_VERSION);

export const OguiOptionSchema = Type.Object(
  {
    value: NonEmptyString,
    label: NonEmptyString,
  },
  { additionalProperties: false },
);

/** P1′ field whitelist: single_select only (matches Form P0). */
export const OguiSingleSelectFieldSchema = Type.Object(
  {
    id: NonEmptyString,
    label: NonEmptyString,
    type: Type.Literal("single_select"),
    options: Type.Array(OguiOptionSchema, { minItems: 1 }),
    required: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const OguiFormFieldSchema = OguiSingleSelectFieldSchema;

export const OguiFormSubmitSchema = Type.Object(
  {
    label: Type.Optional(NonEmptyString),
    /** P0/P1′: only continue_agent. High-risk actions stay Steward / Exec Approvals. */
    action: Type.Optional(Type.Literal("continue_agent")),
  },
  { additionalProperties: false },
);

export const OguiFallbackSchema = Type.Object(
  {
    type: Type.Literal("markdown"),
  },
  { additionalProperties: false },
);

/**
 * Canonical ogui-form body (assistant).
 * UI parser may accept aliases (`form_id`/`id`, `version: 1`); TypeBox is the
 * normalized shape after parse.
 */
export const OguiFormSchema = Type.Object(
  {
    schema_version: OguiSchemaVersionSchema,
    type: Type.Optional(Type.Literal("form")),
    component_id: NonEmptyString,
    title: Type.Optional(Type.String()),
    fields: Type.Array(OguiFormFieldSchema, { minItems: 1 }),
    submit_label: Type.Optional(NonEmptyString),
    submit: Type.Optional(OguiFormSubmitSchema),
    fallback: Type.Optional(OguiFallbackSchema),
  },
  { additionalProperties: false },
);

/**
 * Thin single-question choice (ogui/v1). Chat-inline; must not be forced into Canvas.
 */
export const OguiChoiceSchema = Type.Object(
  {
    schema_version: OguiSchemaVersionSchema,
    type: Type.Literal("choice"),
    component_id: NonEmptyString,
    label: NonEmptyString,
    options: Type.Array(OguiOptionSchema, { minItems: 1 }),
    required: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

/**
 * Canonical ogui-answer body (user submit via existing chat.send).
 * submission_id is also chat.send idempotencyKey — schema stays closed.
 */
export const OguiAnswerSchema = Type.Object(
  {
    schema_version: OguiSchemaVersionSchema,
    component_id: NonEmptyString,
    submission_id: NonEmptyString,
    answers: Type.Record(NonEmptyString, NonEmptyString),
    submitted_at: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
