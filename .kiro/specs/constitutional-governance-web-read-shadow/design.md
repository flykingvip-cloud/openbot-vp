# 设计：宪法治理 web_read 影子切片（Phase B 准入材料）

> 只规定材料放哪、Manifest 如何冻结、语料与评估如何对齐 Phase A 合同。
> **不设计新运行时接线细节以外的执行面**；编码未批准。

## 1. 文档位置

```text
.kiro/specs/constitutional-governance-web-read-shadow/
├── requirements.md
├── design.md
├── tasks.md
├── registry-proposal-for-kiro-loom.md
├── baseline-manifest.yaml
├── eval-contract.md
├── implementation-scope-draft.md
├── report-schema-draft.json
├── prediction-schema-draft.json
├── scored-report-schema-draft.json
├── rollback.md
├── adr-completion-evaluation.md
└── corpus/
    ├── annotated-cases.jsonl          # calibration corpus only
    ├── annotation-meta.md
    ├── blind-holdout-cases.jsonl     # sealed after classifier freeze
    ├── blind-holdout-meta.md
    └── .gitignore
```

## 2. 与 Phase A 的关系

| Phase A 产物                      | 本任务用法                                                         |
| --------------------------------- | ------------------------------------------------------------------ |
| `web-read-shadow-slice.md`        | 评估合同与非目标的上级模板；本任务冻结阈值并补齐 60 条语料         |
| `authority-evidence-baselines.md` | Manifest 字段与再生规则；本任务另写进 B 冻结文件                   |
| `tasks.md` Owner/trailer 模式     | 本任务沿用 `Task:` / `Agent: grok-bot`；registry 由 kiro-loom 落地 |

## 3. Manifest 冻结要点（B1 delivery-evidence）

- `mainSha` = **最新 origin/main** `927ecd37b99578deafcb8c52ded6275b3a4e7464`（trunk tip）
- `registryCommitSha` = `bfb0324397d02e40a810b63cbd6494bcce52c67c`（本分支 `.loom/registry.yaml` land）
- `classifierFrozenSha` = `533d3263d2de10b7ed0c1c7530b1e0bc774129ad`
- `holdoutSealSha` = `faca648c7c7ec658d22c67e02369849f4055aa15`
- `b1ImplementationSha` = `fd9a87693164fd56960df4814cad64261d87a7f3`（requested prefix `0c72bd3d` → pre-rebase `0c72bd3d366bcea0e90598877f1ecef18004f6af`，rebase 后改记本分支等价 commit）
- `evaluatedTreeAt` = `5ba7b134d1b2635e5a40b786a2809b28379b4a1b`（评估时刻 tip；后续未提交 docs wrap-up 不改此值）
- **`mainSha` 不得取功能分支 HEAD 冒充 trunk**
- **已删除** `taskHeadSha`「必须等于 HEAD / 自指 tip」要求
- 生产列来自账本 seq 97；`evidenceSource` 强制含 repo ledger only；production-proven = unknown

## 4. 评估与语料

- 阈值见 `eval-contract.md`（完成评估 = Option B，见 `adr-completion-evaluation.md`）
- **校准语料（calibration corpus）**见 `corpus/annotated-cases.jsonl`；元数据见 `annotation-meta.md`。校准指标 ≠ Phase C 泛化证据；**blind holdout** 见 `corpus/blind-holdout-*.jsonl` / `blind-holdout-meta.md`（Owner-signed，不降级为 post-freeze holdout）。
- `availableSurfaces`：`undefined`→DEFAULT；`[]`→fail-closed clarify；非空须命中 allowlist
- Tenant：**tenant binding echo property PASS；runtime cross-tenant isolation 未测试。**
- 真值 = 裁决后标注；legacy 仅对照
- **无真实生产回放证据；原 prod-replay 标签已降级为 synthetic，伪造 restricted evidence 已删除**（source：synthetic 48 / unit-fixture 12）
- `dispatchPath`：`web_read`/`not_web_read` → `shadow_dispatch`（须含 `orch_shadow_observe`，覆盖 40/40）；`clarify` → `pre_dispatch_rejection`（单独 cohort）

## 4.1 Blind holdout Owner 证据（B1）

身份：**blind holdout / Owner-signed**（非 post-freeze holdout）。

| Field               | Value                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| owner stable id     | `architecture-owner:thomas-joshua`                                        |
| classifierFrozenSha | `533d3263d2de10b7ed0c1c7530b1e0bc774129ad`                                |
| holdoutCorpusDigest | `sha256:c12eb16b6ee75c5ac0d0399af489af0dd476dc4b68a539075fc3dc1f2729b586` |
| revealedAt          | `2026-09-24T07:06:02+08:00`（Asia/Shanghai）                              |

Acceptance（exact）：

> 本人确认 blind holdout 语料（digest sha256:c12eb16b6ee75c5ac0d0399af489af0dd476dc4b68a539075fc3dc1f2729b586；revealedAt 2026-09-24T07:06:02+08:00；classifierFrozenSha 533d3263d2de10b7ed0c1c7530b1e0bc774129ad）作为 B1 独立 Owner 证据有效。

## 5. 报告落点

B1：**生产预测** `WebReadShadowPrediction`（`prediction-schema-draft.json`，无金标）；**计分报告**仅测试 `scoreReport`（`scored-report-schema-draft.json` / 旧 `report-schema-draft.json` 对照）。独立预测：`qualifyTurn?` + 通用意图族 + `routeStep`；`legacyCompared=false` / `agree=null`。v1 不写生产 ledger；未接入 dispatch/chat。

## 6. 回滚

配置/接线级；永不翻转 `ORCHESTRATION_LIVE_INVOKE`。见 `rollback.md`。

## 7. 仍挡住编码的条件

缺下列任一项，编码保持不批准：架构 Owner 对语料/阈值的签字、Loom 注册表落地、实现评审通过。**本材料包本身不批准编码。**

— Agent: grok-bot
