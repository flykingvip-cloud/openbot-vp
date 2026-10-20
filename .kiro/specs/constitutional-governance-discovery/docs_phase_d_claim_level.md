# Phase D 主张等级收口注（discovery；不改 freeze）

> 书面范围：`docs_phase_d_claim_level`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/docs_phase_d_claim_level.md`。  
> 日期：2026-09-25  
> 对照：Doc02 §9；已合入 #58 / #59 / #60 / #62；Phase C `decision.md` 仍为独立 NO-GO  
> 本页只改 discovery 文档。不改代码、不改旗标默认值、不改 Phase C freeze / 决策树、不升格 §9.2。

## 1. 一句话

Phase D 已落地的四刀，主张等级停在 **`code-present`（及包内可测的 shadow 报告）**；**不得**写成 `runtime-enabled` 或 `production-proven`。§9.2 正式拆产品推迟仍有效；#62 只是私有 `0.0.0` 边界脚手架。

## 2. 主张链条（A → B → C → 有界 D）

| 阶段 | 裁决 / 覆盖 | 允许主张 | 禁止主张 |
| --- | --- | --- | --- |
| A | 四件事实文档 + Manifest | 名词冻结、旁路显式化、域级权威清单、web_read 合同字段齐全 | schema/新包；runtime-enabled |
| B | B1/B2 default-off 影子 | 只读切片可离线算指标；接线存在且默认关 | 生产效果；C5/C10/C11 pass |
| C | **独立 NO-GO（未改写）** | 「仅收敛不够」未挣得 Meta-Schema 工程席位；继续既有模块收敛 | 把 NO-GO 改成 GO；预提交 D 全量 |
| D（有界） | **仅**各刀书面范围覆盖 Doc02「D 当前不批准」中的对应切片 | 见下表 | 见下表「禁止」 |

Phase C 文档中的「停止 constitutional-contracts / 四产品里程碑」仍是独立裁决原文。后续 D 刀靠**分刀书面范围**覆盖具体切片，**不**回写 C 的 Decision 字段。

## 3. 已合入四刀的主张等级

| PR | 书面范围 | 代码事实（`code-present`） | 允许标签 | 禁止标签 / 禁止叙事 |
| --- | --- | --- | --- | --- |
| #58 | `phase_d_first_knife_contracts` | `@openbot/constitutional-contracts`：schema 草稿、只读适配器、账本视图、shadow evaluator | `code-present`；shadow 报告可在显式 opt-in 下生成 | `runtime-enabled`；enforce 生产聊天；热路径已治理 |
| #59 | `phase_d_p8a_report_only` | `reportPathGap`：默认关；`gapCode=no_valid_path`；`executed=false`；合法 Path 集为空 | `code-present`；「缺口可命名」 | C5 pass；Path 已存在；热路径收紧门 |
| #60 | `phase_d_runtime_facade_shadow_only` | `runRuntimeFacadeShadow` + 编排/预检旁的 observe 适配文件；**未**从 dispatch / gateway-hook / 预检 barrel / chat / tool / ACP / AOR 热路径主决策 import | `code-present`；「门面可影子调用（须显式 opt-in）」 | 热路径已挂门面；`runtime-enabled`；第五执行故事 |
| #62 | `phase_d_product_split_scaffold` | `@openbot/constitutional-{registry,conformance,runtime}` 私有 `0.0.0`，re-export contracts 表面 | `code-present`；「边界名存在于 monorepo」 | 独立产品已拆；部署边界/所有权/生命周期已证明；可独立发版 |

## 4. §9.2 推迟（站桩，勿升格）

执行方案原文：Registry / Conformance / Runtime 拆独立产品 **推迟**，直到部署边界、所有权、生命周期被证明需要分离。

#62 与 `phase-d-product-split-scaffold.md` 已写明三项证明 **未完成**。本收口注重申：任何把脚手架说成「产品已拆」或「§9.2 已批准」的表述均为 **FAIL**。

## 5. 与 BaselineManifest 的关系

- 符合性 / 阶段成功宣称必须带当时 Manifest，并标注 `code-present` / `runtime-enabled` / `production-proven`。
- 当前 D 四刀：**仅** `code-present`。
- `production-proven`：在未探测 `openbot-gateway-rc`（或等价生产探针）前保持 `unknown`（与 FC-08 系列一致）。
- `runtime-enabled`：contracts / façade / P8a / scaffold **均未**在默认配置下进入聊天热路径主决策；不得因「包在 workspace 里」抬升。

## 6. 明确不做（本注）

- 不改 `.kiro/specs/constitutional-governance-phase-c-decision/` 下 freeze / decision / acceptance
- 不新开旗标；不改任何默认关旗标
- 不接线；不谈 P8b / P8c / Gate 收紧 / enforce
- 不把 Doc02 文首「D 当前不批准」改成全局 GO（分刀书面范围继续是唯一覆盖机制）

## 7. 验收提示（给独立验收 bot）

PASS 当且仅当：本注入库后，discovery 内对 #58–#62 的叙事与上表标签一致，且 Phase C NO-GO 原文未被改写。  
FAIL：任何 `runtime-enabled` / `production-proven` /「产品已拆」/「Phase C 已 GO」表述。

## 8. 相关 discovery 刀

- S3 稀疏 unknown 复核：`docs_phase_d_sparse_unknown.md`（书面范围 `sparse_unknown_docs`）。确认 Cron/subagent 相对预检三态与 Profile B↔入口仍为 `unknown`；不升格主张等级。

- §9.2 证明清单：`phase-d-product-split-proof-plan.md`（书面范围 `phase_d_product_split_proof_plan`）。三项未勾选。
- P8b/P8c 站桩：`phase-d-p8b-p8c-deferred.md`（书面范围 `phase_d_p8b_p8c_deferred`）。
- 有界 D 收口：`docs_phase_d_bounded_closeout.md`（书面范围 `docs_phase_d_bounded_closeout`）。
- C 侧 §8.3 产品确认（非 D 续刀）：`phase-c-83-product-confirmation.md` + `phase-c-83-convergence-scope.md`。锁定 NO-GO；主张天花板仍 `code-present`。
