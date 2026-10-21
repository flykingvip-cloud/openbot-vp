# 批次 8：技能闸门与术语消歧

| 项   | 值                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------- |
| 日期 | 2026-10-21                                                                                                             |
| 仓库 | `flykingvip-cloud/openbot-vp`                                                                                          |
| 祖先 | 实现前 `git fetch origin main`。分支自 `origin/main` `852735b0ef8d873c1c0c679f7802b33f6054e4b0`（批次 7，PR #30）      |
| 性质 | 全 bot 平台机制。不是某个机器人的人设 prompt。                                                                         |
| 不做 | 不扩大 `submitForReview` / `self_advance` / accept / finalize。不开生产旗、不扩白名单。不把试跑降级写成业务 accepted。 |

`readable` 仍只表示服务端可读。本批 `trial="1"` 和 `grade` 只标注试跑可见稿，不等于任务 accepted。

## 合同

### 1. 活动技能术语

回合绑了技能，或正文是 deliverables/smoke 试跑时，注入一段短消歧。机制在执行预检的 `bindingPrompt` 里，所有走同一预检的 bot 共用。恢复注入在连续性提示里再带一次。

平台表至少包括 `consulting-report-forge`：`绑定` = analysis-review 与 task.json 的 sha256 对照，不是微信、邮箱、知识源或 OAuth。

技能可以在 frontmatter 用 `terminology` 覆盖或追加自己的词。格式：`词=含义|不是甲/不是乙`，多条用 `;` 分开。没有这份字段的技能继续用平台表。

静默执行窗里，把「绑定」问成微信/邮箱/知识源不算真分叉，终稿不得停在这句上。

### 2. 试跑闸门

「预览可以、正式交付不可」只在试跑/smoke 里旁路：

| 情况               | 结果                                                      | 声明                                   |
| ------------------ | --------------------------------------------------------- | -------------------------------------- |
| 预览文件已在工作区 | 升级为可打开路径，`grade=preview_promoted`                | `settle=confirmed` `trial=1`           |
| 没有可打开预览     | 写成 `deliverables/trial-degraded.html`，写失败再写 `.md` | `grade=degraded_html` 或 `degraded_md` |
| 工作区不可写       | 一条 `permanent_block`                                    | 不声称 confirmed                       |

不伪造 PPTX 压缩包。已经存在的 `.pptx` 预览按预览升级。正式模式不走这条旁路。

### 3. Cron 完成

无摘要且无产物不得记成功，也不得在卡片上写 ✅。

| 情况                                    | `completion`      | 调度状态                                     |
| --------------------------------------- | ----------------- | -------------------------------------------- |
| 有摘要或有产物                          | `ok`              | `ok`                                         |
| 完全空（市场助手「系统skill应用分析」） | `empty`           | `error`，错误以 `cron_completion:empty` 开头 |
| 只有「已完成但没有摘要」这类空声称      | `needs_attention` | 同上，前缀 `cron_completion:needs_attention` |
| 运行报错且没有摘要                      | `failed`          | `error`                                      |

`empty` / `needs_attention` 不增加连续失败、不按传输错误退避、不发失败告警。它们仍然不是 `ok`。卡片状态行就是 `empty` / `needs_attention` / `failed`，并带一行原因。

### 4. Smoke SLA

与批次 6 相同：默认 15 分钟（`OPENBOT_SKILL_SMOKE_SLA_MS`）。超时写成可打开降级稿，写不了就一条 `permanent_block`（`reason=skill_smoke_sla`）。

## 接入

| 位置                                                            | 作用                                     |
| --------------------------------------------------------------- | ---------------------------------------- |
| `src/agents/skill-gates/glossary.ts`                            | 平台术语表、manifest hook、停问判断      |
| `src/agents/execution-preflight/resolve.ts`                     | 绑技能或试跑时写入 bindingPrompt         |
| `src/auto-reply/reply/session-continuity.ts`                    | 恢复上下文带同一段术语                   |
| `src/agents/execution-stall-continue.ts`                        | 静默续跑提示带术语，不再手写微信/邮箱句  |
| `src/agents/skill-gates/trial-gate.ts`                          | 预览升级或 HTML/Markdown 降级            |
| `src/gateway/workspace-resolver/settle-declared-deliverable.ts` | 声明可写 `grade` / `trial`               |
| `src/agents/turn-completion/contract.ts`                        | 试跑闸门接到回合终稿；停问判断改走术语表 |
| `src/cron/completion-contract.ts`                               | 空成功分类                               |
| `src/cron/isolated-agent/run.ts`                                | 真实 cron 跑完先分类再落卡片             |
| `src/cron/cron-result-template.ts`                              | 卡片不再把空结果画成 ✅                  |
| `src/cron/service/timer.ts`                                     | empty/needs_attention 不按传输失败退避   |

## 怎么跑测试

```bash
pnpm exec vitest run \
  src/agents/skill-gates/glossary.test.ts \
  src/agents/skill-gates/trial-gate.test.ts \
  src/agents/skill-gates/smoke-sla.test.ts \
  src/cron/completion-contract.test.ts \
  src/agents/turn-completion/contract.test.ts \
  src/cron/cron-result-template.test.ts
```

覆盖：

1. 技能试跑会话不得停问 OAuth「绑定」。
2. 空 cron（系统skill应用分析、无摘要）卡片没有 ✅，分类是 `empty`。
3. 占位完成声称是 `needs_attention`；无摘要的执行错误是 `failed`。
4. 有摘要的 cron 仍可以 ✅。
5. 试跑「预览可以 / 正式交付不可」升级预览或降级 HTML，声明带 `grade` 和 `trial="1"`。
6. 正式模式不旁路。
7. smoke 壁钟默认 15 分钟，超时降级或一条永久阻塞。
