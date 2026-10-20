# Phase D §9.2 产品拆分证明清单（文档；未证明）

> 书面范围：`phase_d_product_split_proof_plan`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-d-product-split-proof-plan.md`。  
> 日期：2026-09-25  
> 对照：执行方案 §9.2；`phase-d-product-split-scaffold.md`（#62）；`docs_phase_d_claim_level.md`  
> 本页只改 discovery 文档。不新建仓库、不发版、不接线、不改 Phase C freeze / NO-GO。

## 1. 一句话

#62 脚手架只证明「边界名存在于 monorepo」。本清单把**真正拆独立产品之前必须单独证明**的三项写成可验收检查表；勾选前 §9.2 **推迟仍有效**，不得写成「产品已拆」或「§9.2 已批准」。

## 2. 与脚手架的关系

| 已有（`code-present`） | 本清单 |
| --- | --- |
| `@openbot/constitutional-{registry,conformance,runtime}` 私有 `0.0.0`，re-export contracts | 不新增包 |
| 无独立部署作业 / 无发布流水线 | 列出若要拆分时要交的证据，**不**主张证据已齐 |

## 3. 三项证明检查表（当前全部未勾选）

### 3.1 部署边界

| # | 证据 | 当前 |
| --- | --- | --- |
| D1 | 三者各自有可指认的部署单元或运行进程边界（或书面证明「必须同进程」且为何不能拆） | ☐ 未证明 |
| D2 | 产物 / 镜像 / 作业名可分开回滚，失败域不强制绑死 contracts 热路径（若仍无热路径引用，须写明） | ☐ 未证明 |
| D3 | 与 gateway / Pi 聊天热路径的部署耦合已画清（允许「禁止单独部署」的否定证明） | ☐ 未证明（证据页已入库：`phase-d-92-d3-deploy-coupling-evidence.md`；**待架构 Owner 签字后方可 ☑**；本行不勾选） |

### 3.2 所有权

| # | 证据 | 当前 |
| --- | --- | --- |
| O1 | 每个提议产品有具名 Owner（人/角色），与源账 Owner 的写权威边界书面切开 | ☐ 未证明 |
| O2 | 无「跨域单一写权威」叙事；C11 域边界仍按 Phase C / 域级清单 | ☐ 未证明 |
| O3 | 安装≠授权、回执≠证明在三包 README / 边界注中保持，且无热路径 import 把包名写成已授权 | ☐ 未证明 |

### 3.3 生命周期

| # | 证据 | 当前 |
| --- | --- | --- |
| L1 | 独立版本节奏或明确「跟随 monorepo 火车、禁止单独发版」的 ADR | ☐ 未证明 |
| L2 | 下线 / 弃用流程（谁关旗标、谁删包、谁改 workspace） | ☐ 未证明 |
| L3 | 与 BaselineManifest 的挂钩方式（符合性宣称如何引用三包） | ☐ 未证明 |

**门禁：** 上表任一项未证明 → §9.2 继续推迟。全部证明且经架构 Owner 签字后，方可另立书面范围讨论「从脚手架升格为发布边界」——**本页不授权那一步**。

### 3.4 书面范围状态（`accepted-for-d3-only`；不勾选）

`phase-d-92-product-split-written-scope.md`（书面范围 id：`phase_d_92_product_split_written_scope`）状态为 **`accepted-for-d3-only`**（接受记录：`phase-d-92-written-scope-acceptance.md`；开工令：`phase-d-92-d3-start-order.md`）。D3 证据页：`phase-d-92-d3-deploy-coupling-evidence.md`。

仍成立：

- **不**勾选上表任何 ☐（含 D3；证据 ≠ 签字勾选）；
- **不**宣称 §9.2 已批准或产品已拆；
- 签字后仍 **≠** 自动发版；升格发布边界须另立范围 + 开工令；
- D1/D2/O*/L* **未**接受、**未**开工。

## 4. 明确不做

- 不把 #62 或本清单写成独立产品已交付
- 不启动 P8b / P8c / Path / Gate 收紧 / enforce
- 不把三包 import 进 gateway chat / tool invoke / ACP / AOR / dispatch / gateway-hook
- 不改写 Phase C NO-GO；不把 Doc02「D 当前不批准」改成全局 GO

## 5. 主张等级

本页：文档事实。相关代码主张天花板仍为 `code-present`（见 `docs_phase_d_claim_level.md`）。禁止 `runtime-enabled` / `production-proven`。

## 6. 验收提示

**PASS：** 检查表存在且当前状态为未勾选 / 未证明；§9.2 推迟被重申；无「产品已拆」叙事。  
**FAIL：** 任何已勾选却无外链证据、或宣称 §9.2 已批准拆分。
