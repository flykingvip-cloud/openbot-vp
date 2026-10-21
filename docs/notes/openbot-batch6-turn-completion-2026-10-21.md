# 批次 6：回合完成合同

| 项   | 值                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 日期 | 2026-10-21                                                                                                                                        |
| 仓库 | `flykingvip-cloud/openbot-vp`                                                                                                                     |
| 祖先 | 实现前 `git fetch origin main`，分支自 `origin/main` `10cbe9e625366ba18ae91371337739eb460dcb07`（批次 5，PR #27）                                 |
| 性质 | 全 bot 对话回合合同。不是某个机器人的 prompt 修改。                                                                                               |
| 不做 | 不扩大 `submitForReview` / `self_advance` / accept / finalize。不开生产旗、不扩群白名单。批次 7 双账本、批次 8 完整术语表与 cron 空成功不在本批。 |

`readable` 仍只表示服务端可读。本批 `delivered` 表示回合合同上有可打开路径，不等于业务 accepted。

## 合同

回合在合同生效时必须落到三态之一（`TurnCompletionContract`）：

| 状态              | 含义                                                                  |
| ----------------- | --------------------------------------------------------------------- |
| `delivered`       | 可打开路径（降级稿也算）                                              |
| `permanent_block` | 一条：`reason` + 已尝试的 `degradation` + 唯一 `required_user_action` |
| `true_fork`       | 至少两个互斥选项（规格 / 价 / 支付）。只允许停一次                    |

阻塞分级：

| 级别   | 行为                                                                                   |
| ------ | -------------------------------------------------------------------------------------- |
| 主线   | 成果正文写不出来，且降级文件也写失败 → `permanent_block`                               |
| 旁路   | `task_ledger`、非交付文件 chmod、清表。写失败只加一行 `side_path_bypass`，不挡主线文件 |
| 已解除 | 用户声明 Node 20 / Playwright 且本回合探针通过 → 不得用同一理由再停                    |

有效可写性：工具结果若出现 `ls` 模式，归一化后必须带 `path`、`lsMode`、`writeAttempt` 或 `sandboxPolicyCode`。仅叙述 `-r----------` 时 `hardStop=false`。

静默执行窗：用户说「继续 / 继续尝试 / 我只要结果」（及「只要结果 / 别再问」）。窗内禁止开放式追问。技能 sha256「绑定」被说成微信 / 邮箱 / 知识源时不得停问。这里只留了术语桩，完整术语表是批次 8。

进度散文：没有路径、也没有永久阻塞一条、且正文主要是「下一步我会」一类并超过 180 字时，不得作为终稿。

技能试跑壁钟默认 15 分钟（`OPENBOT_SKILL_SMOKE_SLA_MS`，正数毫秒；缺省或非法值回到 15 分钟）。超时强制降级文件或一条 `permanent_block`，不再换一套问法。这是时限，不是生产开旗。

## 接入（沿用现有终稿，不另起闸门）

| 位置                                                         | 作用                                             |
| ------------------------------------------------------------ | ------------------------------------------------ |
| `src/agents/turn-completion/contract.ts`                     | 合同、探针、降级落盘、SLA                        |
| `src/agents/pi-embedded-runner/run/rewrite-visible-reply.ts` | 渠道可见终稿最后一道                             |
| `src/agents/execution-stall-continue.ts`                     | 静默窗内开放式停问最多再跑一轮                   |
| `src/agents/pi-tool-definition-adapter.ts`                   | 工具结果补可写性探针                             |
| `src/gateway/server-chat.ts`                                 | Control UI `chat.final` 在批次 1 settle 之前塑形 |
| `src/gateway/server-methods/chat.ts`                         | 群回合终稿与 1:1 未启动代理的回退终稿            |
| `src/auto-reply/reply/session-continuity.ts`                 | 恢复注入带同一句合同，避免恢复后换挡停问         |
| `src/auto-reply/reply/agent-runner-execution.ts`             | 把用户句、工作区和试跑起点放进 run context       |

降级文件是文本 `deliverables/turn-completion-degraded.md`。不发明 PDF / PPTX 字节（与批次 1 一致）。

## 怎么跑测试

```bash
pnpm exec vitest run \
  src/agents/turn-completion/contract.test.ts \
  src/agents/execution-stall-continue.test.ts \
  src/auto-reply/reply/session-continuity.test.ts
```

四场景在 `src/agents/turn-completion/contract.test.ts`：

1. 「继续」且 Node / Playwright 探针已通过 → 同次结算写出可打开文件，不再问微信 / 邮箱。
2. 模拟 `task_ledger` 写失败 → `deliverables/smoke.md` 仍写入，回执含 `side_path_bypass`。
3. 两种规格 → `true_fork` 停一次；sha256「绑定」误读成微信 / 邮箱 → 不得作为分叉停问。
4. 技能试跑壁钟到点（默认 15 分钟，测试里也覆盖 `OPENBOT_SKILL_SMOKE_SLA_MS`）→ 降级文件或一条 `permanent_block`，原文里的换挡问法不保留。

硬停止：无产物的「已交付 / 任务成功」不会原样留下；旁路拒绝出稿时主线文件仍在。
