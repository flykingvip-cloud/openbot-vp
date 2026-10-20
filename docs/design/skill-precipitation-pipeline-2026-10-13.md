# 技能沉淀管道增强（Skill Precipitation）

> **状态：设计 + 实现** | 日期：2026-10-13 | 对照：`employee-skill-lifecycle-channel-2026-10-10.md`、`.kiro/specs/skill-lifecycle-asset-system/requirements.md`

## 1. 管道位置

在既有「缺口 / 模式 / 学习策展 → draft」路径上增加统一决策入口 **skill-precipitation**：

```
任务轨迹摘要
  → detectPrecipitationCandidate（候选契约）
  → extractSkillDraftFromCandidate（双层 profile + runtime）
  → dedupe（whenToUse + tool-chain signature）
  → saveSkillAsset(lifecycle=draft, autoInstallEnabled=false)
  → 员工弱显性提示：「检测到可复用的能力，是否整理保存？」
```

模块：`src/gateway/skill-precipitation/`。  
消费端接线：`capability-gap-consumer.actSkill` — 有足够轨迹时写入可复用配方 runtime；不足时仍写 draft，但 `routingHints.precipitation.completeness=partial`。

不新建第二 Ledger，不平行 lifecycle 状态机；写权威仍是 `skill-lifecycle-store.saveSkillAsset`。

## 2. 与缺口 / 模式 / 策展的关系

| 来源 | 沉淀角色 |
| --- | --- |
| capability-gap consumer | `actSkill` 优先走 precipitation；缺轨迹则 partial stub（向后兼容） |
| pattern-detection | 仍走既有 approve → publishPatternCandidateAsDraftSkill；签名去重避免与 precipitation 平行复制同 whenToUse |
| learning-skill-curation | 仍产出 draft；后续可复用 extract（本 PR 不强制改策展写盘） |

## 3. 候选契约（`SkillPrecipitationCandidate`）

必填精神：`whenToUse`、`sourceEvidenceRefs[]`、`confidence`；配方字段：`redLines[]`、`steps[]`、`acceptance[]`、`failureModes[]`、`ephemeralParams[]`、`toolChain[]`、`completeness`。

抽取规则：

- **留下**：何时启用、红线、步骤顺序、验收、失败模式
- **扔掉或参数化**：tip/SHA、当次 evidence 路径、ISO 时间戳等（`ephemeral.ts`）
- description/when = 路由信号；prompts/workflow = 去情境化步骤

## 4. Fail-closed 边界（本 PR 未改红线）

- **不**默认打开 `OPENBOT_SKILL_AUTO_EVOLUTION`
- **不**自动 approve / publish / install（`autoInstallEnabled=false`）
- 缺 `sourceEvidenceRefs` → skip，不落「已学会」
- 低置信 → skip
- draft 仍不进 `EXECUTABLE_LIFECYCLES` 可执行投影（保持既有约束）
- 员工文案使用术语白名单，禁止工程师黑名单术语

## 5. 非目标

- 默认自动进化 / ClawHub 自动安装 / 企业自动发布
- 新建平行状态机或统一跨域写权威
- 大改 UI 信息架构（提示复用既有 quick-save 话术常量）
- 修复全部历史文档/CLI 漂移

## 6. 测试

`src/gateway/skill-precipitation/skill-precipitation.test.ts`：

- 多步成功轨迹 → when/steps/redLines；ephemeral 剥离
- 证据 refs 必填；低置信不写资产
- draft 经 `renderSkillMarkdown` 含步骤
- 同签名第二次 `reused`，不新建第三条资产
- 默认 `OPENBOT_SKILL_AUTO_EVOLUTION` 关闭
