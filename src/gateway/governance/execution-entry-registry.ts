/**
 * Execution entry registry — machine-readable implementation view of governance
 * closure plan v1.0 §5 (E1–E18) and §5.2 (Capability Entry Inventory).
 *
 * The inventory source of truth stays
 * `.kiro/specs/constitutional-governance-discovery/execution-entry-inventory.md`
 * (plan §5.2 / Q11); its "Governance closure implementation view" section mirrors this
 * file and the contract test (`governance-contract.test.ts`) keeps them aligned.
 *
 * Status vocabulary is exactly Governed | Shadow | Legacy | Exempt | Bypass (plan §1.2).
 * Bypass must name a follow-up phase; Exempt must give a reason. Cells still awaiting
 * a symbol check keep a conservative status plus `pendingSymbolCheck` — the check only
 * flips the status; the inventory id is never removed (plan §7.4).
 */

export type GovernanceEntryStatus = "Governed" | "Shadow" | "Legacy" | "Exempt" | "Bypass";

export const GOVERNANCE_ENTRY_STATUSES: readonly GovernanceEntryStatus[] = [
  "Governed",
  "Shadow",
  "Legacy",
  "Exempt",
  "Bypass",
];

export type GovernanceEntryDimension = {
  status: GovernanceEntryStatus;
  followUp?: string;
  exemptReason?: string;
  note?: string;
};

export type ExecutionEntry = {
  id: string;
  name: string;
  /** Code anchors (symbol names, not line numbers). */
  symbols: string[];
  status: GovernanceEntryStatus;
  /** Required for Bypass. Phase or PR that closes the gap. */
  followUp?: string;
  /** Required for Exempt. */
  exemptReason?: string;
  /** Plan §7.4: status is provisional until the named symbol path is verified. */
  pendingSymbolCheck?: string;
  /** Per-aspect status when one entry mixes governed and bypassed aspects. */
  dimensions?: Record<string, GovernanceEntryDimension>;
  note?: string;
};

export const EXECUTION_ENTRY_REGISTRY: readonly ExecutionEntry[] = [
  {
    id: "E1",
    name: "chat.send → agent-runner-execution",
    symbols: ["runAgentTurnWithFallback", "authorizeCommercialRun"],
    status: "Governed",
    dimensions: {
      commercial: { status: "Governed" },
      model: {
        status: "Governed",
        note: "显式 mode，默认 shadow；硬过滤来自 allowlistEnforcement preexisting，mode 为 legacy 时同样过滤；改成 enforced 不改变候选，分歧按构造为 D0，不能当作 §8.4 收紧证据",
      },
      agentInvocation: {
        status: "Shadow",
        note: "OPENBOT_GOVERNANCE_AGENT_INVOCATION_SHADOW default off; evaluateAgentInvocation only",
      },
    },
  },
  {
    id: "E1f",
    name: "followup-runner",
    symbols: ["createFollowupRunner"],
    status: "Governed",
    note: "显式 mode，默认 shadow；硬过滤来自 allowlistEnforcement preexisting，mode 为 legacy 时同样过滤；改成 enforced 不改变候选，分歧按构造为 D0，不能当作 §8.4 收紧证据",
  },
  {
    id: "E1m",
    name: "memory flush",
    symbols: [
      "runMemoryFlushIfNeeded",
      "resolveMemoryFlushModelGovernance",
      "resolveModelFallbackOptions",
    ],
    status: "Shadow",
    note: "默认 shadow、只记录、flag 不另设；allowlistEnforcement 缺省 governance-mode，不过滤；chat 路径上 flush 早于 rememberRunModelSet（runReplyAgent 先 runMemoryFlushIfNeeded，后 runAgentTurnWithFallback），父集合查找落空，信封为 skipped + parent-model-set-absent，拿不到父 allowlist",
    followUp: "P3 enforced after §8.4 parity (default stays shadow; no separate flush flag)",
  },
  // --- Post-PR-1a (#134): E2/E3 are `Shadow` for enterprise-scoped runs; a run whose
  // --- commercial gate is `skipped` records `legacy` + `skipped`. E7.dimensions.model is `Shadow`.
  {
    id: "E2",
    name: "agent RPC",
    symbols: [
      "agentCommandFromIngress",
      "acquireAgentCommandCommercialRun",
      "resolveAgentCommandModelGovernance",
    ],
    status: "Shadow",
    followUp: "P3 (enforced only after §8.4 parity); no enterprise scope stays Legacy",
    dimensions: {
      commercial: { status: "Governed" },
      model: {
        status: "Shadow",
        note: "OPENBOT_GOVERNANCE_AGENT_COMMAND_MODEL_MODE default shadow; gate skipped ⇒ legacy",
      },
    },
  },
  {
    id: "E3",
    name: "local CLI `openbot agent`",
    symbols: [
      "agentCommand",
      "acquireAgentCommandCommercialRun",
      "resolveAgentCommandModelGovernance",
    ],
    status: "Shadow",
    followUp: "P3; no enterprise scope stays Legacy; enforced needs explicit config (Q6)",
    dimensions: {
      commercial: { status: "Governed" },
      model: {
        status: "Shadow",
        note: "same helper as E2; gate skipped ⇒ legacy + skipped",
      },
    },
  },
  {
    id: "E4",
    name: "cron isolated",
    symbols: ["runCronIsolatedAgentTurn"],
    status: "Governed",
    note: "显式 mode，默认 shadow；硬过滤来自 allowlistEnforcement preexisting，mode 为 legacy 时同样过滤；改成 enforced 不改变候选，分歧按构造为 D0，不能当作 §8.4 收紧证据",
  },
  {
    id: "E5",
    name: "cron main-session heartbeat",
    symbols: ["runHeartbeatOnce", "getReplyFromConfig"],
    status: "Exempt",
    exemptReason:
      "routes into E1 (runHeartbeatOnce → getReplyFromConfig → runPreparedReply → runReplyAgent → runAgentTurnWithFallback); not an independent surface",
    note: "P2-0 symbol check: joins the already-governed E1 chat reply path; do not newly mark Governed",
  },
  {
    id: "E6a",
    name: "subagent spawn",
    symbols: ["spawnSubagentDirect"],
    status: "Shadow",
    followUp:
      "P3; spawn looks up the parent model set; missing snapshot records skipped, not allow; default mode shadow",
    note: "P0: 子 run 调用 acquireAgentCommandCommercialRun（entry E6），占用配额与并发。模型 allowlist 仍来自父快照。父授权入账只在子闸口 skipped 且 OPENBOT_SUBAGENT_CREDIT_USAGE 为真时发生。",
  },
  {
    id: "E6b",
    name: "subagent steer",
    symbols: ["steerControlledSubagentRun"],
    status: "Shadow",
    followUp:
      "P3; steer looks up the parent model set by child runId; missing snapshot records skipped, not allow; default mode shadow",
    note: "P0: 子 run 调用 acquireAgentCommandCommercialRun（entry E6），占用配额与并发。模型 allowlist 仍来自父快照。父授权入账只在子闸口 skipped 且 OPENBOT_SUBAGENT_CREDIT_USAGE 为真时发生。",
  },
  {
    id: "E6c",
    name: "subagent follow-up message",
    symbols: ["sendControlledSubagentMessage"],
    status: "Shadow",
    followUp:
      "P3; follow-up looks up the parent model set by child runId; missing snapshot records skipped, not allow; default mode shadow",
    note: "P0: 子 run 调用 acquireAgentCommandCommercialRun（entry E6），占用配额与并发。模型 allowlist 仍来自父快照。父授权入账只在子闸口 skipped 且 OPENBOT_SUBAGENT_CREDIT_USAGE 为真时发生。",
  },
  {
    id: "E7",
    name: "inter-agent bus",
    symbols: ["sendAgentTask", "sendAgentMention"],
    status: "Bypass",
    followUp: "identity handoff (bus idempotencyKey staging); never Governed before it lands",
    dimensions: {
      commercial: { status: "Governed", note: "NESTED lane is not skipped" },
      model: { status: "Shadow", note: "via agent command (PR-1a); NESTED lane runs the gate" },
      identity: { status: "Bypass", followUp: "bus identity staging (plan §4.7.4)" },
    },
  },
  {
    id: "E8",
    name: "/tools/invoke",
    symbols: ["handleToolsInvokeHttpRequest"],
    status: "Shadow",
    followUp:
      "P3/P7：§8.4 后按租户 enforced；OPENBOT_GOVERNANCE_TOOLS_INVOKE_MODE default shadow (never enforced in code); OPENBOT_GOVERNANCE_TOOLS_INVOKE_SHADOW 默认关",
    note: "P5-2/P5-4: evaluateToolsInvokeCapability can yield allow|deny; unset/lookup failure stays skipped (never allow). MODE default shadow; enforced+deny only then changes HTTP (404 not_found). SHADOW flag default off.",
  },
  {
    id: "E9",
    name: "node.invoke",
    symbols: ["node.invoke"],
    status: "Shadow",
    followUp:
      "flag OPENBOT_GOVERNANCE_NODE_INVOKE_SHADOW default off; independent of preflight observe",
  },
  {
    id: "E10",
    name: "image model fallback",
    symbols: ["runWithImageModelFallback", "runImagePrompt", "runPdfPrompt"],
    status: "Shadow",
    followUp:
      "P3; parent model set is read by runId; OPENBOT_GOVERNANCE_IMAGE_MODEL_MODE default shadow records only",
  },
  {
    id: "E11",
    name: "enterprise data capability",
    symbols: ["invokeDataCapabilityForAgent", "invokeDataCapabilityWithContext"],
    status: "Governed",
    note: "P5-0 re-read: seat, grant, and quota still run, then knowledge-object-only (ok false). Effect map is frozen; this row does not change the invoke result.",
  },
  {
    id: "E12",
    name: "knowledge capability",
    symbols: ["invokeKnowledgeCapability", "knowledge.capability.invoke"],
    status: "Governed",
    note: "P5-0: server-methods/knowledge.ts handler knowledge.capability.invoke calls invokeKnowledgeCapability. Pending symbol check cleared.",
  },
  {
    id: "E13",
    name: "ACP in-process dispatch / steer",
    symbols: ["tryDispatchAcpReply"],
    status: "Exempt",
    exemptReason: "external execution surface (AcpRuntime); P5 only registers dispatch points",
  },
  {
    id: "E14",
    name: "ACP stdio bridge → chat.send",
    symbols: ["chat.send"],
    status: "Governed",
    note: "governed through E1",
  },
  {
    id: "E15",
    name: "AOR",
    symbols: ["packages/aor-core"],
    status: "Exempt",
    exemptReason: "library unchanged; runtime traffic flows through E2/E8",
  },
  {
    id: "E16",
    name: "CLI backend",
    symbols: ["runCliAgent", "recordCliBackendUsage"],
    status: "Exempt",
    exemptReason: "credential scope + recordCliBackendUsage; external CLI process",
    note: "P2-0: CLI backend runs pass acquireAgentCommandCommercialRun (E3) before runCliAgent; credit stays on recordCliBackendUsage",
  },
  {
    id: "E17",
    name: "Fabric",
    symbols: ["OPENBOT_FABRIC_ENABLED"],
    status: "Legacy",
    note: "off by default; P2 adds an adapter only, never enables it",
  },
  {
    id: "E18",
    name: "task-orchestration",
    symbols: ["ORCHESTRATION_LIVE_INVOKE"],
    status: "Exempt",
    exemptReason: "ORCHESTRATION_LIVE_INVOKE=false; not enabled by this plan",
  },
  {
    id: "E19",
    name: "inbound media understanding",
    symbols: ["applyMediaUnderstanding", "describeImageWithModel", "runProviderEntry"],
    status: "Shadow",
    followUp:
      "OPENBOT_GOVERNANCE_MEDIA_UNDERSTANDING_SHADOW 默认关；MODE 默认 shadow，enforced 未实现（这一阶段拿不到 allowlist，过滤无从谈起）。要真正治理需要先把入站管线接上租户权益解析",
    note: "前置于 agent run：选模型并直连 provider（describeImageWithModel → complete、transcribeAudio、视频描述），不经 runWithModelFallback/runWithImageModelFallback，因此 §4.8 的覆盖规则结构上看不见它，权益 allowlist 在任何 mode 下都不被查询。用的是当前会话模型（resolveActiveModelEntry），不是 agents.defaults.imageModel。信封恒为 skipped + media-understanding-pre-agent，没有 runId（此时 run 尚不存在），归属取自入站回合。见 direct-model-invocation-registry.ts",
  },
];

/** §5.2 uses the capability three-state vocabulary, not the entry statuses. */
export type CapabilityInventoryStatus = "REUSE" | "BYPASS" | "EXEMPT";

export type CapabilityInventoryEntry = {
  id: string;
  entry: string;
  status: CapabilityInventoryStatus;
  followUp?: string;
  exemptReason?: string;
  pendingSymbolCheck?: string;
};

export const CAPABILITY_ENTRY_INVENTORY: readonly CapabilityInventoryEntry[] = [
  {
    id: "tool-pi",
    entry: "pi-tools + tool-policy-pipeline + preflight",
    status: "REUSE",
    followUp:
      "租户级能力治理不在本层（计划原判，未改）。但这一层承载全部租户工具流量：浏览器用户只能让 agent 在回合内调工具，没有 WS tools.invoke 方法。applyToolPolicyPipeline 决定模型能看见哪些工具，不是租户能力决策，也不写治理信封。因此 evaluateToolsInvokeCapability 覆盖不到任何租户流量 —— 要改需要先决定是否把租户能力决策下沉到本层",
  },
  {
    id: "tool-http",
    entry: "/tools/invoke",
    status: "REUSE",
    followUp:
      'P5-3/P5-4: governance envelope via tools-invoke shadow / evaluateToolsInvokeCapability; unset or lookup failure stays skipped (never allow). OPENBOT_GOVERNANCE_TOOLS_INVOKE_MODE default shadow; OPENBOT_GOVERNANCE_TOOLS_INVOKE_SHADOW default off. 可达性限制（2026-10-01 实测）：tenantId 只来自 authResult.method === "trusted-proxy"，而该方法仅在 loopback-direct 时放行，即同机反代转发已认证租户身份这一条路；其余获准调用者（loopback CLI、共享密钥、设备令牌）没有 enterpriseId，信封恒为 skipped + no-enterprise-scope。故 enterpriseCapabilityDecision 这一支在部署拓扑下无租户流量可达',
  },
  { id: "skill", entry: "skill-policy / skill invocation", status: "REUSE" },
  {
    id: "MCP",
    entry: "not located",
    status: "BYPASS",
    followUp:
      "P5-0: no MCP capability invoke in src/agents, src/gateway/server-methods, or extensions. mcp-config.ts and the enterprise-capability mcp catalog are binding/catalog only, not an allow decision. Stay BYPASS until an invoke entry exists",
  },
  {
    id: "node",
    entry: "node.invoke",
    status: "BYPASS",
    followUp: "OPENBOT_GOVERNANCE_NODE_INVOKE_SHADOW default off",
  },
  {
    id: "knowledge",
    entry: "knowledge.capability.invoke → invokeKnowledgeCapability",
    status: "REUSE",
  },
  {
    id: "enterprise-data",
    entry: "invokeDataCapabilityForAgent / invokeDataCapabilityWithContext",
    status: "REUSE",
  },
  {
    id: "browser",
    entry: "browser.request",
    status: "BYPASS",
    followUp:
      "P5-0: located browser.request in server-methods/browser.ts (browserHandlers). It proxies browser.proxy or local browser control and has no tenant capability policy. Stay BYPASS; not a CapabilityInvokeAdapter input",
  },
  { id: "workspace", entry: "resolveAuthorizedToolCwd", status: "REUSE" },
  {
    id: "ACP",
    entry: "external AcpRuntime",
    status: "EXEMPT",
    exemptReason: "external execution surface",
  },
];

/**
 * PR-P5-0 freeze of the CapabilityInvokeAdapter effect map (plan §4.5 / PR-P5-0).
 * P5-1 may import this table. Nothing here evaluates, records, or changes an invoke.
 *
 * `ok === true` is the only allow, and the only row that counts toward allow coverage.
 * `handler-error` is declared on CapabilityDataInvocationReason and has no production
 * return site today; it stays `skipped` so a later handler failure cannot be recorded
 * as a governance allow. `knowledge-object-only` is the EDGSC red line 5 terminal
 * result and is product-locked to `deny` for this round.
 */
export type CapabilityInvokeGovernanceEffect = "allow" | "deny" | "skipped";

export type CapabilityInvokeSourceResult =
  | "ok"
  | "not-authorized"
  | "not-found"
  | "disabled"
  | "no-tenant"
  | "no-seat"
  | "quota-exceeded"
  | "handler-error"
  | "knowledge-object-only";

export type CapabilityInvokeAdapterMappingRow = {
  source: CapabilityInvokeSourceResult;
  effect: CapabilityInvokeGovernanceEffect;
  /**
   * `original` keeps the source reason. `empty` is only for allow, which may omit a reason.
   */
  reason: "original" | "empty";
  /** True only when effect is allow. `handler-error` is skipped and is outside allow coverage. */
  countsTowardAllowCoverage: boolean;
};

export const CAPABILITY_INVOKE_ADAPTER_MAPPING: readonly CapabilityInvokeAdapterMappingRow[] = [
  { source: "ok", effect: "allow", reason: "empty", countsTowardAllowCoverage: true },
  {
    source: "not-authorized",
    effect: "deny",
    reason: "original",
    countsTowardAllowCoverage: false,
  },
  { source: "not-found", effect: "deny", reason: "original", countsTowardAllowCoverage: false },
  { source: "disabled", effect: "deny", reason: "original", countsTowardAllowCoverage: false },
  { source: "no-tenant", effect: "deny", reason: "original", countsTowardAllowCoverage: false },
  { source: "no-seat", effect: "deny", reason: "original", countsTowardAllowCoverage: false },
  {
    source: "quota-exceeded",
    effect: "deny",
    reason: "original",
    countsTowardAllowCoverage: false,
  },
  {
    source: "handler-error",
    effect: "skipped",
    reason: "original",
    countsTowardAllowCoverage: false,
  },
  {
    source: "knowledge-object-only",
    effect: "deny",
    reason: "original",
    countsTowardAllowCoverage: false,
  },
];
