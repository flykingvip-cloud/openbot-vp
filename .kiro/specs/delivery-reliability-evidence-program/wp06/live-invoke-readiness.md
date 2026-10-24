# LIVE invoke readiness checklist

- 日期：2026-10-24（Asia/Shanghai）
- 作者：grokbot-verifiable-delivery
- 常量：`ORCHESTRATION_LIVE_INVOKE` in `src/task-orchestration/types.ts`
- **结论：KEEP LIVE = false**（本切片禁止翻转；下列用户门禁未全绿前不得人批打开）

## 用户绑定门禁（全绿前 KEEP false；其后先 canary 再谈 LIVE）

| # | 门禁 | 当前 | 备注 |
| --- | --- | --- | --- |
| A | 运行路径和 owner 已完成**正式登记**（kiro-loom Loom 流程） | **FAIL** | `.loom/registry.yaml` 未由本 PR 修改；见 `evidence/registry-kiro-loom-handoff.md` |
| B | ledger 字段位置与兼容策略**冻结** | **PASS（设计/validators）** | ExecutionStep canonical；payload 扩展-only；compat-read / write-prefer-step |
| C | WP-07：幂等键、重复请求、未知结果、旧 worker 回报测试全部通过 | **PARTIAL** | helper + `unknown_outcome` 常量/单测；**未**接线 live send；旧 worker 回报套件未全绿宣称 |
| D | G3-B：同一 logical action 不被 Fabric/legacy **双重执行**证明 | **FAIL** | evidence_status=prepared；claim_status=unclaimed；production_status=not_verified |
| E | G4-A：调度前/执行前/结果落库前/回执后崩溃恢复套件 | **FAIL** | evidence_status=prepared；claim_status=unclaimed；production_status=not_verified |
| F | 证据包绑定实际 candidate SHA、环境、配置、范围和测试输出 | **FAIL** | prep 文档仅映射；未绑定生产 candidate 包 |
| G | 当前 origin/main **重新 fetch** 后仍满足仓库基线 | **FAIL** | 本切片未宣称已 re-fetch 验收通过 |
| H | 业务负责人、试点范围和验收规则已冻结 | **FAIL** | WP-00 试点未冻结 |

## 既有技术 checklist（补充）

| # | 前置条件 | 当前 | 证据 / 备注 |
| --- | --- | --- | --- |
| 1 | WP-06 lease/fence 形状 + kill harness | PASS（夹具） | `lease-store` / `lease-kill-fixtures`；非生产权威 |
| 2 | WP-06 field-mapping ADR + ExecutionStep canonical | PASS（设计+validators） | `field-mapping-adr.md`；`execution-step-canonical-schema.md` |
| 3 | Ledger 生产权威增量（fold/store 挂 canonical/lease 字段） | **FAIL** | 仅扩展模块；fold 未迁移 |
| 4 | Readonly multi-step pilot 不写 ledger 约定仍成立 | PASS | pilot helper + ADR |
| 5 | 明确二次人批「允许翻转 LIVE」 | **FAIL** | 未授予 |

## G 门验收人规则（硬约束）

G 门验收必须由以下角色**分别确认**，**不能**由同一个实施 Agent 自证自批：

1. 代码 owner
2. 架构 / 安全评审者
3. 业务验收者

通过门禁 A–H 后：**先做非生产或受限 canary**，再讨论翻转 LIVE。

## 结论

```
ORCHESTRATION_LIVE_INVOKE 必须保持 false。
在用户门禁 A–H 全绿、技术项 #3/#5 转 PASS、且人类重新批准之前，禁止打开 LIVE。
通过后先 canary，再讨论 LIVE。G 门不可自证自批。
```

本文件 **不是** 打开 LIVE 的授权。
