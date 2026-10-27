# G3-B path-convergence evidence prep

- 状态：**PREP / NOT_CLAIMED**
- 冻结状态（用户绑定）：
  ```
  evidence_status: prepared
  claim_status: unclaimed
  production_status: not_verified
  ```
- 日期：2026-10-24（Asia/Shanghai）
- 作者：grokbot-verifiable-delivery
- 验收目标（work-packages.md）：同一 action 实际执行一次，业务成本记账一次；故障无二次执行；旧机制未丢失；未知/失效决策不能执行。

## 明确声明

**不宣称 G3-B PASSED / ACCEPTED。** 本文仅为验收人可审的证据预备包映射。

## 准则 → 现有产物映射

| G3-B 准则                                          | 现有路径 / 测试                                                                                        | 覆盖度                    | 缺口                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------- | -------------------------------------------- |
| 请求开始时绑定单一 path + actionId + policyVersion | `src/task-orchestration/path-binding.ts`（`bindReadonlyPilotAction`）；`wp05/path-convergence-prep.md` | 进程内绑定；默认 `legacy` | 无跨进程/生产入口全面绑定证明                |
| 同 action 不 dual-exec                             | `path-binding.test.ts`；`readonly-invoke.test.ts`（dual-exec refuse）                                  | 单测覆盖 in-process Map   | 无多 worker / 多 gateway 实例证据            |
| Fabric 路径仍走原工具边界、不 loopback 再入        | prep 文档规则；readonly-invoke decide-only 闸                                                          | 设计+局部测               | 未对全部 HTTP/gateway 入口做反例扫描报告     |
| 默认旧机制未丢失                                   | 默认 path=`legacy`；`OPENBOT_ORCH_READONLY_PATH_PILOT` 才可 fabric                                     | 代码默认                  | 生产配置实取值 UNKNOWN                       |
| 未知/失效决策不能执行                              | fabric DENY 路径测（readonly-invoke tests）                                                            | 局部                      | 无生产策略失效演练                           |
| 业务成本记账一次                                   | —                                                                                                      | **无**                    | 未接线 billing；只读试点本不应产生业务写成本 |
| 外部写无二次执行                                   | —                                                                                                      | **依赖 WP-07**            | 写适配器未进试点                             |

## 已落地相关文件（只读试点）

- `.kiro/specs/.../wp05/path-convergence-prep.md`
- `src/task-orchestration/path-binding.ts` + `path-binding.test.ts`
- `src/task-orchestration/readonly-invoke.ts` + `readonly-invoke.test.ts`
- `src/task-orchestration/readonly-multistep-pilot.ts`（memory→web_read→acceptance；不写 ledger）

## 验收前剩余缺口（阻塞 G3-B）

1. 人审选定的只读试点入口清单与生产 flag 实取。
2. 跨入口反例：loopback 再入、客户端伪称 path、失效 policyVersion。
3. WP-07 未完成前，**禁止**把外部写适配器纳入 G3-B 范围。
4. 成本记账/观测一次执行的生产证据（若准则坚持业务成本）。

## 状态声明

- **PREP / NOT_CLAIMED** — ready for human review; **not** G3-B PASSED.
- Freeze: `evidence_status: prepared` / `claim_status: unclaimed` / `production_status: not_verified`.
