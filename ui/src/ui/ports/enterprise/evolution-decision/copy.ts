/**
 * User-facing copy for the enterprise Decision Surface.
 *
 * Everything an enterprise admin can read comes from this file. Contract
 * values (actions, reason codes, decision types, authorities, surface ids,
 * statuses, claim grades, receipt refs) stay in types, `data-*` attributes,
 * logs, and tests. They reach the page only through the label maps below,
 * and unknown values fall back to a generic Chinese label instead of being
 * echoed.
 * Claim grade: code-present. Not runtime-enabled.
 */

import type { EvolutionTarget } from "@openbot/evolution-core";
import type {
  EvolutionDecisionAction,
  EvolutionDecisionRequiredAuthority,
  EvolutionDecisionType,
  EvolutionEnterpriseDecisionUiStatus,
  EvolutionEnterpriseEvidenceSummary,
} from "../../../evolution-decision-contract.ts";

export const EVOLUTION_ENTERPRISE_DECISION_COPY = {
  title: "需要企业决定",
  subtitle: "查看需要企业管理员参与的进化事项。提交的请求只做规则校验，不会直接修改数字人或系统。",
  loading: "正在读取进化事项…",
  empty: "当前没有需要企业决定的进化事项。",
  loadFail: "进化事项读取失败，当前状态未知，请稍后再试。",
  evidenceUnavailable: "这些事项的依据摘要暂不可用，暂时不能据此判断它们是否正常。",
  wowTitle: "本周相对上周",
  historyUnavailable: "暂无足够历史数据，不能形成企业周度对比。",
  wowTotalLabel: "事项总数",
  transitionsTitle: "逐项状态变化",
  noTransitions: "本周没有事项改变状态。",
  listTitle: "待决事项",
  targetLabel: "影响对象",
  authorityLabel: "需要谁处理",
  actionsLabel: "可执行动作",
  noAction: "当前没有可执行动作",
  notActionableLabel: "当前不可操作",
  unavailableActionLabel: "暂不可执行",
  evidenceLabel: "依据",
  employeeEvidenceWithheld: "相关依据由员工本人或授权系统保管，这里不展示明细。",
  canaryNeedsConfirmation: "平台变更将影响本企业，需要确认是否参与灰度。",
  canaryConfirmed: "平台变更将影响本企业，本企业已确认参与灰度。",
  canaryAffects: "平台变更将影响本企业。",
  citationUnit: "条引用",
  findingUnit: "条发现",
  caseLinked: "有关联案例",
  caseNone: "无关联案例",
  createdLabel: "创建",
  updatedLabel: "更新",
  expiresLabel: "截止",
  unknownDate: "时间未知",
  receiptAccepted: "请求已通过规则校验，但尚未执行。",
  receiptReplay: "重复请求已识别；原请求尚未执行。",
  receiptRefusedPrefix: "请求未通过规则校验",
  receiptNotExecuted: "没有执行任何变更。",
  priorWeek: "上周",
  currentWeek: "本周",
  itemUnit: "项",
  increased: "增加",
  decreased: "减少",
  unchanged: "没有变化",
  absentBefore: "上周未出现",
  absentNow: "本周不再显示",
  fallbackAction: "未知操作",
  fallbackReason: "暂不可执行",
  fallbackDecisionType: "进化事项",
  fallbackAuthority: "负责的管理员",
  fallbackDomain: "相关对象",
  fallbackSurface: "未登记对象",
  fallbackStatus: "状态未知",
  fallbackEvidence: "依据状态未知",
} as const;

/** Enterprise status → 中文业务状态 (row badge). */
export const EVOLUTION_ENTERPRISE_DECISION_STATUS_LABELS: Readonly<
  Record<EvolutionEnterpriseDecisionUiStatus, string>
> = {
  "pending-enterprise-decision": "待企业决定",
  "waiting-employee-authorization": "等待本人最终授权",
  "participate-platform-canary": "需要参与平台灰度",
  watching: "观察中",
  completed: "已完成",
  blocked: "当前受阻",
  expired: "已过期",
};

/** Enterprise status → 周度统计的分类名称. */
export const EVOLUTION_ENTERPRISE_DECISION_WOW_LABELS: Readonly<
  Record<EvolutionEnterpriseDecisionUiStatus, string>
> = {
  "pending-enterprise-decision": "企业待决定",
  "waiting-employee-authorization": "等待员工最终授权",
  "participate-platform-canary": "参与平台灰度",
  watching: "观察中",
  completed: "已完成",
  blocked: "阻断",
  expired: "过期",
};

/** Decision action → 中文操作（按钮正文）. */
export const EVOLUTION_ENTERPRISE_DECISION_ACTION_LABELS: Readonly<
  Record<EvolutionDecisionAction, string>
> = {
  hold: "暂停",
  reject: "拒绝",
  rollback: "回滚",
  start_experiment: "启动实验",
  apply_canary: "灰度应用",
  verify: "验证效果",
  promote: "推广",
  participate_canary: "参与平台灰度",
  authorize: "授权实验",
  approve_application: "批准应用",
  employee_final_authorization: "员工本人最终授权",
};

/** Decision type → 中文事项类型. */
export const EVOLUTION_ENTERPRISE_DECISION_TYPE_LABELS: Readonly<
  Record<EvolutionDecisionType, string>
> = {
  authorize_experiment: "实验授权",
  approve_application: "应用批准",
  hold_or_resume: "暂停或恢复",
  verify_effect: "效果验证",
  promote: "推广确认",
  rollback: "回滚确认",
  canary_participation: "灰度参与",
  employee_final_authorization: "员工最终授权",
};

/** Required authority → 中文处理角色（需要谁处理）. Never an action. */
export const EVOLUTION_ENTERPRISE_DECISION_AUTHORITY_LABELS: Readonly<
  Record<EvolutionDecisionRequiredAuthority, string>
> = {
  employee: "员工本人",
  enterprise: "企业管理员",
  platform: "平台管理员",
  platform_and_enterprise: "平台管理员，并需企业确认参与灰度",
  employee_and_enterprise: "企业管理员，并需员工本人最终授权",
};

/** Target domain → 中文对象. */
export const EVOLUTION_ENTERPRISE_DECISION_DOMAIN_LABELS: Readonly<
  Record<EvolutionTarget["domain"], string>
> = {
  agent: "数字人",
  knowledge: "知识",
  capability: "能力",
  organization: "组织",
  system: "系统",
};

/** Registered evolution surface → 中文对象名称. */
export const EVOLUTION_ENTERPRISE_DECISION_SURFACE_LABELS: Readonly<Record<string, string>> = {
  "agent.working-dna": "工作方式",
  "knowledge.experience-capsule": "经验胶囊",
  "knowledge.managed-memory": "托管记忆",
  "capability.skill-spec": "技能说明",
  "capability.skill-installation": "技能安装",
  "organization.task-routing": "任务分派",
  "organization.team-composition": "团队组成",
  "system.diagnosis-contract": "诊断规则",
  "system.runtime-binding-governance": "运行绑定治理",
};

/** Evidence availability → 中文依据状态. */
export const EVOLUTION_ENTERPRISE_DECISION_EVIDENCE_LABELS: Readonly<
  Record<EvolutionEnterpriseEvidenceSummary["availability"], string>
> = {
  available: "可查看摘要",
  unavailable: "摘要暂不可用",
  withheld: "不在此展示",
};

/**
 * Reason / refusal code → 中文原因. Covers the row reasons, the D1 judge,
 * authority, router, and grant gate codes, the enterprise denials, and the
 * UI's own refusals.
 */
export const EVOLUTION_ENTERPRISE_DECISION_REASON_LABELS: Readonly<Record<string, string>> = {
  handled: "事项已处理完毕",
  expired: "事项已过期",
  blocked: "事项受阻，暂时不能处理",
  not_pending: "事项当前不在待决状态",
  action_not_on_item: "该事项没有开放这个操作",
  action_not_allowed: "该事项没有开放这个操作",
  wrong_endpoint: "这一步由其他角色处理",
  participation_required: "该事项不需要这一步参与确认",
  participation_already_satisfied: "已经确认过，不需要重复确认",
  employee_authorization_required: "需要员工本人最终授权",
  enterprise_canary_required: "需要企业确认参与灰度",
  enterprise_not_core_approver: "企业管理员不能审批系统核心变更",
  endpoint_action_forbidden: "企业管理员不能执行这个操作",
  cross_tenant_mutation_forbidden: "跨企业问题只能暂停或拒绝",
  tenant_mismatch: "事项不属于当前企业",
  trusted_tenant_required: "无法确认当前企业",
  enterprise_admin_required: "需要企业管理员处理",
  platform_operator_required: "需要平台管理员处理",
  owner_unproven: "无法确认对象的所有者",
  owner_mismatch: "对象不属于这位员工",
  version_required: "缺少事项版本，请刷新后再试",
  version_mismatch: "事项已经更新，请刷新后再试",
  decision_version_required: "事项版本缺失，暂时不能受理",
  route_binding_mismatch: "事项归属与处理路径不一致",
  replay_binding_mismatch: "重复请求与原请求的归属不一致",
  command_rebind: "同一请求编号不能改作其他操作",
  invalid_command: "请求格式无效",
  client_authority_forbidden: "请求带有不能由页面提供的身份或依据",
  adapter_forbidden: "不能直接调用执行组件",
  perception_readonly: "进化履历只读，不能在那里做决定",
  daibai_chat_not_approval: "聊天内容不能作为正式批准",
  unmapped_action: "不支持这个操作",
  control_plane_action_unavailable: "这个操作暂未开放",
  decision_mismatch: "请求与事项不对应",
  forbidden_surface: "这个对象不允许进化",
  unknown_surface: "未登记的进化对象",
  surface_not_registered: "这个对象尚未登记",
  inconsistent_target: "事项对象信息不一致",
  scope_widened: "超出授权范围",
  authorization_required: "缺少有效授权",
  grant_expired: "授权已过期",
  grant_revoked: "授权已撤销",
  grant_inactive: "授权尚未生效",
  operation_forbidden: "这个对象不允许该操作",
  platform_approval_required: "需要平台批准",
  submit_context_unavailable: "暂时无法提交，请稍后再试",
  command_id_unavailable: "暂时无法提交，请稍后再试",
};
