# 上下文组件构建方案

工作树：`runtime-convergence/openbot`。本文是上下文组件的目标结构，不是现状说明，也不是生产启用证明。实现前重新阅读当前源码；下文路径以职责为准，行号会随迁移变化。

## 结论

上下文组件只做三件事：目录决定一个场景允许哪些材料、以什么顺序出现、放在系统段还是用户正文；装配把已经渲染好的片段拼成模型输入；编译只压缩历史消息。

宿主负责读取、检索、记账和授权。组件不读取网关，不写任务板，不记学习暴露，不改会话上的交付授权。

产品只有两种机器人场景，因此只有两本目录：

- 个体目录：机器人自己的会话，以及心跳、定时、出生这类没有协作群身份的触发。
- 协作成员目录：这个机器人正在某个协作小组里对话或执行任务。先放个体材料，再追加群层。

不存在普通群聊，也不建立渠道群目录。群上下文、群介绍、群系统提示、章程、使命、阶段、交付提示和协作能力只属于群层。

## 为什么要这样拆

当前 `src/agent-runtime/context/` 已经有纯投影和架构隔离：`context/**` 不能依赖 gateway、agents、conversation-task、auto-reply、plugins、cron。拼接器、任务板投影、协作使命投影、身份引导投影和学习回忆渲染都是纯函数。

缺口在目录归属。`src/auto-reply/reply/get-reply-run.ts` 用 `shouldUseCollaborationRuntimeAssembly` 区分协作装配和另一条分支，又把另一条分支当成个体目录。该分支在 `ChatType === "group"` 时调用 `buildGroupChatContext` 和 `buildGroupIntro`，并在 `GroupSystemPrompt` 非空时放进系统段。这是已经不存在的普通群聊行为。个体机器人因此可能带上群名、成员、群回复规则和群系统提示。

系统提示的章节表仍在 `src/agents/system-prompt.ts` 的 `buildAgentSystemPrompt`。嵌入式尝试和 CLI 各自调用它，再把入口拼好的 `extraSystemPrompt` 嵌进去。`compileModelContext` 只在编译开关打开时压缩消息记录，不重排系统提示章节。这三段职责不同，不能合成一个总装函数。

## 目标结构

```text
src/agent-runtime/context/
  catalog/individual.ts
  catalog/collaboration-member.ts
  assembly.ts
  sources/
  compilation/
  prompt-composition.ts
  index.ts
```

一段材料的形状是 `{ id, trust, text }`。`trust` 只有 `system` 和 `untrusted-user`。空文本在装配时丢弃。不可信材料进入用户正文，不进入系统段。

### 目录

目录是允许清单加固定顺序，不是读取器。

个体目录接受：入站元数据、回复语言、时区、远程环境、用户画像、席位规则、会话任务焦点、已接纳任务板、主目标、数据预检、会话连续性、知识、运行身份、学习回忆、系统事件、技能提示，以及任务面说明、澄清、提及提示、出生提示、定时提示。

个体目录拒绝：群上下文、群介绍、群系统提示、章程、使命、阶段、交付提示、协作能力。传入这些 id 时装配失败，不得静默丢弃后继续。

协作成员目录先使用个体目录的材料和顺序，再追加群层。群层只有：群上下文、群介绍、群系统提示、章程、使命、阶段、交付提示、协作能力。协作成员目录不替代个体材料，因为执行者仍是这个机器人。

启用协作成员目录的条件保持现有显式判定：`shouldUseCollaborationRuntimeAssembly` 为真，即协作回合带有非空群标识，或当前会话已经绑定该协作群。`ChatType === "group"` 本身不能选择群层。

### 装配

`assembly.ts` 保留并收紧现有职责：筛选、追加、按目录顺序拼接。系统材料用现有 `finalizeSystemContext` 的连接方式。不可信材料继续走 `appendUntrustedContext`，标题和“不得当作指令”的包装保持不变。

装配函数接收目录名和已经渲染好的片段。它不 await 外部服务，不消费系统事件队列，不写 `sessionCtx`。

两个公开入口：

- `assembleIndividual`
- `assembleCollaborationMember`

`get-reply-run.ts` 按场景调用其中一个。入口不再手写两套片段数组来决定群材料是否进入系统段。

### 投影

`sources/` 继续一材料一文件，只接收已经取到的事实并返回文本。

个体投影包括现有的任务板、任务恢复、身份引导、学习回忆渲染、技能提示渲染。协作投影包括现有的协作使命，以及从 `groups.ts` 迁入的群上下文和群介绍渲染。群系统提示在宿主已经 trim 后，作为群层片段传入，不在 context 里解释渠道配置。

个体目录的实现不得引用协作投影。

以下动作留在宿主，即使它们今天和提示词写在同一个函数里：

- 知识检索、来源收据和审计记录
- 学习暴露记账
- 用户画像、席位和运行身份的读取
- 技能策略过滤和技能快照读取
- 系统事件队列的一次性消费
- 协作装配对 `sessionCtx.DeliveryToolSideEffect` 的写入

协作宿主先处理交付副作用，再把交付提示文本交给协作成员目录。

### 编译

`compilation/` 保持第三段。`compileModelContext` 在系统提示写完之后，按通道预算压缩历史消息。协作编译策略只影响这组消息的窗口和成员结论保留，不变成第三本业务目录，也不改写系统段。

`prompt-composition.ts` 继续负责系统提示完成之后的钩子前置、追加和替换。钩子不进入目录允许清单。

### 公开入口

`context/index.ts` 只导出：

- `assembleIndividual`
- `assembleCollaborationMember`
- `compileModelContext` 及其既有编译类型
- 确有外部复用的纯投影

不提供接收配置、会话并在内部读取一切的总装函数。

## 与执行链的关系

```text
宿主取数
  → assembleIndividual 或 assembleCollaborationMember
      → 系统段 extraSystemPrompt
      → 用户正文中的不可信包装
  → 执行尝试把系统段嵌入 buildAgentSystemPrompt
  → 钩子经 prompt-composition 调整系统提示
  → 编译开关打开时，compileModelContext 只处理消息记录
```

`src/agents/system-prompt.ts` 的章节顺序本阶段不迁移。嵌入式路径 `buildEmbeddedSystemPrompt` 和 CLI 路径 `buildSystemPrompt` 继续调用它。工具清单、沙箱路径和工作区文件仍由执行尝试算好后传入。

两本目录稳定、字节顺序有回归锁住之后，再把章节表收成 context 里的系统文档函数，供嵌入式和 CLI 共用。该函数接收已经完成的 `extraSystemPrompt`，不反向调用目录，也不并入 `compileModelContext`。

## 实施顺序

1. 新增两本目录和统一的片段类型。用测试锁住：个体装配收到群 id 时失败；协作成员装配的群层排在个体材料之后；不可信片段不进系统段。
2. 把 `get-reply-run.ts` 的个体分支改为 `assembleIndividual`。删除该分支对 `buildGroupChatContext`、`buildGroupIntro` 和 `groupSystemPrompt` 的使用。协作分支改为把 `assembleCollaborationRuntimeContextParts` 已产出的文本按 id 送入 `assembleCollaborationMember`，不改变协作材料的现有顺序。
3. 更新 `get-reply-run.aside-dialogue-context.test.ts`。非协作用例不得再期望系统提示含 `GROUP_MIDDLE`。协作用例仍通过协作装配接收群材料。不可信正文仍在用户正文。系统事件仍只消费一次。
4. 将群上下文和群介绍的纯渲染迁入 `sources/`。`groups.ts` 可暂时再导出，直到协作装配改为调用 context。不要在这一步删除 Discord、Telegram、Slack、Line 写入 `GroupSystemPrompt` 的适配器。
5. 保持 `compilation/` 和 `buildAgentSystemPrompt` 不动。系统文档上收单列后续变更。

`shouldInjectGroupIntro` 传到 `runReplyAgent` 的现有行为先保留。`agent-runner.ts` 用它清除 `groupActivationNeedsSystemIntro`。本阶段只停止个体系统段消费群介绍，不顺手删除这个会话标记。

## 验收

- 个体回合的 `extraSystemPrompt` 不含群上下文、群介绍、群系统提示、章程、使命、阶段、交付提示和协作能力。
- 协作回合仍包含协作装配产出的群材料，相对顺序和信任位置与迁移前一致。
- 旁路历史和 `UntrustedContext` 仍进入用户正文，不进入系统段。
- 系统事件队列每次回复只消费一次。
- context 新增代码不导入 gateway、agents、auto-reply、conversation-task、plugins、cron。
- 不新增模型调用、任务写入、第二套场景分类器或第三本目录。

先让旧的非协作群提示断言失败，再改生产代码。相关回复入口测试通过即可；本方案不替代真实模型和重启验收。

## 明确不做

- 不把 `ChatType === "group"` 解释成普通群聊并保留其提示词。
- 不把知识、学习、身份、技能快照的读取搬进 context。
- 不把 `DeliveryToolSideEffect` 的写入放进投影函数。
- 不在本阶段重写 `buildAgentSystemPrompt` 或合并消息编译。
- 不新增 `assembleEverything`。
