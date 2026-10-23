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
    /**
     * Optional projection of a server-minted decision.
     * Protocol `decision_id` ↔ logical `decisionId`. Reference only.
     * Both fields absent = ordinary form. A present version must be a
     * positive integer. Pairing is enforced by the lifecycle helper, not
     * by rejecting the form here (PIN-3: a schema drop must not become
     * plain-chat continuation of the original decision).
     */
    decision_id: Type.Optional(NonEmptyString),
    /** Protocol `decision_version` ↔ logical `version`. Positive integer. */
    decision_version: Type.Optional(Type.Integer({ minimum: 1 })),
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
 * `submission_id` is the per-attempt chat.send idempotency key.
 * It is not the decision consume key.
 *
 * `decision_id` + `decision_version` (logical decisionId + version) are
 * optional so legacy OGUI answers omit them (Ev1 / PIN-3). When
 * `decision_version` is present it must be a positive integer. A lifecycle
 * card must carry both fields; the consume helper rejects a missing side,
 * an unknown id, or a version mismatch and must not fall back to plain chat
 * (Ev2). Keeping a half-present answer schema-valid lets that helper see it
 * instead of dropping the fence.
 */
export const OguiAnswerSchema = Type.Object(
  {
    schema_version: OguiSchemaVersionSchema,
    component_id: NonEmptyString,
    submission_id: NonEmptyString,
    answers: Type.Record(NonEmptyString, NonEmptyString),
    submitted_at: Type.Optional(Type.String()),
    /** Server-minted decision reference. Logical name: decisionId. */
    decision_id: Type.Optional(NonEmptyString),
    /** Server-minted monotonic version. Logical name: version. Positive integer. */
    decision_version: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);
