# LIVE invoke readiness checklist

- 日期：2026-10-24（Asia/Shanghai）
- 作者：grokbot-verifiable-delivery
- 常量：`ORCHESTRATION_LIVE_INVOKE` in `src/task-orchestration/types.ts`
- **结论：KEEP LIVE = false**（本切片禁止翻转；下列未全绿前不得人批打开）

## Checklist

| # | 前置条件 | 当前 | 证据 / 备注 |
| --- | --- | --- | --- |
| 1 | WP-06 lease/fence 形状 + kill harness | PASS（夹具） | `lease-store` / `lease-kill-fixtures`；非生产权威 |
| 2 | WP-06 field-mapping ADR | PASS（设计） | `wp06/field-mapping-adr.md` |
| 3 | Ledger 生产权威增量（fold/store 挂 lease 字段） | **FAIL** | 仅 `orch-lease-fields.ts` 类型模块；fold 未迁移 |
| 4 | G4-A 生产 ledger 重启证据包 | **FAIL** | `evidence/g4a-recovery-evidence-prep.md` = PREP/NOT_CLAIMED |
| 5 | WP-07 外部副作用幂等 + 适配器矩阵填实 | **FAIL** | DESIGNING + template；G4-B 未宣称 |
| 6 | G3-B 路径收敛验收（若 live 路径经 Fabric） | **FAIL** | `evidence/g3b-...` = PREP/NOT_CLAIMED |
| 7 | Readonly multi-step pilot 不写 ledger 约定仍成立 | PASS | pilot helper + ADR |
| 8 | 不夺 Fabric execute / dual-exec 防护 | PASS（局部） | path-binding dual-exec refuse；生产入口未全扫 |
| 9 | 人工业务验收人 / 试点范围冻结（WP-00） | **FAIL** | 试点未冻结；WP-00 整体未 ACCEPTED |
| 10 | 明确二次人批「允许翻转 LIVE」 | **FAIL** | 未授予；本清单未绿 |

## 结论

```
ORCHESTRATION_LIVE_INVOKE 必须保持 false。
在 #3–#6、#9–#10 转 PASS 且人类重新批准之前，禁止打开 LIVE。
```

本文件 **不是** 打开 LIVE 的授权。
