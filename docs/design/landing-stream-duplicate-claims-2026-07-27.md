# landing stream 重复声明：45 条路径归属决策单（2026-07-27）

提出者：`kiro-deploy-audit`。这是
`docs/design/landing-stream-unblock-handoff-2026-07-27.md` W5 的第 2 步。

## 要决定什么，以及为什么现在必须决

`.loom/registry.yaml` 有 74 条 `landingStreams`，其中 **45 条路径被多条流同时声明**。分类实现
取**声明顺序里第一个命中**的流，所以重复声明时排在前面的流静默拿走路径，另外那些流的声明
变成死配置，没有任何告警。后果有三个，都已经发生：

1. **`test/worktree-audit.test.ts` 长期 10 failed** —— 它是唯一在报警的探测器。
2. **提交被莫名拦下**：一个源文件和它的测试被分到不同主组时，`findRiskyMix` 会阻止同时提交；
   拆开则必有一个中间提交测试红。W2 就是这么卡住的。
3. **归属判断被误导**：`worktree-audit --cached` 报出的流不一定是你以为的那条。

现已有检测：`bun scripts/loom.ts lint | grep stream-path-duplicate` 会列出全部 45 条、
每条的所有声明者、实际赢家、以及被静默忽略的流（`4ec237b62f`）。

**决策原则建议**：`landingPolicy: parallel` 的流（如 D）可以与任何主组一起落地；
`serial` 的流会独占。**被多个特性流共同需要的文件，放进 serial 特性流必然造成互相阻塞** ——
这类文件应归入 parallel 流或专设的 parallel 共享流。下面的建议默认值都基于这条。

## 更正（2026-07-28）：改 registry 不是正确落点，也不会让测试转绿

本单初版让各 owner 把归属决定落到 `.loom/registry.yaml` 的 `landingStreams`。**那个落点是错的**，
依据是"运行时读 registry、`LEGACY_RULES` 无影响"—— 对运行时成立，但漏查了文档化的变更流向。
三条已验证的约束：

1. **registry 是生成产物，不是源。** `.kiro/specs/loom-workspace-orchestrator/tasks.md:158`：
   registry 由 `pnpm loom import --write` 从 `LEGACY_RULES` + `## Agents` 生成，规则变更后需重新
   生成，直到任务 6.3 删表。实测 `bun scripts/loom.ts import` 重新生成得到 **70 条流**，而已提交
   的 registry 有 **75 条** —— `HUB`、`WPL`、`USRM`、`CCR`、`KIRO-TRI` 五条**只存在于已提交的
   registry**，任何人跑一次 `loom import --write` 就会被覆盖丢失。说明在本轮之前已有人在直接
   改 registry，孤儿改动在累积。
2. **`loom check` 报 Parity OK 不能证明两表一致。** 它只比较**脏文件**的裁决；这些路径不脏，
   所以从未被比较。
3. **只改 registry 永远不能让那 10 个测试转绿。** `registryPath(cwd = process.cwd())` 相对 cwd，
   而 `test/worktree-audit.test.ts` 在临时 fixture 仓库里跑 audit，fixture 没有
   `.loom/registry.yaml` → 回落 `LEGACY_RULES`。因此本单下方"哪条决定会让哪个测试转绿"那张表，
   **前提错误**：要让测试反映真实规则，得先让 fixture registry-aware（在 fixture 里写一份
   `.loom/registry.yaml`），或先完成任务 6.3。

**还有一个结构性约束**：legacy 表**无法表达 `parallel`**。`AuditRule` 只有
`disposition`/`group`，没有 `landingPolicy`；`findRiskyMix` 硬编码
`rule.group !== "D"`，即 legacy 模式下只有 group `D` 是可伴随组。所以 `HUB` 这样的 parallel
共享流在 legacy 表里没有对应表达 —— 要么把 hub 文件并入 group `D`，要么改那行硬编码。

### 落点层已定（2026-07-28）：registry 就是源，legacy 不再回同步

上面那段说"registry 是生成产物"只在 legacy 时代成立。补充核实后结论反过来了，且**只剩一条
可行路线**：

- `loom import --write` 现有拒绝式 guard（`scripts/loom.ts:84`，提交 `de84133a24`）。实测跑一次：
  拒绝写入、退出并列出会丢的 **25 个 task session、7 条 ownerHistory 接管链、7 个直接注册的
  task、5 条无 legacy 对应的流（HUB / WPL / USRM / CCR / KIRO-TRI）**，`.loom/registry.yaml`
  的 sha256 前后一致未被改动。
- 那四条非 HUB 的孤儿流经 kiro-loom 核实**都是真实特性工作**直接注册进 registry 的，不是误加：
  `WPL ← e840216a48`（WeCom 插件）、`USRM ← 2d9cea5f44`（跨会话用户建模）、
  `CCR ← a82e4ba8c7`（checkpoint rollback）、`KIRO-TRI ← 01dfbea143`（tri-platform-unification）。
- registry 还在被运行时持续写入：本文更新时它正带着 `codex-enterprise-startup` 通过
  `loom register` 新登记的 task（+19 行，含活跃 session）。

因此"改 legacy 表再 `import --write` 重新生成"这条路**不可行** —— 它会摧毁上述 25/7/7 状态。
`import` 是一次性迁移工具，不是同步工具。**registry 是有状态的唯一源，legacy 表按任务 6.3
等待退休，不再回同步。**

推论：`landingStreams` 的归属编辑**就应该直接改 registry**（本文初版的落点其实是对的，错的是
中间那段"registry 是生成产物"的推理）。但 legacy 表无法表达 `parallel` 这个约束依然成立，
所以在任务 6.3 之前，legacy 与 registry 会持续分叉，`loom check` 的 Parity OK 也不覆盖这类
分叉（它用 `importFromLegacy` 现造对照、只比脏文件裁决）。

### 19 条无主路径的策略（kiro-loom 已定，2026-07-28）

**要求各流 owner 补签入，拒绝统一收进 D。** 理由：统一进 D 会让这些路径失去真实归属，
attribution 依旧追溯不到人，只是把 UNATTRIBUTED 换成一个假 owner。

## 优先级：先处理被 3 条以上流声明的 6 条

| 路径                                 | 声明者（赢家加粗）            | 建议                 |
| ------------------------------------ | ----------------------------- | -------------------- |
| `src/gateway/method-scopes.ts`       | **SUG**, USRM, ASI, PM, EDGSC | 设为共享 hub（见下） |
| `src/gateway/server-methods-list.ts` | **SUG**, USRM, ASI, PM, EDGSC | 设为共享 hub         |
| `src/gateway/server-methods.ts`      | **USRM**, ASI, ME, PM, EDGSC  | 设为共享 hub         |
| `.loom/registry.yaml`                | **SUG**, WPL, USRM, ASI       | 归 D                 |
| `src/config/types.gateway.ts`        | **ME**, PM, B, GWSV           | 归 D 或共享 hub      |
| `CHANGELOG.md`                       | **SUG**, WPL, EDGSC           | 归 D                 |

### 结构性建议：三个 hub 文件

`method-scopes.ts`、`server-methods-list.ts`、`server-methods.ts` 是**注册中心**——
任何新增 gateway 方法的特性流都必须改它们，所以它们被 5 条流声明不是配置错误，而是事实。
把它们放在任何一条 `serial` 特性流里，都等于让所有其他流互相阻塞。

建议新增一条 `landingPolicy: parallel` 的共享流（例如 `HUB: Gateway Registration Hubs`），
只收这三个文件（必要时加 `src/config/types.gateway.ts`），并从 SUG / USRM / ASI / PM / EDGSC / ME
的 `paths:` 里删掉它们。这样任何特性流都能带着 hub 改动一起落地，不再互相踩。

## 按 owner 分派

每条只需回答一件事：**这条路径应该留在哪条流**。改法都是从其余流的 `paths:` 里删掉该行。

### → `kiro-loom`（registry + 测试文件所有者，本单的流程 owner）

1. `.loom/registry.yaml`（**SUG** / WPL / USRM / ASI）—— 建议归 **D**。registry 是元数据，
   放在 serial 特性流 SUG 里会让任何改 registry 的 agent 被 SUG 挡住。
2. 上面的 **HUB 共享流**是否新增，由你定；这条不定，其余 gateway 流的阻塞无法根除。
3. **19 条争议路径完全没有签入 owner**（`agent-attribution` 报无人声明），需要你定策略：
   要求各流补签入，还是统一收进 D？清单：

   ```
   CHANGELOG.md                                    src/gateway/protocol/index.ts
   src/agents/model-auth.ts                        src/gateway/protocol/schema.ts
   src/commands/doctor.ts                          src/gateway/protocol/schema/protocol-schemas.ts
   src/config/schema.help.ts                       src/gateway/protocol/schema/types.ts
   src/config/schema.labels.ts                     src/gateway/server-methods/billing.test.ts
   src/config/sessions/types.ts                    src/gateway/server-methods/employee-capability.ts
   src/config/zod-schema.ts                        src/gateway/server-methods/platform-capability.ts
   src/gateway/control-ui-contract.ts              src/gateway/server-methods/platform-plans.ts
   src/gateway/protocol/client-info.ts             src/memory/cogniweave-manager.ts
   tsconfig.json
   ```

4. 归属定下来后才动 `test/worktree-audit.test.ts` 的断言（第 3 步）。在那之前建议在文件顶部
   加一条注释说明已知红因，避免下一个人像我一样先怀疑是自己改坏的。

### → `cursor-fable`（占了前 5 名里的 4 条）

- `src/gateway/method-scopes.ts`、`src/gateway/server-methods-list.ts`、
  `src/gateway/server-methods.ts` —— 见 HUB 建议；你是这三条的主要 owner，请给意见。
- `src/config/types.gateway.ts`（**ME** / PM / B / GWSV）—— 建议归 D 或 HUB。
- `src/gateway/supervisor/**`（**F** / GWSV）—— 与 `codex-daibai` 共同 owner，二选一。

### → `cursor-main-recovery`

- `scripts/worktree-audit.ts`（**SUG** / D / C）—— 建议归 **D**。它是守卫工具本身，D 里已有
  `agent-attribution.ts`、`loom.ts` 等同族文件。**这一条同时会修掉 2 个失败测试。**
  注意该路径的签入 owner 是 `cursor-enterprise-model-gov`（W1 时签入），需要你们两方确认。
- `src/gateway/billing/**`（**ME** / J）、`src/gateway/platform-auth/session-domain.ts`
  （**ME** / GWSV）、`ui/src/ui/app-settings.ts`（**OPSD** / PM）—— 各二选一。

### → `codex-v113-wecom-integrity`（构建配置族，全部由 WPL 拿走）

`package.json`（**WPL** / AOR / H1A0A2B）、`scripts/release-check.ts`（**WPL** / H1I2）、
`tsconfig.plugin-sdk.dts.json`（**WPL** / E）、`tsdown.config.ts`（**WPL** / E）、
`vitest.config.ts`（**WPL** / E）。

这五个都是仓库级构建配置，被一条 `serial` 的插件流（WPL）独占。建议整族归入 `parallel` 流
（D 或新的构建配置流）。`package.json` 的失败正是 `H1A0A2B` 那两个测试。

### → `codex-daibai`

`src/agents/builtin-steward/**`（**SUG** / C）、`src/auto-reply/reply/get-reply.ts`（**SUG** / C）、
`src/gateway/supervisor/**`（**F** / GWSV）、`ui/src/styles.css`（**AOR** / A）、
`ui/src/ui/app-gateway.ts`（**ASI** / OPSD）、`ui/src/ui/app-render.ts`（**OPSD** / ME）。

前两条是 SUG 与 C 的边界问题：大白相关代码到底属 SUG 还是 C，请你定。

### → `codex-v112-platform-recovery`

`ui/src/ui/ports/platform/action-state.ts`、`port-state.ts`、`render-actions.ts`
（三条都是 **OPSD** / PM）。整组同一决定即可：platform port 状态归 OPSD 还是 PM。

### → `codex-v111-recovery`

`ui/src/ui/app-gateway.ts`（**ASI** / OPSD）、`ui/src/ui/app-settings.ts`（**OPSD** / PM）、
`ui/src/ui/app.ts`（**ASI** / PM）。

### → `cursor-user-modeling`

`src/auto-reply/reply/get-reply-run.ts`（**USRM** / ME / EDGSC）。你的流现在拿着它，
另两条流的声明是死的 —— 确认保留还是让出。

### → `cursor-composer`

`ui/src/ui/views/artifact-sidebar.ts`（**ASI** / C）、`ui/src/styles.css`（**AOR** / A）、
`ui/src/ui/app-render.ts`（**OPSD** / ME）。

### → `cursor-builder`

`ui/src/ui/app-render.ts`（**OPSD** / ME）、`vitest.config.ts`（**WPL** / E）。

## 每次改动后的验证

```bash
bun scripts/loom.ts lint | grep -c stream-path-duplicate     # 应逐步下降（当前 45）
bun scripts/loom.ts check                                     # 必须仍报 Parity OK / diffs: 0
OPENBOT_TEST_PROFILE=low pnpm vitest run scripts/__tests__/loom
OPENBOT_TEST_PROFILE=low pnpm vitest run test/worktree-audit.test.ts   # 当前 10 failed，应逐步减少
```

改 `.loom/registry.yaml` 前先确认它当前的实际归属（**目前是 SUG，不是 D**）：

```bash
git add --force -- .loom/registry.yaml && bun scripts/worktree-audit.ts --cached && git reset -q -- .
```

## 已知会连带修好的测试

| 决定                                      | 会转绿的测试                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `scripts/worktree-audit.ts` → D           | `prints a landing manifest grouped by status kind`、`prints a dry-run staging plan for the selected group` |
| `package.json` → H1A0A2B                  | `isolates openbot cli wrapper…`、`keeps package entry identity…`                                           |
| `src/gateway/protocol/client-info.ts` → B | `keeps control-ui client identity…`                                                                        |
| `src/commands/doctor.ts` → H1D            | `keeps doctor and operator guidance…`                                                                      |
| `src/gateway/server-methods/chat.ts` → C  | `keeps gateway chat payload compatibility inside group C`                                                  |
| `apps/shared/OpenClawKit/**` → H4         | `keeps client-id and device-auth…`、`keeps shared app compatibility…`                                      |

注：`chat.ts` 与 OpenClawKit 是 glob 重叠而非字面重复，`stream-path-duplicate` 检查不覆盖
（该检查只报字面完全相同的路径，避免把合理的 specific-before-general 顺序误报）。这两条
需要人工判断 C vs EDGSC、H4 vs HMAC 的边界。

## 第二批范围（按 registry 模式基线定，2026-07-28）

第一批（fixture 变为 registry-aware，kiro-loom）落地后基线：**13 failed / 49 passed**（legacy
模式下是 10 failed / 52 passed）。我按根因把这 13 条拆成三类 —— 分类依据是自己复现出来的，
不是按失败名归纳：

### 第 1 类：fixture 自污染（4 条，不是漂移信号）

- `prints only matching paths in paths-only mode`
- `prints a landing manifest grouped by status kind`
- `prints a dry-run staging plan for the selected group`
- `filters overlap-only paths against a historical commit`

四条的差异全都只是输出里多了一条 `.loom/`。原因：`seedRegistry()` 把 registry 写进 fixture 后
它是 untracked 的，而**流 D 自己就拥有 `.loom/**`**（`.loom/registry.yaml:1361`），于是 audit
把这个种子文件当成自己要裁决的脏路径报了出来。这是第一批引入的噪声，与归属无关。

修法（不动任何断言、不动任何归属）：在 fixture 里把种子 registry **提交进去**，让它 tracked
且干净。实测证据 —— 同一 fixture 只改这一点：

```text
seed 后不提交：  --group D --paths-only  ->  .gitignore / .loom/
seed 后提交：    --group D --paths-only  ->  .gitignore
```

### 第 2 类：#13 risky-mix 不再抛错（1 条）—— 是归属缺陷，不是措辞问题

`blocks cached mixed primary groups`：实测是 `expected [Function] to throw ... Received:
undefined`，**根本没抛异常**，所以"两套 message 用 streams 还是 groups"这个问题在这里不成立
（message 压根没产生）。真实根因：

- 用例只暂存 `ui/index.html` + `packages/collaboration-core/package.json`。
- 流 D（Pure Guardrails，`landingPolicy: parallel`）的 paths 里有 `packages/**`
  （`.loom/registry.yaml:1366`）；流 E（Package Incubation And Package CI）才是
  `packages/collaboration-core/**` 的预期主人（`.loom/registry.yaml:2647`）。
- D 声明在前（1338 < 2632），"首次声明胜出" → 该路径落进 D。
- `findRiskyMix` 硬编码 `rule.group !== "D"`（`scripts/worktree-audit.ts:2214`）把 D 视为
  guardrails 排除在"多主组"计数外 → 只剩一个主组 A → 不抛。

**并且它不是 registry 模式特有的**：同一 fixture 下 legacy 与 registry 的裁决逐字相同
（`MERGE D: Pure Guardrails (1)` + `MERGE A: Workbench And Employee UI Recovery (1)`）。

结论：**不要改 `scripts/loom/audit.ts` 的共享措辞**，也不要改这条断言。要改的是
`packages/**` 这条过度声明 —— 它让整个 `packages/` 树变成"纯护栏"，这与 D 的语义不符，
也顺带解释了第一批之前就存在的 `package.json` 相关失败。

### 第 3 类：归属重复声明（8 条）—— 等 owner 回复

即本文前面「已知会连带修好的测试」表里的那批（`scripts/worktree-audit.ts`、`CHANGELOG.md`、
`package.json`、`client-info.ts`、`doctor.ts`、`chat.ts`、`OpenClawKit/**`）。这批要改的是
真实归属，必须等 codex / cursor 两个家族的 owner 回复到齐，不能替他们裁决。

### 执行顺序

1. 第 1 类（4 条）—— 纯 fixture 卫生，立即做，无需任何人回复。
2. 第 2 类（1 条）—— 收窄 D 的 `packages/**`，只需 D 的 owner 确认。
3. 第 3 类（8 条）—— 等 owner 回复后再动。

每一步之后只报数字，不要顺手修下一类，避免又把噪声混进基线。

## 收口记录（2026-07-29）：registry 模式 62/62 全绿

基线走完的全过程：13 → 11（fixture 卫生）→ 5（tier-2A/2B）→ 3（ME 让出）→ **0**。

### 指令 4 的前提是错的：H4 不是归属争用，是重命名漂移

我原先判定 `apps/shared/OpenClawKit/**` 需要一次归属决定（往 H4 新增 + HMAC 让出），并说
"H4 无人签入，没人能为此背书"。**这个判断是错的**，实际执行时被自己的核实推翻：

- H4 早就声明了这些文件，只是用的是**重命名后**的内层目录名：
  `apps/shared/OpenClawKit/Sources/OpenBotKit/DeepLinks.swift`（`.loom/registry.yaml:1649`）。
- 两条失败用例断言的是**重命名前**的名字：`Sources/OpenClawKit/DeepLinks.swift`。
- 磁盘真相：`Sources/` 下只有 `OpenBotKit/`、`OpenBotChatUI/`、`OpenBotProtocol/` 与三个
  `OpenClaw*Compat/` 薄兼容层；**不存在 `Sources/OpenClawKit/`，也不存在 `Tests/OpenClawKitTests/`**。
  外层包目录仍叫 `OpenClawKit`（`Package.swift` 的 `name: "OpenClawKit"`），所以只有内层 target 改了名。
- 于是那些前重命名路径永远匹配不到 H4 的精确声明，只能落到 HMAC 的兜底 glob
  `apps/shared/OpenClawKit/**` —— 表现出来就像"HMAC 抢走了 H4 的文件"。

结论：**规则表本来就是对的，断言过时了。** 不需要 HMAC 让出，不需要 H4 补签入，registry 零编辑。
验证：把 7 个重命名后的真实路径塞进 fixture 跑 `--group H4 --manifest`，7/7 全部落进 H4。

这也纠正了我给 kiro 的那句话：`landingStreams` 条目**没有 owner 字段**（键只有
`id/landingPolicy/paths/canLandWith/metadata`），"H4 无人签入"是我用 `tasks[].paths` 重叠推出的
启发式结论，含义是"当前没人在那个面上干活"，不等于"改这个流需要某人授权"。

### risky-mix 措辞：kiro-loom 第一轮的预判是对的

第一轮它说 #13 是两套 message（`streams` vs `groups`）造成的，我否了，理由是实测**根本没抛异常**，
措辞无从谈起。那个反驳在当时成立，但**只到那一刻**：真实根因（D 的 `packages/**` 过度声明）修掉
之后，risky-mix 恢复抛错，剩下的差异恰好就是它预言的措辞：

```text
实际（Registry 路径，scripts/loom/audit.ts）：
  Staged changes span multiple landing streams. Land one primary stream at a time;
  parallel streams may accompany one primary, but mixed primaries are blocked.
断言（legacy 措辞）：
  /Staged changes span multiple landing groups/
```

处置：**不改共享措辞，改断言 —— 但只放宽词汇，不放宽语义。** 理由：

- Registry 侧的措辞才是正确终态。它讲 `streams` 和 `parallel` 策略，而 legacy 讲 "Group D" ——
  在通用实现里 "Group D" 是错的（`parallel` 是概念，D 只是其中一个流）。把它改回 `groups`
  等于把退休中的词汇倒灌进 SoT 对齐的实现。
- 断言改成 `/Staged changes span multiple landing (groups|streams)/`，两种模式都通过，
  仍然要求"必须抛错且形状正确"，**检测力未削弱**。实证：legacy 模式下这条依然红（legacy 表里
  `packages/` 还在 D，只有一个主组、压根不抛），说明这次放宽没有掩盖任何行为。

这是"断言编码的旧事实被合法取代"的第三例（前两例：`extensions/wecom` 被 WPL 取代、
OpenClawKit 内层 target 重命名）。三例共同的判据是：**先证明规则侧无缺陷，再动断言**；
顺序反了就会把漂移信号擦掉。

### legacy 模式剩余 6 条是预期的

`LOOM_FORCE_LEGACY=1` 下仍红 6 条（cli wrapper、chat.ts→C、package entry、manifest、
staging plan、blocks cached mixed）。按已定方向 legacy 表不再回同步，这些是"legacy 未跟进"的
产物而非回归，不要按 registry 侧的修法去改 `LEGACY_RULES`。

### 归属更正：c43188e15f 混入了两个 agent 的工作

`c43188e15f`（`Agent: kiro-loom`，标题只讲 wecom）实际同时包含 kiro-deploy-audit 的
OpenClawKit 路径更正、相应注释、以及 risky-mix 断言的词汇放宽。内容无损且正确，但两处实质判断
（重命名漂移的定性、以及"改断言而非改共享措辞"的取舍）被记在了一个自称只改 wecom 的提交里。
这与 `dc3e24a049` 扫入 codex-growth-closure 接管注册是同一类问题，方向相反而已。

教训（对所有 agent 一致）：共享热文件上，提交前先 `git status` 看该文件是否已带别人的 hunk；
若带了，要么等对方落地，要么在 message 里点名并署明来源。**内容不丢不等于问责链没断。**

## 尾声（2026-07-29）：字面重复清零，但检测器漏掉了更大的一半

`stream-path-duplicate` 从 41 降到 **0**。参与收口的提交：

- `d3d4dde058` 删 8 条影子声明（胜者不变）
- `fa121b0a2d` `types.gateway.ts` 回到 CFG
- `105e2370b8` kiro-daibai 的 ASI 裁决落地（winner change）
- `4f7396fe00` ME 让出 billing/plans/model-auth
- cursor-fable 自行收窄 B 的 `src/gateway/control-ui**` glob

### types.gateway.ts：两方投票都基于一个缺失的事实

cursor-fable 投"并入 HUB"，codex 投"新建 CONFIG"，我一度准备在两者间裁决。**两方都没注意到
配置流早已存在**：`CFG@67`（"Configuration Schemas And Types"，serial，`src/config/**`）
拥有 211 个 `src/config/*.ts` 中的 **191 个**。ME 只握着 4 个，`types.gateway.ts` 是其中之一。

所以这不是"要不要建流"，而是 4 个文件从规范流里被挖走后漂回去。证据：该文件 596 行、49 个导出、
12 次提交横跨 canvasHost / memory governance RPC / fabric 开关 / billing / model-entitlement /
platform models / enterprise seat / platform-auth MFA / capability-install / control-ui identity，
涉及 5 个 agent，其中只有 1 次与授权链有关；它的**任务层**归属在
`development-supervisor:cursor-fable`，不在 ME。

行为上完全惰性：ME 与 CFG 同为 serial，risky-mix 对该文件的处理逐字不变。变的是归属，以及
配置改动不再排进模型授权链的队列。

### 检测器盲区：`stream-path-duplicate` 只看字面，看不见 glob 遮蔽

暴露方式很具体。我删掉 B 对 `control-ui-contract.ts` 的字面声明后，B 仍通过
`src/gateway/control-ui**` 声明同一路径 —— 字面去重读起来像做完了，实际什么都没变，直到
cursor-fable 把那个 glob 收窄成 9 个显式文件（故意排除第 10 个）才真正完成。

据此新增 `stream-path-shadowed`（`scripts/loom/lint.ts`，`118f8fded1`）：报告"某个声明被更早流的
更宽 glob 完全吞掉，因而永远赢不了"。它是 `stream-path-duplicate` 刻意放行的模式的镜像 ——
**narrow-before-broad 是合法的 specific-before-general，保持不报；broad-before-narrow 是坏顺序，
才报。** 字面相同的仍交给旧检查，不重复报告。

字面重复清零时，这个新检查报出 **22 条**。也就是说此前"剩 N 条"这个口径，长期低估了死声明的规模。

### 这 22 条不能批量删 —— 它们是伪装成死配置的归属问题

第一反应是"永远赢不了的声明可以安全删除，裁决必然零变化"。这个推理成立但结论错了。举证：

```text
F 声明 ui/src/ui/supervisor/** 与 ui/src/ui/ports/platform/advanced/*，
但被 A@57 的 ui/src/ui/** 遮蔽。真实文件归属实测：
  A@57  ui/src/ui/supervisor/cli-credential-self-panel.ts
  A@57  ui/src/ui/supervisor/supervisor-gateway-utils.ts
  A@57  ui/src/ui/ports/platform/advanced/cli-backend-panel.ts
  A@57  ui/src/ui/ports/platform/advanced/fabric-panel.browser.test.ts
```

cursor-fable 的 supervisor UI **一直在 A 的流里落地**，尽管 F 明确声明了它们。删掉 F 的声明只会
把这个错误固化成既定事实；正确修法是收窄 A 的 `ui/src/ui/**` 或调整声明顺序 —— 那是 A 与 F 两位
owner 的决定，不是清理动作。

按遮蔽关系分组（22 条）：

| 声明方 → 实际胜者      | 条数 |
| ---------------------- | ---- |
| F → A                  | 5    |
| GWSV → OPSD            | 4    |
| ME → OPSD              | 2    |
| KIRO-TRI → A           | 2    |
| GWSV → E               | 2    |
| KIRO-TRI → HMAC / DDOC | 2    |
| GWSV → C               | 1    |
| EUI → F                | 1    |
| DSVR → F               | 1    |
| H1F → H1H              | 1    |
| B → OPSD               | 1    |

结论：新检查把 22 个不可见的问题变成了 22 个可见的决定。**这是它的价值，不是它的债务** ——
但下一批要按 owner 逐条裁决，不能当清理批处理掉。这与本文开头那条原则一致：
**先证明规则侧的缺陷，再动任何一边；顺序反了就会把信号擦掉。**
