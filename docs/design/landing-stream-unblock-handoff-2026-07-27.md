# Landing-stream 解锁交接单（2026-07-27）

提出者：`kiro-deploy-audit`。收件人见每个工单的「派给」。

## 当前状态（2026-07-27 11:50 更新）

| 工单                                | 状态                  | 落地提交                                                    |
| ----------------------------------- | --------------------- | ----------------------------------------------------------- |
| W1 落地 audit 规则表 WIP + 签入路径 | ✅ 完成               | `22fe996241`、`d374f8eba4`（`cursor-enterprise-model-gov`） |
| W2 补三条 disposition               | ✅ 完成               | `8487f39ba5`（由 `kiro-deploy-audit` 按本单委派执行）       |
| W3 解决 registry 四方冲突           | ✅ 完成               | `e840216a48`（`kiro-loom`）                                 |
| W4 落地 CHANGELOG 6 条              | ⬜ 仍待作者处理       | 我那 1 条已单独落地（见下）                                 |
| W5 stream 间 45 条重复声明路径      | ⬜ 诊断完成，归属待决 | —                                                           |

**W4 补充**：`kiro-deploy-audit` 已把自己那 1 条以单 hunk 方式落地（经操作者授权使用
`--no-verify`），他人 6 条完好留在工作树未提交。过程中确认了一个流程缺口：**本仓库没有合规
路径能在共享文件里只提交自己那部分** —— `scripts/committer` 用 `git commit -- <files>`
提交工作树内容，而 `git-hooks/pre-commit`（经 `core.hooksPath=git-hooks` 生效）结尾的
`git add --force -- "${files[@]}"` 会撤销任何手工的部分暂存。注意 `.git/hooks/pre-commit`
并不存在，**只查那个路径会误判成"没有钩子"** —— 我正是这么误判，导致一次把他人 6 条一起
提交、需要 `git reset --soft` 回退的错误。跳过钩子时请手工补跑三道门：
`oxfmt --check`、`oxlint --type-aware`、`worktree-audit --cached`。

被卡的两笔改动已在 W2 之后落地：`6ce2597533`（员工端大白路由修复）、`8cc33bed22`（L3 快照脚本）。

**W2 执行中发现的一处重要更正**：disposition 不能写在 `scripts/worktree-audit.ts` 的
`LEGACY_RULES` 里。`scripts/worktree-audit.ts:2048` 起：

```ts
const activeRegistry =
  !process.env.LOOM_FORCE_LEGACY && existsSync(registryPath()) ? loadRegistry() : null;
const rules: AuditRule[] = activeRegistry ? buildRulesFromRegistry(activeRegistry) : LEGACY_RULES;
```

只要 `.loom/registry.yaml` 存在，规则就来自 registry 的 `landingStreams:`，`LEGACY_RULES`
对运行时行为**没有影响**。本单原文让人去改 legacy 表，是错的；正确落点是
`.loom/registry.yaml` 的 `landingStreams:`（EDGSC 与 D 两条流的 `paths:`）。

## 为什么需要协调

有两笔已完成、已验证的改动无法落地，卡点都不在代码质量上，而在 `scripts/worktree-audit.ts`
的 landing-stream 规则表与共享文件的 WIP 状态上。**四个工单里 W1 是总闸**：它一落地，W2 才能动，
W2 一落地，被卡的两笔改动就能各自以单一 stream 干净提交。

被卡的两笔（都在工作树里，测试全绿，`oxlint` 0 error，`tsgo` 对这些文件 0 error）：

| 改动                     | 文件                                                                                                      | 卡点                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 员工端大白短消息路由修复 | `src/gateway/server-methods/chat.ts`（EDGSC）+ `src/gateway/server-methods/chat.mentions.test.ts`（GWSV） | `findRiskyMix` 禁止混多个主组            |
| L3 指针自动生成工具      | `scripts/ops/l3-live-snapshot.ts` + `scripts/__tests__/l3-live-snapshot.test.ts`                          | 两者 UNMATCHED，守卫要求先给 disposition |

## W1 — 落地 `scripts/worktree-audit.ts` 的未提交改动并签入该路径

**派给：`cursor-enterprise-model-gov`**（`.kiro/specs/enterprise-ai-model-governance`）

`scripts/worktree-audit.ts` 现有 +11 行未提交改动，内容是把 `src/gateway/enterprise-model/`、
`.kiro/specs/enterprise-ai-model-governance/`、`src/gateway/server-methods/enterprise-model-*.ts`
等路径加进规则表 —— 与你 `## Agents` 行里 `paths:` 的声明范围完全吻合，因此判定这批改动出自你。

两个动作：

1. 落地这 +11 行（`scripts/committer` 按文件粒度提交，带 `Task:` / `Agent:` trailer）。
2. 在你的 `tasks.md` `## Agents` 行的 `paths:` 里补上 `scripts/worktree-audit.ts`。
   现在 `bun scripts/agent-attribution.ts` 把该文件报为 **UNATTRIBUTED** —— 没有任何 agent 声明它，
   一旦出问题无法追溯到人，这正是 AGENTS.md 要求补签入行的情形。

为什么这是总闸：该文件是唯一能给上面两笔改动发 disposition 的地方，而它现在带着你的 WIP，
别人改它就会把你的活一起带走。

验证：`git status --porcelain scripts/worktree-audit.ts` 为空；`bun scripts/agent-attribution.ts`
不再把它列为 UNATTRIBUTED。

## W2 — 在规则表里补三条 disposition

**派给：W1 完成后的 `scripts/worktree-audit.ts` 持有者**（可由协调 agent 执行）

### W2-a 让源文件和它的测试归同一条流（1 行）

这不是放宽守卫，而是修一处规则表的不一致。现状：

- `src/gateway/server-methods/chat.ts` 被**显式**写在 EDGSC 规则的 `exact(...)` 里（约第 1595 行）
- `src/gateway/server-methods/chat.mentions.test.ts` 没有被任何 exact 命中，落到 GWSV 的
  `prefix("src/gateway/server-methods/")`

于是一个源文件和它的测试分属两个主组，任何同时改动两者的提交都会被 `findRiskyMix` 拦下。
拆成两个提交则必然有一个中间提交是红的（旧测试断言老行为），违反 AGENTS.md 提交节奏
「相关测试必须通过」。

做法：在 EDGSC 的 `exact(...)` 里、紧邻 `"src/gateway/server-methods/chat.ts"` 之后加一行

```
"src/gateway/server-methods/chat.mentions.test.ts",
```

**不要**改 `allowedLinkedPrimaryGroups` 去加 `{EDGSC, GWSV}`。那会为所有人放宽混流限制，
而真实问题只是这一个测试文件的归属漏了。

### W2-b 给 ops 脚本一个 disposition（2 行）

`scripts/ops/l3-live-snapshot.ts` 和 `scripts/__tests__/l3-live-snapshot.test.ts` 属于
guardrail / ops 工具族，与 Group D「Pure Guardrails」已收录的 `scripts/worktree-audit.ts`、
`scripts/agent-attribution.ts`、`scripts/loom.ts` 同类（它同样提供 `--check` 门禁）。

做法：把这两个路径加进 `merge-pure-guardrails` 规则的 `exact(...)`。

验证（三条都应显示单一组、`unmatched entries: 0`）：

```bash
git add --force -- src/gateway/server-methods/chat.ts src/gateway/server-methods/chat.mentions.test.ts
bun scripts/worktree-audit.ts --cached     # 期望只有 MERGE EDGSC
git reset -q -- .
git add --force -- scripts/ops/l3-live-snapshot.ts scripts/__tests__/l3-live-snapshot.test.ts
bun scripts/worktree-audit.ts --cached     # 期望只有 MERGE D
git reset -q -- .
```

## W3 — 解决 `.loom/registry.yaml` 的四方冲突

**派给：`kiro-loom`**（`.kiro/specs/loom-workspace-orchestrator`，registry 的 owner）

`bun scripts/agent-attribution.ts` 报该文件被 4 个 agent 同时声明：`kiro-loom`、
`codex-v111-recovery`、`codex-v112-platform-recovery`、`codex-v113-wecom-integrity`，当前有
+390 / −36 未提交改动。按 AGENTS.md 规则 2，CONFLICT 由该文件的 task-owner 落地。

这条不阻塞 W1/W2（W2 走的是 legacy 规则表），但 registry 是归属的 SoT，长期挂着会让
attribution 失真 —— 本次两笔改动就因为无法安全写 registry 而没能 `loom register` 签入。

## W4 — 落地 `CHANGELOG.md` 里的 6 条未提交条目

**派给：这些条目的作者**（当前 UNATTRIBUTED，无人签入该文件）

`CHANGELOG.md` 有 6 条未提交条目（`Agents/experience learning` ×3、`Agents/capability growth`、
`Agents/operational score`、`Agents/Working DNA`）。`kiro-deploy-audit` 另有 1 条
（`Employee steward chat: …`）也在同一文件里，因此双方都无法在不带走对方改动的前提下提交。

请作者落地这 6 条；之后 `kiro-deploy-audit` 会单独提交自己那 1 条。

## ✅ 已由 `kiro-deploy-audit` 收尾（W1/W2 完成后）

```bash
scripts/committer "Gateway: route employee steward chat through the real agent runtime …" \
  src/gateway/server-methods/chat.ts src/gateway/server-methods/chat.mentions.test.ts

scripts/committer "Ops: generate the production L3 pointer from live state …" \
  scripts/ops/l3-live-snapshot.ts scripts/__tests__/l3-live-snapshot.test.ts
```

第二条提交后，`deploy/production/RELEASE_RECORD.md` 里已落地的
`<!-- L3-LIVE:BEGIN/END -->` 生成块才有对应的脚本可跑；在那之前记录中引用的
`bun scripts/ops/l3-live-snapshot.ts` 命令在仓库里不存在。

## W5 — landing stream 之间有 45 条重复声明路径，归属由声明顺序静默决定

**派给：`kiro-loom`（registry / 测试文件所有者）+ 各相关流的 owner**

### 先更正本单的前一版诊断

本单上一版把这条写成"`test/worktree-audit.test.ts` 的 10 个断言陈旧了，按现状更新即可"。
**那是错的。** 继续查证后发现测试是对的：它是**唯一在报警的回归探测器**，红的原因是规则表
里出现了重复声明。**不要**为了让它变绿而改写断言 —— 那会把唯一的信号销毁。

### 机制

`.loom/registry.yaml` 现有 **74 条 landingStreams**，其中 **45 条路径被多条流同时声明**
（仅统计字面完全相同的路径；prefix / glob 形式的重叠更多，未计入）。分类实现是
"按声明顺序取第一个命中"（`buildRulesFromRegistry` + `rules.find`），所以重复声明时
**排在前面的流静默夺走路径**，没有任何告警。

10 个失败逐条对上这个机制：

| 测试期望归属                              | 实际归属  | 说明                                     |
| ----------------------------------------- | --------- | ---------------------------------------- |
| `scripts/worktree-audit.ts` → D           | **SUG**   | SUG 的 `exact()` 声明了它，且排在 D 之前 |
| `CHANGELOG.md` → （D 家族）               | **SUG**   | 同上；SUG 还夺走 WPL、EDGSC 的声明       |
| `package.json` → H1A0A2B                  | **AOR**   | WPL/AOR/H1A0A2B 三方声明                 |
| `src/gateway/protocol/client-info.ts` → B | **ME**    | ME 排在 B 之前                           |
| `src/commands/doctor.ts` → H1D            | **ME**    | 同上                                     |
| `src/gateway/server-methods/chat.ts` → C  | **EDGSC** | EDGSC 排在 C 之前                        |
| `apps/shared/OpenClawKit/**` → H4         | **HMAC**  | glob 重叠                                |

夺走情况最严重的几条：`src/gateway/method-scopes.ts` 与
`src/gateway/server-methods-list.ts` 各被 **5 条流**声明（SUG / USRM / ASI / PM / EDGSC，
SUG 全拿）；`src/gateway/server-methods.ts` 也是 5 条（USRM 拿）。

重现命令（在干净工作树上）：

```bash
bun scripts/loom.ts lint            # 目前只报 task 级 ownership-overlap，不报 stream 级重复
OPENBOT_TEST_PROFILE=low pnpm vitest run test/worktree-audit.test.ts   # 10 failed / 52 passed
```

### 为什么这不是"测试没跟上"

三点排除：与 W2 无关（还原后失败数一致）；不是 registry 迁移回归
（`loom check` 报 `diffs: 0`、`Parity OK`，`LOOM_FORCE_LEGACY=1` 失败完全相同 ——
测试跑在临时 fixture 仓库里、本就走 legacy 表）；失败全部指向重复声明的路径，
与上表一一对应。

### 建议的处理顺序

1. ~~**先加检测**~~ ✅ **已完成**：`loom lint` 新增 `stream-path-duplicate` 检查，在真实
   registry 上检出 45 条，与手工统计一致；每条都会列出所有声明者、实际赢家、以及被静默忽略
   的流。severity 为 `warn`（45 条全部先于该检查存在，报 error 会立刻让所有人的
   `lint --strict` 挂掉）。嵌套 glob 不报（窄流声明在宽流之前是合理的
   specific-before-general 顺序）。跑 `bun scripts/loom.ts lint | grep stream-path-duplicate`
   查看完整清单。
2. **再定归属** ← 进行中，已派单：见
   [`docs/design/landing-stream-duplicate-claims-2026-07-27.md`](landing-stream-duplicate-claims-2026-07-27.md)。
   45 条已按实际 owner 拆成每人一小组决策，每条给出当前赢家、被静默忽略的流、建议默认值和
   确切改法。三条 gateway 注册中心文件（`method-scopes.ts`、`server-methods-list.ts`、
   `server-methods.ts`，各被 5 条流声明）建议改为专设的 parallel 共享流，而不是判给任一
   serial 特性流 —— 否则必然互相阻塞。另有 19 条争议路径**完全没有签入 owner**，需 `kiro-loom`
   定策略。归属属收敛语义决定，不由单个 agent 代拍。
3. **最后才动测试**：归属定下来后，测试断言按结果对齐，或改为从 registry 派生期望值。

在 1、2 完成前，`test/worktree-audit.test.ts` 会持续红。它的代价是真实的 —— 我在 W2 验证
时先误判成自己改坏了，排除它花了一轮。建议在修复前给这个文件加一条注释说明已知原因，
避免下一个人重复踩。

`test/worktree-audit.test.ts` 与 `.loom/registry.yaml` 都属 landing stream D（除非被 SUG 夺走
—— `scripts/worktree-audit.ts` 正是如此），提交前先用 `worktree-audit --cached` 确认实际归属。

## 通用约束（本次踩到过）

- 不提交仍带其他 agent 未提交 WIP 的共享文件（AGENTS.md 规则 2）。
- 不为了绕过混流限制而放宽 `allowedLinkedPrimaryGroups`；先检查是不是路径归属漏了。
- 拆分提交时，不接受中间提交测试红的方案。
- `scripts/committer` 会先 `git reset -- .` 再按路径 `git add`/`git commit`，所以它会清掉
  当时整个暂存区 —— 并行操作前先确认暂存区只有自己的文件。
