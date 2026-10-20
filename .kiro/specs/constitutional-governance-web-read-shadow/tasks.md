# Tasks：宪法治理 web_read 影子切片（Phase B 准入材料）

## Authority annotation (2026-09-27)

- Historical status: 下文仍有「local commit only；不 push」「不 push / 开 PR / force-push」「等待 Codex 验收」，以及未勾选的「不 push / 不开 PR / 不翻转旗标 / 不部署；等待 Codex 验收」。这些是接线回合的操作句。
- Superseded by: `.kiro/specs/constitutional-governance-state-convergence/current-state.md`
- Current authority: B2 默认关闭的 web_read shadow 接线已由 PR #20 与 #23 合入主干。那些句子不再表示代码未合并。旗标默认仍然关闭。本收敛包的 Codex 验收是另一项外部未完成工作，不由这些历史句子自动完成或取消。

> 状态：**材料准备 + 编码准入最终整改** · 编码**未批准**
> Loom Owner 声明（本文件）；registry YAML 由 `kiro-loom` 落地（本整改授权代理 land）
> Agent: grok-bot

## Agents

- `grok-bot` · role: owner · scope: Phase B 准入材料（语料、合同、Manifest、范围草案、整改） · paths: `.kiro/specs/constitutional-governance-web-read-shadow/**` · since: 2026-09-24

任务 id（唯一）：`constitutional-governance-web-read-shadow`

注册表：`registry-proposal-for-kiro-loom.md`；落地 trailers：`Task: loom-workspace-orchestrator` / `Agent: kiro-loom`。

未来材料提交 trailer（若另开 PR；本整改**不**提交 specs）：

```text
Task: constitutional-governance-web-read-shadow
Agent: grok-bot
```

## 核对单

- [x] Loom Owner 声明（本文件）
- [x] `registry-proposal-for-kiro-loom.md`（提案；落地见整改项）
- [x] `baseline-manifest.yaml` 已按 B1 delivery-evidence 冻结（`mainSha` / `registryCommitSha` / `classifierFrozenSha` / `holdoutSealSha` / `b1ImplementationSha` / `evaluatedTreeAt`；**无** taskHeadSha tip 自指要求）
- [x] `eval-contract.md` 阈值与分母冻结（Option B + dispatchPath 一致性门）
- [x] `adr-completion-evaluation.md` Decision = Option B
- [x] `corpus/annotated-cases.jsonl` = 60 行；20/20/20 与 30/30
- [x] `expectedDecisionClass` + `expectedReasonCodes`（仅 ALL_ORCH_REASON_CODES）+ `dispatchPath`
- [x] 双标注 `annotationA`/`annotationB`/`finalLabel`；10 条分歧 A≠B 可见
- [x] 来源：synthetic 48 / unit-fixture 12；**零** prod-replay；伪造 restricted evidence **已删除**
- [x] `corpus/annotation-meta.md` 双标注 schema + 分歧表 + shadow_dispatch 覆盖 40/40
- [x] `report-schema-draft.json` required 收紧（gap / annotationCompare / shadowVsLegacy）+ enqueue/invoke/wroteLedger/invokedTool；additionalProperties:false
- [x] `implementation-scope-draft.md` / `rollback.md`
- [x] Kiro 三件套：`requirements.md` / `design.md` / `tasks.md`
- [ ] **编码批准** — 未勾选。本材料包不等于编码批准
- [x] `.loom/registry.yaml` 由 kiro-loom 代理落地（local commit only；不 push）

## 整改核对（Phase B 编码准入最终）

- [x] 发明 reasonCode 已移除；改用 expectedDecisionClass + expectedReasonCodes
- [x] 完成方案 Option B；移除 false-completion≤5% 门；改为 claim suppression=100%
- [x] 双标注结构化；分歧预裁决冲突可见
- [x] **无真实生产回放证据；原 prod-replay 标签已降级为 synthetic，伪造 restricted evidence 已删除**
- [x] `dispatchPath`：shadow_dispatch 40 均含 `orch_shadow_observe`；pre_dispatch_rejection 20 单独分母
- [x] schema 收紧 required + additionalProperties:false
- [x] BaselineManifest：`mainSha`=origin/main；`registryCommitSha` / `classifierFrozenSha` / `holdoutSealSha` / `b1ImplementationSha` / `evaluatedTreeAt` 已记录；**已删除** taskHeadSha tip 自指；mainSha 不得冒充
- [x] registry local land（Agent: kiro-loom）；specs **不** commit；**不** push / PR
- [x] 门禁：oxfmt / git diff --check / agent-attribution

### 可选覆盖计数（影子 reason-code 分母）

```bash
python3 - <<'PY'
import json
from pathlib import Path
p = Path(".kiro/specs/constitutional-governance-web-read-shadow/corpus/annotated-cases.jsonl")
rows = [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
sd = [r for r in rows if r["dispatchPath"] == "shadow_dispatch"]
obs = sum(1 for r in sd if "orch_shadow_observe" in r["expectedReasonCodes"])
pre = sum(1 for r in rows if r["dispatchPath"] == "pre_dispatch_rejection")
print(f"shadow_dispatch {len(sd)} orch_shadow_observe {obs}/{len(sd)}; pre_dispatch_rejection {pre}")
assert obs == len(sd) == 40 and pre == 20
PY
```

## 明确不做

- [x] 不改 `src/**` / `packages/**` / `ui/**` / schema / 依赖 / Feature Flags
- [x] 不 commit `.kiro/specs/**`（本整改）
- [x] 不 push / 开 PR / force-push
- [x] 不触碰 `openbot-main` 工作树
- [x] 不翻转 `ORCHESTRATION_LIVE_INVOKE`
- [x] 不调用 `web_search` / `web_fetch`；不写生产 ledger

— Agent: grok-bot

## B1 独立预测整改（编码切片；仍未接入运行时）

- [x] `evaluateWebReadShadow` 仅接受 runtime input（无 expected\*/金标）
- [x] 独立预测：通用意图族 + `qualifyTurn?` + `routeStep(shadowOrchestrationFlags)`
- [x] `scoreReport` 仅在 `.test.ts`
- [x] `prediction-schema-draft.json` + `scored-report-schema-draft.json`
- [x] `legacyCompared=false` / `agree=null`；反作弊与租户隔离测试
- [x] B2 已接入 dispatch / gateway-hook / feature 接线（默认 OFF；等待 Codex 验收）

## Baseline replay (2026-09-24)

- [x] Registry commit on branch: `bfb0324397d02e40a810b63cbd6494bcce52c67c`（rebased lineage onto origin/main `927ecd37b…`）
- [x] BaselineManifest regenerated with delivery-evidence fields; specs remain uncommitted; no runtime edits

## B1 泛化与 fail-closed（本整改）

- [x] `availableSurfaces` 语义冻结（undefined→DEFAULT；[]→fail-closed；非空 allowlist）
- [x] 意图线索收敛为三类短模式（read / write / ambiguous）；删除校准句式死记
- [x] 校准语料 redefinition：60 JSONL = calibration only；metrics 键名 `calibration*`
- [x] Metamorphic + category unit tests
- [x] Tenant 结论固定为：「tenant binding echo property PASS；runtime cross-tenant isolation 未测试。」
- [x] Blind holdout 在 classifier freeze **之后**密封（不得回写正则）
- [x] B2 已接入 dispatch / gateway-hook / feature 接线（默认 OFF；等待 Codex 验收）

## Blind holdout Owner 证据（B1）

身份：**blind holdout / Owner-signed**（不降级为 post-freeze holdout）。

- [x] owner stable id: `architecture-owner:thomas-joshua`
- [x] classifierFrozenSha: `533d3263d2de10b7ed0c1c7530b1e0bc774129ad`
- [x] holdoutCorpusDigest: `sha256:c12eb16b6ee75c5ac0d0399af489af0dd476dc4b68a539075fc3dc1f2729b586`
- [x] revealedAt: `2026-09-24T07:06:02+08:00`（Asia/Shanghai）
- [x] Acceptance（exact）: 本人确认 blind holdout 语料（digest sha256:c12eb16b6ee75c5ac0d0399af489af0dd476dc4b68a539075fc3dc1f2729b586；revealedAt 2026-09-24T07:06:02+08:00；classifierFrozenSha 533d3263d2de10b7ed0c1c7530b1e0bc774129ad）作为 B1 独立 Owner 证据有效。

## Checkpoint B2 — runtime shadow wiring（本回合）

- [x] nullable tenant（Profile A `null` / Profile B 非空；evaluator 仅 echo，不鉴权）
- [x] 子旗 `OPENBOT_CONVERSATION_TASK_WEB_READ_SHADOW`（默认 OFF；不改四旗语义）
- [x] `observeWebReadShadowFromChat` adapter + SafeWebReadShadowObservation sink
- [x] `dispatch-from-config` utterance Body\* fallback + 仅传 cfg/tenantId/messageId/utterance
- [x] 组合门控 `ORCH_SHADOW && WEB_READ_SHADOW`；子旗 OFF 不影响 legacy Gate C
- [x] 测试矩阵 19 项覆盖；B1 原 27 测仍绿；vitest/oxfmt/tsgo/attribution 绿
- [x] **B2 FINAL remediation**：删除生产全局 `lastSafeDebugObservation` / `__testing` last-observation API；无注入 sink 测试改为 no-throw + predictor 1 + 静态边界；交错 A/B 断言无 module-level last-observation API；设计文档 ownership/registry **LANDED**（`3071ffea…`）
- [ ] 不 push / 不开 PR / 不翻转旗标 / 不部署；等待 Codex 验收
