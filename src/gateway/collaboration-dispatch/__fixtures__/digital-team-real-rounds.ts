/**
 * Regression fixtures distilled from real 数字人战队 (grp-daniel-hhd-gmail-com-upbeyond)
 * logs: rounds/*.json, collaboration-ledger.jsonl, transcript.jsonl, operating-state.json.
 * Texts are verbatim; timestamps are the original epoch ms.
 */
import type { CollaborationBotTarget, CollaborationDispatchScope } from "../types.js";

function bot(agentId: string, name: string, updatedAt: number): CollaborationBotTarget {
  return {
    agentId,
    name,
    sessionKey: `agent:${agentId}:main:space:grp-daniel-hhd-gmail-com-upbeyond`,
    updatedAt,
  };
}

export const DIGITAL_TEAM_BOTS = {
  secretary: bot("bot", "高级秘书", 6),
  analyst: bot("bot--agent", "高密度分析", 5),
  market: bot("bot-2", "市场助手", 4),
  skill: bot("bot-skill", "Skill孵化", 3),
  panda: bot("panda", "熊猫学习", 2),
} as const;

export const DIGITAL_TEAM_BOT_LIST: CollaborationBotTarget[] = Object.values(DIGITAL_TEAM_BOTS);

/** operating-state.json: no coordinator, open discussion, supplements on, maxVisible 5. */
export function createDigitalTeamScope(
  overrides: Partial<CollaborationDispatchScope> = {},
): CollaborationDispatchScope {
  const contributor = (memberId: string, label: string) => ({
    memberId,
    memberKind: "bot" as const,
    label,
    governanceRole: "member" as const,
    collaborationRole: "contributor" as const,
    status: "active" as const,
  });
  return {
    groupId: "grp-daniel-hhd-gmail-com-upbeyond",
    rawSessionKey: "space:grp-daniel-hhd-gmail-com-upbeyond",
    title: "数字人战队",
    coordinatorBotId: null,
    bots: DIGITAL_TEAM_BOT_LIST,
    operatingState: {
      groupId: "grp-daniel-hhd-gmail-com-upbeyond",
      groupProfile: {
        displayName: "数字人战队",
        purpose: "战略研究和咨询",
        currentMission: "完成成员介绍并建立协作上下文",
        collaborationMode: "discussion_driven",
        expectedOutputs: [],
        successCriteria: [],
      },
      governance: { adminUserIds: [], coordinatorBotId: null },
      collaborationPolicy: {
        humanStartsNewRound: true,
        mentionBotMustRespond: true,
        mentionHumanNotifiesOnly: true,
        openDiscussionWithoutMention: true,
        allowSupplementAfterPrimary: true,
        maxVisibleBotRepliesPerRound: 5,
        replyLanguage: "zh",
        botMaySelfAdvanceWithoutHuman: false,
        entersWaitingForHumanAfterVisibleTurnsExhausted: true,
      },
      memberRoleMap: [
        contributor("bot", "高级秘书"),
        contributor("bot--agent", "高密度分析"),
        contributor("bot-2", "市场助手"),
        contributor("bot-skill", "Skill孵化"),
        contributor("panda", "熊猫学习"),
      ],
      activeContext: {
        currentOperatingPhase: "explore",
        currentMission: "完成成员介绍并建立协作上下文",
        waitingForHuman: false,
        summary: "使命：完成成员介绍并建立协作上下文；阶段：explore",
        updatedAtMs: 1789004277463,
      },
      onboardingStatus: { initialized: true },
      groupMemoryRefs: { latestCapsuleIds: [] },
      updatedAtMs: 1791106199056,
    },
    ...overrides,
  } as CollaborationDispatchScope;
}

/**
 * P0-1: visible primary tool/execution replies that PR #98's structural check
 * classified as placeholder → PRIMARY_TIMEOUT → FALLBACK → ROUND_ABORTED(fatal).
 */
export const EXECUTION_RESULT_ROUNDS = [
  {
    roundId: "exec-group-a-1790934960",
    userMessage:
      "请只执行这条命令并把完整 stdout/stderr/退出码原样返回，不要改写命令：`ls /tmp 2>/dev/null; echo EXIT:$?`",
    responseMode: "lead_plus_supplement" as const,
    primary: DIGITAL_TEAM_BOTS.market,
    supplement: DIGITAL_TEAM_BOTS.analyst,
    primaryReply:
      "命令已原样执行，退出码 0，stdout 就是上面这份 /tmp 完整列表（本机历史调试产物，未做任何改写）。需要我按用途归并整理的话说一声。",
  },
  {
    roundId: "exec-group-b-1790935014",
    userMessage:
      "请用工具完成：1) 读一下当前工作区根目录有哪些文件（前 20 个即可）；2) 再执行 `echo hello >/dev/null; echo DEVNULL_EXIT:$?`。把每次工具调用的名称、参数、结果状态完整贴回。若任何工具调用失败，原样贴错误信息。",
    responseMode: "single_owner" as const,
    primary: DIGITAL_TEAM_BOTS.panda,
    supplement: undefined,
    primaryReply:
      "两次调用都成功，结果如下。\n\n调用1 exec，参数 command=`ls -1 | head -20`：工作区根目录前 20 项为 AGENTS.md、BOOTSTRAP.md、HEARTBEAT.md、IDENTITY.md、SOUL.md、TOOLS.md、USER.md、agents、competitor-price、gen_resume.py、memory、skills、unplaced；（共 13 项，未满 20）。\n调用2 exec，参数 command=`echo hello >/dev/null; echo DEVNULL_EXIT:$?`：输出 `DEVNULL_EXIT:0`，成功。无失败调用，无需贴错误信息。",
  },
  {
    roundId: "exec-003-reaccept-1790939041",
    userMessage:
      "EXEC-003 请只执行这条命令并把完整 stdout/stderr/退出码原样返回，不要改写命令：`ls /tmp 2>/dev/null; echo EXIT:$?`",
    responseMode: "lead_plus_supplement" as const,
    primary: DIGITAL_TEAM_BOTS.secretary,
    supplement: DIGITAL_TEAM_BOTS.skill,
    primaryReply:
      "`ls /tmp` 执行成功，退出码 0。\n\nstdout 为 /tmp 下完整条目列表（大量 OpenBot 构建日志、PR 补丁、replay 记录、emulator 日志等，条目众多，此处不逐一全文粘贴）；stderr 为空（`2>/dev/null` 已抑制）；命令末尾 `echo EXIT:$?` 输出 `EXIT:0`，说明 `ls` 本身成功。需要我把完整 stdout 逐行原样贴出、或只列前 20 项的话说一声。",
  },
  {
    roundId: "idem-retest-286-1790941067",
    userMessage:
      "LIVE-RETEST-286-1790941067-PWD 请只执行这条命令并原样返回完整输出（含退出码）：`pwd; echo EXIT:$?`。不要改写命令，不要只口头描述。",
    responseMode: "lead_plus_supplement" as const,
    primary: DIGITAL_TEAM_BOTS.skill,
    supplement: DIGITAL_TEAM_BOTS.market,
    primaryReply:
      "已按原命令执行，完整输出如下：\n\n```\n/Users/daniel/.openbot/collaboration/groups/grp-daniel-hhd-gmail-com-upbeyond\nEXIT:0\n```\n\n工作目录是本协作群组空间，退出码 0，命令未做任何改写。",
    /** The near-identical second post produced by the fallback re-run. */
    duplicateFallbackReply:
      "前序已执行同类命令，我这边按原命令跑完的结果是：工作目录 `/Users/daniel/.openbot/collaboration/groups/grp-daniel-hhd-gmail-com-upbeyond`，退出码 0，命令未改写。",
  },
];

/** P0-2: round 3cc87151 (2026-09-20 21:20 CST) — @熊猫学习 asked to organize peers. */
export const ORCHESTRATION_ROUND = {
  roundId: "3cc87151-fd7a-4b06-8c68-b84ee646b765",
  userMessage:
    "@熊猫学习 我需要你完成一下关于AI办公软件的市场调研，你需要组织高密度分析和市场助手两个数字人来帮你完成任务，你进行整体的工作计划和部署，并将任务分别分配给市场助手和高密度分析。然后等他们完成相关工作后，你进行汇总并把任务成果交付给我。",
  userAtMs: 1789910404177,
  /** What panda actually posted after organization_tasks / sessions_send were refused. */
  deadEndReply:
    "CEO，编排已经就位，但遇到一层平台限制，需要你点头才能继续。\n\n现状：我按你的要求把任务拆成两份——市场助手负责「市场规模/竞争格局/定价/采购要素」，高密度分析负责「能力矩阵/集成方式/私有化与合规/选型评分表」，我负责收口汇总。但两条派发通路都被平台策略挡住了：组织任务指派仅限「协调者」角色可创建（我是 contributor），而 Agent 之间直接发消息也被关闭（tools.agentToAgent.enabled=false）。\n\n两个可选路径：\n1. 你把「熊猫学习」设为本组织协调者，或开启 Agent 间消息——之后我可以一键把任务派下去、并行推进、收齐后汇总交付；\n2. 你直接在群里 @高密度分析 和 @市场助手 各发一句子任务（我已备好任务书原文，可复制），他们的产出回到群里，我立刻接手汇总成完整报告。\n\n你定路径，我马上执行；如果走路径 2，我这就把两份任务书贴出来。",
  deadEndReplyAtMs: 1789910416327,
  /** The same plan expressed through the round-scoped edge path (uses display names). */
  edgeReply:
    "收到 CEO。我来做整体编排：市场助手负责市场规模与竞品格局，高密度分析负责技术能力矩阵与选型论证，我负责收口成一份可交付的调研报告。\n建议下一步：两位交付后我在群里汇总。\n[[collab_edge:handoff|to=市场助手|reason=AI办公软件市场规模与竞品格局|remaining=市场规模/竞争格局/定价/采购要素|acceptance=给出数据来源]]\n[[collab_edge:handoff|to=bot--agent|reason=AI办公软件能力矩阵与选型论证|remaining=能力矩阵/集成方式/私有化与合规/选型评分表|acceptance=给出评分表]]",
};

/** P1-2: round 6f230125 (2026-09-20 21:23 CST) — correction to panda's previous answer. */
export const FOLLOW_UP_ROUND = {
  roundId: "6f230125-a0bd-4d79-a5e2-4381509fc524",
  userMessage: "我并没有将任务派发给大白管家，大白管家也不在这个群里",
  userAtMs: 1789910583348,
  recentGroupMessages: [
    {
      role: "user",
      content: [{ type: "text", text: ORCHESTRATION_ROUND.userMessage }],
      timestamp: ORCHESTRATION_ROUND.userAtMs,
      senderLabel: "CEO",
      collaborationRoundId: ORCHESTRATION_ROUND.roundId,
    },
    {
      role: "assistant",
      content: [{ type: "text", text: ORCHESTRATION_ROUND.deadEndReply }],
      timestamp: ORCHESTRATION_ROUND.deadEndReplyAtMs,
      senderLabel: "熊猫学习",
      agentId: "panda",
      collaborationRoundId: ORCHESTRATION_ROUND.roundId,
    },
  ],
};

/** P1-1: round 37c318ed (2026-09-16 02:49 CST) — 「@所有人 其他人呢」 after 「大家好」. */
export const BROADCAST_ROUND = {
  roundId: "37c318ed-8288-483a-9da3-b60eba1fef45",
  userMessage: "@所有人 其他人呢",
  userAtMs: 1789498177842,
  primaryReply:
    "老大，高级秘书在。这个点还醒着，是准备夜里接着推进，还是有明确的事要派下来？你直接把目标丢过来，我来拆成步骤和分工，盯到落地。",
};
