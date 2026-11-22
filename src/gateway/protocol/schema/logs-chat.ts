import { Type } from "@sinclair/typebox";
import { INPUT_PROVENANCE_KIND_VALUES } from "../../../sessions/input-provenance.js";
import { ChatSendSessionKeyString, NonEmptyString } from "./primitives.js";

export const LogsTailParamsSchema = Type.Object(
  {
    cursor: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
    maxBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
  },
  { additionalProperties: false },
);

export const LogsTailResultSchema = Type.Object(
  {
    file: NonEmptyString,
    cursor: Type.Integer({ minimum: 0 }),
    size: Type.Integer({ minimum: 0 }),
    lines: Type.Array(Type.String()),
    truncated: Type.Optional(Type.Boolean()),
    reset: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

// WebChat/WebSocket-native chat methods
export const ChatHistoryParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
    /** Opaque cursor from a prior page's `nextBefore` (CL-P1-02). Live transcript only. */
    before: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    includeTools: Type.Optional(Type.Boolean()),
    // P3a（往期/归档会话）：includeArchives=true 时在响应里附带本会话可访问的归档转写列表；
    // archiveId 指定时读取该归档转写（而非当前会话）。两者都受 cwd 归属闸门保护（见 chat.ts）。
    includeArchives: Type.Optional(Type.Boolean()),
    archiveId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    /** Internal 1:1 send: tenant store owner when the socket has no user. */
    sessionOwnerPlatformUserId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ChatSendParamsSchema = Type.Object(
  {
    sessionKey: ChatSendSessionKeyString,
    dependencyResumeId: Type.Optional(Type.String({ pattern: "^[a-f0-9]{40}$" })),
    dependencyResumeCapability: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })),
    message: Type.String(),
    thinking: Type.Optional(Type.String()),
    deliver: Type.Optional(Type.Boolean()),
    attachments: Type.Optional(Type.Array(Type.Unknown())),
    mentions: Type.Optional(
      Type.Array(
        Type.Object(
          {
            mention_id: NonEmptyString,
            /** Legacy agent target or "__all__". Optional when target/targetKind is set. */
            agentId: Type.Optional(NonEmptyString),
            displayName: Type.String(),
            offset: Type.Integer({ minimum: 0 }),
            length: Type.Integer({ minimum: 0 }),
            targetKind: Type.Optional(
              Type.Unsafe<string>({
                type: "string",
                enum: ["agent", "human", "all", "plugin"],
              }),
            ),
            targetId: Type.Optional(Type.String()),
            target: Type.Optional(
              Type.Object(
                {
                  kind: Type.Unsafe<string>({
                    type: "string",
                    enum: ["agent", "human", "all", "plugin"],
                  }),
                  agentId: Type.Optional(Type.String()),
                  userId: Type.Optional(Type.String()),
                  pluginId: Type.Optional(Type.String()),
                },
                { additionalProperties: false },
              ),
            ),
          },
          { additionalProperties: false },
        ),
      ),
    ),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
    systemInputProvenance: Type.Optional(
      Type.Object(
        {
          kind: Type.String({ enum: [...INPUT_PROVENANCE_KIND_VALUES] }),
          originSessionId: Type.Optional(Type.String()),
          sourceSessionKey: Type.Optional(Type.String()),
          sourceChannel: Type.Optional(Type.String()),
          sourceTool: Type.Optional(Type.String()),
          cronJobId: Type.Optional(Type.String()),
          cronRunId: Type.Optional(Type.String()),
          cronJobName: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
    cronReplyContext: Type.Optional(
      Type.Object(
        {
          jobId: NonEmptyString,
          runId: Type.Optional(Type.String()),
          jobName: Type.Optional(Type.String({ maxLength: 200 })),
        },
        { additionalProperties: false },
      ),
    ),
    systemProvenanceReceipt: Type.Optional(Type.String()),
    growthBirthTurn: Type.Optional(Type.Boolean()),
    growthGateProceed: Type.Optional(Type.Boolean()),
    /** User confirmed parking the current focus to start a different task. */
    focusSwitchProceed: Type.Optional(Type.Boolean()),
    /** User consented to cancel the current focus and start the incoming task. */
    focusSwitchCancel: Type.Optional(Type.Boolean()),
    /** Target's choice on a pending cross-person steward call card. */
    stewardCallAuthorizationId: Type.Optional(Type.String()),
    /** User explicitly steered the turn (checkpoint restore, undo-resend, etc.). */
    humanTakeoverObserved: Type.Optional(Type.Boolean()),
    /** Structured composer quote; mention parsing uses `message` body only. */
    composerQuote: Type.Optional(
      Type.Object(
        {
          messageId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          excerpt: NonEmptyString,
        },
        { additionalProperties: false },
      ),
    ),
    /**
     * TEAM-REAL: bind NL plan confirm to the card/version the user actually saw.
     * Schema-backed (not type-assertion-only). Prefer over group currentTaskId.
     */
    planConfirmTaskId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    planConfirmBoardItemId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    planConfirmTodolistId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    planConfirmDecisionId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    planConfirmExpectedVersion: Type.Optional(Type.Integer({ minimum: 0 })),
    idempotencyKey: NonEmptyString,
    contextScope: Type.Optional(
      Type.Object(
        {
          mode: Type.Optional(
            Type.Unsafe<string>({
              type: "string",
              enum: ["minimal", "auto", "focused", "deep"],
            }),
          ),
          lifetime: Type.Optional(
            Type.Unsafe<string>({
              type: "string",
              enum: ["turn", "session"],
            }),
          ),
          sources: Type.Optional(
            Type.Array(
              Type.Object(
                {
                  type: Type.Unsafe<string>({
                    type: "string",
                    enum: ["conversation", "group", "knowledge", "folder", "file", "api"],
                  }),
                  id: NonEmptyString,
                  parentId: Type.Optional(NonEmptyString),
                },
                { additionalProperties: false },
              ),
            ),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const ChatAbortParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    runId: Type.Optional(NonEmptyString),
    mode: Type.Optional(Type.String({ enum: ["stop", "undo"] })),
  },
  { additionalProperties: false },
);

export const ChatInjectParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    message: NonEmptyString,
    label: Type.Optional(Type.String({ maxLength: 100 })),
    /**
     * Write the line as the sending digital human inside the target session.
     * Does not start an agent run. Used when a robot answers the one who just
     * wrote, so the answer is visible there without nesting another wake.
     */
    peerDelivery: Type.Optional(Type.Boolean()),
    /**
     * Write the sent line onto the sending session with a durable `sentTo`
     * envelope. Does not start an agent run.
     */
    peerOutbound: Type.Optional(Type.Boolean()),
    sentTo: Type.Optional(
      Type.Array(
        Type.Object(
          {
            label: Type.String({ minLength: 1, maxLength: 80 }),
            agentId: Type.Optional(Type.String({ maxLength: 64 })),
            sessionKey: Type.Optional(Type.String({ maxLength: 200 })),
          },
          { additionalProperties: false },
        ),
        { minItems: 1, maxItems: 12 },
      ),
    ),
    senderLabel: Type.Optional(Type.String({ maxLength: 80 })),
    sourceSessionKey: Type.Optional(Type.String({ maxLength: 200 })),
    /** Internal 1:1 send: tenant store owner when the socket has no user. */
    sessionOwnerPlatformUserId: Type.Optional(Type.String()),
    cronJobId: Type.Optional(NonEmptyString),
    cronRunId: Type.Optional(Type.String()),
    cronJobName: Type.Optional(Type.String({ maxLength: 200 })),
    cronResultKind: Type.Optional(
      Type.Unsafe<string>({ type: "string", enum: ["result", "parked_notice"] }),
    ),
  },
  { additionalProperties: false },
);

const DaibaiGuideCustomNameSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 32 }),
    name: Type.String({ minLength: 1, maxLength: 40 }),
  },
  { additionalProperties: false },
);

const DaibaiGuideCreatedMemberSchema = Type.Object(
  {
    catalogId: Type.String({ minLength: 1, maxLength: 32 }),
    agentId: Type.String({ minLength: 1, maxLength: 80 }),
    name: Type.String({ minLength: 1, maxLength: 40 }),
  },
  { additionalProperties: false },
);

const DaibaiGuideCardStateSchema = Type.Object(
  {
    step: Type.Literal("page"),
    path: Type.Union([
      Type.Literal("catalog"),
      Type.Literal("describe"),
      Type.Literal("custom"),
      Type.Null(),
    ]),
    category: Type.Unsafe<string>({
      type: "string",
      enum: ["all", "office", "growth", "rd", "ops"],
    }),
    selectedIds: Type.Array(Type.String({ maxLength: 32 }), { maxItems: 8 }),
    selectedLabels: Type.Array(Type.String({ maxLength: 40 }), { maxItems: 8 }),
    role: Type.Union([Type.String({ maxLength: 16 }), Type.Null()]),
    taskText: Type.String({ maxLength: 500 }),
    proposedIds: Type.Array(Type.String({ maxLength: 32 }), { maxItems: 8 }),
    customNames: Type.Array(DaibaiGuideCustomNameSchema, { maxItems: 8 }),
    created: Type.Array(DaibaiGuideCreatedMemberSchema, { maxItems: 8 }),
  },
  { additionalProperties: false },
);

/**
 * Append one 大白引导 card onto the caller’s steward transcript.
 * Does not start an agent run and does not grant MCP / OI.
 */
export const ChatGuideAppendParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    slot: Type.Unsafe<string>({ type: "string", enum: ["welcome", "team"] }),
    state: Type.Optional(DaibaiGuideCardStateSchema),
  },
  { additionalProperties: false },
);

export const ChatRestoreParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    // Optional target checkpoint. When omitted, restores the latest checkpoint
    // (backward compatible). chat-checkpoint-rollback.
    checkpointId: Type.Optional(NonEmptyString),
    /** When a run is active, queue restore for after the run completes. */
    queueWhenActive: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const ChatCheckpointsListParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
  },
  { additionalProperties: false },
);

export const UserVisibleMessageEventSchema = Type.Object(
  {
    type: Type.Literal("message"),
    role: Type.String({ enum: ["user", "assistant"] }),
    content: NonEmptyString,
  },
  { additionalProperties: false },
);

export const UserVisibleTaskCardSchema = Type.Object(
  {
    id: NonEmptyString,
    title: NonEmptyString,
    step_current: Type.Integer({ minimum: 1 }),
    step_total: Type.Integer({ minimum: 1 }),
    step_name: NonEmptyString,
    status: Type.String({ enum: ["running", "waiting", "blocked", "success", "failed"] }),
    progress: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
    elapsed_time: Type.Optional(Type.Integer({ minimum: 0 })),
    estimated_time: Type.Optional(NonEmptyString),
    message: Type.Optional(NonEmptyString),
    taskId: Type.Optional(NonEmptyString),
    agentId: Type.Optional(NonEmptyString),
    outcomeVersion: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const UserVisibleTaskEventSchema = Type.Object(
  {
    type: Type.Literal("task_update"),
    task: UserVisibleTaskCardSchema,
  },
  { additionalProperties: false },
);

export const UserVisibleArtifactContextSchema = Type.Object(
  {
    task_id: NonEmptyString,
    step_index: Type.Integer({ minimum: 1 }),
    step_name: NonEmptyString,
    purpose: NonEmptyString,
    next_action: NonEmptyString,
  },
  { additionalProperties: false },
);

export const UserVisibleArtifactEventSchema = Type.Object(
  {
    type: Type.Literal("artifact"),
    artifact: Type.Object(
      {
        id: NonEmptyString,
        artifact_type: Type.String({
          enum: ["document", "report", "markdown", "ppt", "config"],
        }),
        title: NonEmptyString,
        content: NonEmptyString,
        preview: Type.Boolean(),
        preview_required: Type.Optional(Type.Boolean()),
        context: UserVisibleArtifactContextSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const ChatThinkingProgressStepSchema = Type.Object(
  {
    id: NonEmptyString,
    label: NonEmptyString,
    status: Type.Union([Type.Literal("pending"), Type.Literal("active"), Type.Literal("done")]),
  },
  { additionalProperties: false },
);

export const ChatThinkingProgressSchema = Type.Object(
  {
    steps: Type.Array(ChatThinkingProgressStepSchema, { minItems: 1, maxItems: 8 }),
    activeIndex: Type.Integer({ minimum: 0 }),
    percent: Type.Number({ minimum: 0, maximum: 100 }),
    placeholder: NonEmptyString,
  },
  { additionalProperties: false },
);

export const ChatEventSchema = Type.Object(
  {
    runId: NonEmptyString,
    sessionKey: NonEmptyString,
    seq: Type.Integer({ minimum: 0 }),
    state: Type.Union([
      Type.Literal("delta"),
      Type.Literal("final"),
      Type.Literal("aborted"),
      Type.Literal("error"),
      /** Process-channel only: structure + progress while delivery text is empty. */
      Type.Literal("thinking"),
      /**
       * Non-terminal status/progress receipt (e.g. discuss→task establish).
       * Must not end the parent chat run — clients treat like progress, not final.
       */
      Type.Literal("status"),
    ]),
    message: Type.Optional(Type.Unknown()),
    /** Present only when a TaskOutcome tip already exists for this run. */
    taskUpdate: Type.Optional(UserVisibleTaskEventSchema),
    /** Safe thinking outline/progress; never raw CoT. Process ≠ delivery. */
    thinking: Type.Optional(ChatThinkingProgressSchema),
    errorMessage: Type.Optional(Type.String()),
    usage: Type.Optional(Type.Unknown()),
    stopReason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
