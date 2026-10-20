# ConversationTask Runtime — P2 回滚演练(rollback drill)

> Owner(实施): `kiro-conversation-task-runtime` · Task: `conversation-task-runtime`
> 关联: `./p2-production-rollout.md`、`./p2-ops-runbook.md`、`./control-plane.ts`(实现)
> 状态: **演练证据。仅在临时目录内对控制面/降级控制器/Activation Gate 做真实运行;未打开任何生产 flag、未部署、未 cutover。**

## 1. 目的

在开启灰度前证明:自动 force-off、重启保持、多实例共享、重开门禁(人工确认+服务端冷却+RCA+actor 记录)、控制面丢失 fail-safe-off、时间不可伪造,均在**真实运行**中成立。回滚不依赖重新部署——控制面 force-off 后全实例即时 `shadow_frozen`。

## 2. 演练方法

- 使用真实实现:`SqliteActivationControlPlane`(每步持久到临时目录的 `control-plane.db`,WAL)、`ActivationDegradeController`、`runActivationGate`。
- 服务端时钟由注入 `now` 控制(生产冷却 `minReopenIntervalMs = 600000` = 10 分钟);**调用方无时间通道**。
- 演练脚本为一次性临时文件,运行后删除(不提交);下方为真实 stdout 与可审计 receipt。演练也由单测常态覆盖(`control-plane.test.ts` / `degrade.test.ts` / `activation.test.ts` / `store-crossproc.test.ts`)。

## 3. 演练步骤与真实输出(2026-08-24)

| #   | 步骤                                                      | 期望                                               | 结果                                                                                                              |
| --- | --------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | 空卷首次启动                                              | 强制 OFF(uninitialized)                            | `forcedOff=true, reason=uninitialized_or_recovered`                                                               |
| 2   | 受控启用(服务端时钟越过冷却 + 确认 + actor)               | reopened,OFF 解除                                  | `reopened=true, forcedOff=false`                                                                                  |
| 3   | 指标越阈(precision<95% + reminder 误升级)→ 自动 force-off | degraded + rcaPending                              | `degradedNow=true, state=degraded, forcedOff=true, rcaPending=true, stateVersion=3`                               |
| 4   | 重启服务(重开同一 DB)                                     | 仍 OFF                                             | `forcedOff=true`                                                                                                  |
| 5   | 启动第二实例(同一 DB)                                     | 共享 forced-off                                    | `forcedOff=true`                                                                                                  |
| 6   | 未确认 / 冷却未到 / RCA 未完 拒绝重开                     | 三种拒绝 reason                                    | `manual_confirm_required` / `cooldown_active` / `reminder_rca_required`                                           |
| 7   | 受控重开(确认+冷却已过+RCA 解决+actor)                    | reopened,记录 actor/time/version;第二实例见 active | `reopened=true, lastReopenActor=op-oncall, lastReopenAtMs=1200002, stateVersion=4, secondInstanceSeesActive=true` |
| 8   | 控制面文件丢失(删除 DB)→ 新实例 + Gate                    | 强制 OFF,Gate `shadow_frozen`,零任务               | `forcedOffAfterLoss=true, gateMode=shadow_frozen, activeTasks=0`                                                  |
| 9   | 时间伪造                                                  | 无 `nowMs` 字段,服务端冷却仍拒                     | `hasNowMsField=false, reopenReason=cooldown_active`                                                               |

真实 stdout(逐行 JSON):

```json
{"step":"1_first_start_off","forcedOff":true,"reason":"uninitialized_or_recovered"}
{"step":"2_controlled_enable","reopened":true,"forcedOff":false}
{"step":"3_metric_breach_forceoff","degradedNow":true,"state":"degraded","forcedOff":true,"reason":"upgrade_precision_below_min,over_upgrade_above_degrade","rcaPending":true,"stateVersion":3}
{"step":"4_restart_still_off","forcedOff":true,"reason":"upgrade_precision_below_min,over_upgrade_above_degrade"}
{"step":"5_second_instance_shared","forcedOff":true}
{"step":"6_reopen_blocked","noConfirm":"manual_confirm_required","coolingDown":"cooldown_active","rcaBlocked":"reminder_rca_required"}
{"step":"7_controlled_reopen","reopened":true,"lastReopenActor":"op-oncall","lastReopenAtMs":1200002,"stateVersion":4,"secondInstanceSeesActive":true}
{"step":"8_control_plane_loss","forcedOffAfterLoss":true,"gateMode":"shadow_frozen","activeTasks":0}
{"step":"9_time_forgery_no_channel","hasNowMsField":false,"reopenReason":"cooldown_active"}
```

## 4. 可审计 receipt

- 对上述 9 条日志的规范 JSON 取 SHA-256:

```
sha256 = 35b0a85bde6014c16b8d0ca141b816b150a7224bce6a44aecc368260d0eb37a9
entries = 9
```

- receipt 仅覆盖脱敏的演练事件(step 名 + 布尔/reason/版本/actor 标识),**不含任何原始用户文本、实体或密钥**。
- 常态回归:`OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/conversation-task`(197 通过)以单测形式持续验证上述行为;演练脚本仅用于生成本 receipt,运行后删除。

## 5. 结论

- 自动 force-off、重启保持、多实例共享、重开门禁、控制面丢失 fail-safe-off、时间不可伪造——**全部在真实运行中成立**。
- 回滚 = 控制面 force-off(自动或受控),全实例即时 `shadow_frozen`,**不依赖重新部署**。
- 本演练未打开任何生产 flag、未部署、未 cutover。四态:`P2 implementation = ACCEPTED` · `main landing = ACCEPTED` (PR #680, `4ef2a43534`) · `production integration = NOT IMPLEMENTED` · `production rollout = NOT APPROVED`。
