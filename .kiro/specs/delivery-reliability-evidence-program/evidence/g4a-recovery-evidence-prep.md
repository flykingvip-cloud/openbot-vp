# G4-A recovery evidence prep

- 状态：**PREP / NOT_CLAIMED**
- 冻结状态（用户绑定）：
  ```
  evidence_status: prepared
  claim_status: unclaimed
  production_status: not_verified
  ```
- 日期：2026-10-24（Asia/Shanghai）
- 作者：grokbot-verifiable-delivery
- 验收目标（work-packages.md）：进程在调度前后、执行前后、结果落库前后被终止均可恢复；无遗失/永久悬挂步骤；旧 worker 不得重复推进。

## 明确声明

**不宣称 G4-A PASSED / ACCEPTED。** harness/pilot ≠ 生产 ledger 证据包。

## 准则 → 现有产物映射

| G4-A 准则                        | 现有路径 / 测试                                                           | 覆盖度                  | 缺口                                                               |
| -------------------------------- | ------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------ |
| kill before/after schedule       | `ORCH_KILL_FIXTURE_IDS` + `lease-kill-fixtures.ts` / `.test.ts`           | 文件背 lease-store 夹具 | 未挂生产 Progress Ledger 持久面                                    |
| kill before/after exec           | 同上                                                                      | 夹具                    | 无真实工具执行杀进程证据                                           |
| kill before/after result persist | `lease-kill-fixtures` after-result-persist + projections idempotent write | 夹具 rootDir JSON       | projections ≠ ledger fold                                          |
| 旧 worker / stale fence 不得推进 | `lease-store.ts` `stale_fencing_token`                                    | 单测                    | 生产 writer 尚未消费 fence 字段                                    |
| 无永久悬挂步骤                   | cancelRequested / expiry reacquire 行为                                   | 夹具                    | 无生产悬挂扫描/告警证据                                            |
| 跨重启权威                       | ADR：权威应在 ledger/task 增量                                            | **设计**                | `orch-lease-fields.ts` 仅类型；fold 未迁移                         |
| LIVE 调度恢复                    | —                                                                         | **FAIL 预期**           | `ORCHESTRATION_LIVE_INVOKE === false`；不得靠打开 LIVE「证明」恢复 |

## 已落地相关文件

- `wp06/orchestration-persistence-lease-design.md`
- `wp06/field-mapping-adr.md`
- `wp06/readonly-multistep-pilot.md`
- `wp06/ledger-field-increment.md` + `src/progress-ledger/orch-lease-fields.ts`
- `src/task-orchestration/lease-store.ts` + tests
- `src/task-orchestration/lease-kill-fixtures.ts` + tests
- `src/task-orchestration/readonly-multistep-pilot.ts`（不写 ledger）

## 真实 G4-A 剩余缺口（阻塞）

1. **生产 ledger 权威**：把 provisional 字段挂上 `ExecutionStep`/`ExecutionEvent` fold + 持久 store，并有重启后再 fold 的证据。
2. **Kill 夹具对生产面**：同一套 fixture ID 对 ledger/task 权威重跑，而非仅 lease-store `rootDir`。
3. **WP-07**：外部副作用在 lease 过期/回执丢失下的不重复业务效果（G4-A 与 G4-B 交界）。
4. **LIVE readiness**：见 `wp06/live-invoke-readiness.md` — 当前结论 KEEP LIVE=false；打开 LIVE 另需人批。
5. 观测：无遗失/悬挂步骤的生产查询与告警。

## 状态声明

- **PREP / NOT_CLAIMED** — evidence prep for acceptance review; **not** G4-A PASSED.
- Freeze: `evidence_status: prepared` / `claim_status: unclaimed` / `production_status: not_verified`.
