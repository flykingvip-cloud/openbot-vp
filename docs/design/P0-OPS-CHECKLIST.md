# P0 运营基线操作清单（只给人确认，不动 LIVE）

> 用户已确认意向：P0.1 / P0.2 / P0.4。**本文件只写 HOW，不自动改生产 operating-state / 不开旗。**  
> 样本组：`grp-daniel-hhd-gmail-com-upbeyond`（数字人战队）  
> 日期：2026-10-15（Asia/Shanghai）

## P0.1 使命改为执行类 + 清 onboarding_mission_stale

**意向文案示例（待你最终拍板一字不差）：** `AI×能源研究与交付`

**改哪里（运行态，非使命正文塞旗标）：**

1. 组 `operating-state.json`
   - 路径解析：`resolveGroupCollaborationPaths(groupId).operatingStateFile`  
     （`src/gateway/collaboration-learning/collaboration-paths.ts` → `operating-state.json`）
   - 字段：
     - `activeContext.currentMission`
     - `groupProfile.currentMission`（若有）
2. 可选：章程快照 `governance/group-charter.json` 经 `syncGroupCharter` 对齐。
3. **勿**把 claim/wake/心跳/自推进规章写进 `currentMission`。

**如何清 stale 告警：**

- `decision-engine` 在介绍类使命时会推 `onboarding_mission_stale`（见 `isOnboardingIntroductionMission`）。
- 使命改为非「介绍/认识/协作上下文/onboarding」文案后，该 alert 不再产生。
- 代码辅助（需你另授权对 LIVE 调用才执行）：  
  `advanceCollaborationGroupMissionFromOnboarding({ groupId })`  
  （`src/gateway/collaboration-learning/mission-advance.ts`）——会写成默认工作使命  
  `COLLABORATION_WORK_MISSION_TEXT`；若要用「AI×能源研究与交付」，应直接写 operating-state 或先扩展建议文案后再调。

**验收：** operating-state 使命非介绍文案；讨论决策不再带 `onboarding_mission_stale`。

## P0.2 指定 coordinatorBotId 或明确人协调

**改哪里：** 同组 `operating-state.json` → `governance.coordinatorBotId`  
（类型：`src/gateway/collaboration-learning/operating-state-types.ts`）

**填写：**

- Bot 协调：`coordinatorBotId: "<待你填入的 bot agentId>"`
- 或明确人协调：保持 `null`，并在群约定「人做协调/验收代理」（文档共识即可）。

**验收：** `coordinatorBotId !== null` **或** 书面确认人协调。

## P0.3（本轮跳过）

执行类诉求点名责任 bot、禁止只 `@所有人` 当部署 —— 用户暂缓。

## P0.4 self_advance=false 下过夜须人回流合

**现状（勿改 LIVE 除非另授权）：**

- L1 / 新组种子 / 样本组：`botMaySelfAdvanceWithoutHuman=false`
- 生产路径几乎无 `self_advance` 调用方

**共识（已接受）：** 在未进入 P4 开有限自推进前，过夜目标跨小时推进 **必须人回流合**（再开讨论/确认回合或灰开后续阶段）。  
P1 只把目标挂上共享看板；不自动过夜推进。

## 与 P1 的边界

- P0 = 运营基线（使命/协调者/过夜预期）——本清单。
- P1 = 代码：灰组 claim allowlist + 意图物化 + 进度只读 —— 另见 `collab-p1-shared-board-fact-2026-10-15.md`。
- **未获聊天授权不开 LIVE 旗 / 不改生产配置。**
