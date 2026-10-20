# Phase D H1 — 热路径旁一处 Runtime 门面 observe 开工令

> 开工令 id：`phase_d_hotpath_facade_observe_one_site_start_order`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-d-hotpath-facade-observe-one-site-start-order.md`。  
> 日期：**2026-10-13**（Asia/Shanghai）  
> 前置接受：`phase-d-hotpath-facade-observe-one-site-acceptance.md`  
> 有界范围：`phase-d-hotpath-facade-observe-one-site-scope.md`  
> **立即授权本 docs PR**（三件套 + 可选最小 xref）。**继而授权**引用本令的后续实现 PR（scope §2.2；一处 observe）。  
> **不授权**本 PR 改 `src/` / `packages/`。**不授权** Gate 收紧 / enforce / Fabric-on / live invoke。  
> **C10 仍不能 pass。** 合入 ≠ PASS/GO。

## 1. 授权一句话

1. **立即授权** discovery 文档三件套入库（本 PR；docs-only）。  
2. **不授权** 本 PR 改代码或默认开任何旗标。  
3. **继而授权** 引用本开工令 id 的实现 PR：在恰好一个命名热路径旁点调用既有 façade observe；默认关；报告-only；主张至多 `runtime-enabled`（observe-only）。  
4. **不授权** C10 pass、C GO、整段 D GO、Gate 收紧、enforce 默认开。

## 2. 基线

| 项 | 值 |
| --- | --- |
| Base branch | `main` |
| Baseline SHA | `41e01e82b258b52972bcf4982892e4190cc77b26`（main tip at rework; after #686 close） |
| 复用 | #60 Runtime façade observe adapters |
| Scope / 本令 | （本 PR；合入后回填 URL） |
| 实现 PR | （另开；须引用本开工令 id；**本 turn 不开**） |

## 3. 落点

### 3.1 本 PR（docs-only）

| 文件 |
| --- |
| `.kiro/specs/constitutional-governance-discovery/phase-d-hotpath-facade-observe-one-site-scope.md` |
| `.kiro/specs/constitutional-governance-discovery/phase-d-hotpath-facade-observe-one-site-acceptance.md` |
| `.kiro/specs/constitutional-governance-discovery/phase-d-hotpath-facade-observe-one-site-start-order.md` |

### 3.2 本 PR 不落点

`src/`；`packages/`；旗标默认开；Phase C 冻结包。

### 3.3 后续实现 PR

| 项 | 约束 |
| --- | --- |
| 调用点 | 正文点名**一个**路径（候选 A/B 见 scope） |
| API | `observeOrchestrationRuntimeFacade` 和/或 `observePreflightRuntimeFacade` |
| 测试 | 默认关 inert；opt-in 报告；无 allow 写回；无 deny |

## 4. 旗标

| 项 | 值 |
| --- | --- |
| 优先 | 复用 `OPENBOT_CONSTITUTIONAL_SHADOW`（调用方快照） |
| 可选独立 | `OPENBOT_CONSTITUTIONAL_HOTPATH_FACADE_OBSERVE`（默认关；实现 PR 记名） |
| 读法 | 模块不单独读 `process.env` |
| 默认 | **关** |

## 5. OUT（本令不授权）

Gate 收紧；enforce 默认开；`readyToTighten=true`；Fabric-on；live invoke 生产默认；stdio/AOR 新刀；改写 Phase C；本 PR 改 `src/`/`packages/`。

## 6. 回滚

docs：`git revert` 本合入。  
实现：unset 旗标或 revert 单一调用点。
