# OpenBot 业务逻辑、关键流程与核心技术细节

## 1. 文档目的

本文用于梳理 OpenBot 在真实运行时的核心业务逻辑，重点回答以下问题：

- 用户消息是如何进入系统并被路由到正确 Agent / Session 的
- 系统如何理解用户需求
- 系统如何筛选、暴露并匹配 Skills
- Agent 执行循环如何组织模型、工具、上下文、会话和流式输出
- 工具策略、沙箱、记忆、插件和多 Agent 机制如何影响实际行为

本文以当前代码实现为准，不采用“概念上可能如此”的推断。

## 2. 总体架构结论

OpenBot 不是“先做意图分类，再把任务路由到某个技能”的传统工作流，而是一个由 OpenBot 自己编排的嵌入式 Agent Runtime：

1. 多渠道输入先经过统一 Gateway / Auto-reply 入口。
2. 系统先用规则层处理显式命令、权限、会话、模型覆盖、群聊策略、路由策略。
3. 系统补充上下文，包括工作区 bootstrap 文件、记忆工具提示、媒体理解、链接理解、群聊上下文等。
4. 系统构造 OpenBot 自己的 system prompt，附带当前可用技能清单和工具清单。
5. 模型在该 prompt 约束下决定是否读取某个 `SKILL.md`、是否调用工具、如何回复用户。
6. 工具调用、流式输出、会话持久化、超时、补偿和重试都由 OpenBot Runtime 负责。

一句话概括：

> OpenBot 的任务理解机制是“规则预处理 + 上下文增强 + 技能候选集过滤 + 模型在 system prompt 约束下自主选择技能与工具执行”。

## 3. 核心组件

### 3.1 输入与入口层

OpenBot 支持多种消息入口：

- CLI
- Gateway RPC / WebSocket
- WhatsApp
- Telegram
- Discord
- Slack
- Signal
- iMessage
- 以及部分插件渠道

这些入口最终会汇入统一的 Agent 执行链路，而不是每个渠道维护一套独立执行引擎。

### 3.2 路由与会话层

OpenBot 的第一核心对象不是“聊天窗口”，而是 `sessionKey`。

系统会基于以下信息决定请求进入哪个 Session：

- `agentId`
- 渠道 `channel`
- 账号 `accountId`
- 对端身份 `peer`
- 是否群聊 / 频道 / 线程
- `session.dmScope`
- 多 Agent bindings / route 规则

这一步决定的是：

- 这条消息属于哪个 Agent
- 是否复用已有上下文
- 是否进入主会话、私聊隔离会话、群组会话或线程会话

### 3.3 Agent Runtime 层

OpenBot 使用的是“OpenBot-owned”的 Agent Runtime。

虽然底层复用了 `@mariozechner/pi-coding-agent` / `pi-agent-core` 的部分能力，但以下内容由 OpenBot 自己控制：

- system prompt 组装
- skill snapshot
- 工具注册与策略过滤
- session 文件管理
- sandbox 解析
- plugin / hook 接入
- 流式事件桥接
- tool result 截断与上下文压缩
- 出站消息投递与去重

### 3.4 技能层

Skills 是给模型提供“任务处理方法”的说明，不是一个独立的代码执行框架。

Skill 的核心结构是目录中的 `SKILL.md`，通常包含：

- `name`
- `description`
- `metadata.openbot.*`
- 可选的用户命令定义

### 3.5 工具层

真正能执行动作的是 Tools，不是 Skills。

典型工具包括：

- 文件工具：`read` / `write` / `edit` / `apply_patch`
- 运行时工具：`exec` / `process`
- Web 工具：`web_search` / `web_fetch`
- Session 工具：`sessions_list` / `sessions_send` / `sessions_spawn`
- Messaging 工具：`message`
- Memory 工具：`memory_search` / `memory_get`
- Browser / Canvas / Nodes / Cron / Gateway 等

Skill 的作用通常是教模型“何时、如何、按什么步骤使用这些工具”。

## 4. 用户需求理解机制

### 4.1 不是单独的意图分类器

OpenBot 没有一个中心化的“intent classifier”先把用户请求打成标签，再硬路由给某个 skill。

真实实现是两段式：

- 第一段：规则层解析显式结构化需求
- 第二段：模型在 system prompt 约束下理解开放式自然语言需求

### 4.2 第一段：规则层理解

在进入模型前，系统会优先处理以下内容：

- slash commands
- inline directives，例如思考级别、verbose、model override、queue mode
- sender 权限与 allowlist
- group / DM 策略
- session reset / session continuation
- channel-level model override
- skill filter

这一步属于确定性逻辑，目标是先把“命令性需求”和“运行时控制信息”剥离出来。

### 4.3 第二段：上下文增强

在真正调用模型前，系统会尽量把用户消息补成“对模型更可理解的输入”：

- 媒体理解：图片、音频、视频、附件内容补充进上下文
- 链接理解：抽取和格式化链接内容摘要
- 工作区 bootstrap 文件注入
- 群聊上下文 / 提及信息 / 线程上下文
- System events
- 当前 Session 历史

### 4.4 第三段：模型驱动的开放式理解

当消息不是纯命令时，最终的“用户到底想做什么”是由模型完成理解的。

但模型不是裸跑，它看到的是 OpenBot 构造的上下文：

- 工具清单
- Skills 清单
- Workspace 信息
- 安全规则
- 记忆使用规则
- 文档路径
- 渠道能力
- Session 历史

因此，OpenBot 的“需求理解”本质上是：

> 先把结构化运行控制做好，再把高质量执行上下文交给模型理解。

## 5. Skills 机制与匹配逻辑

### 5.1 Skill 来源

Skill 不是只有三层来源，真实实现比“三层模型”更丰富。

主要来源包括：

- Bundled skills
- Managed skills：`~/.openbot/skills`
- Workspace skills：`<workspace>/skills`
- `skills.load.extraDirs`
- `~/.agents/skills`
- `<workspace>/.agents/skills`
- 插件声明的 skill 目录

实际优先级是后者覆盖前者，而不是简单三层。

### 5.2 Skill 筛选条件

Skill 不会无条件暴露给模型。系统会按以下条件筛选：

- `enabled: false`
- bundled allowlist
- 平台 `os`
- `requires.bins`
- `requires.anyBins`
- `requires.env`
- `requires.config`
- 远端节点可用性（如 macOS remote node）
- agent 级 skill filter
- channel / run 级 skill filter

最终只有“当前运行环境下真正可用”的 skill 才会进入本轮 prompt。

### 5.3 Skill 不是自动执行，而是先进入技能清单

系统会把 eligible skills 转成紧凑的 `<available_skills>` 列表，其中包含：

- skill name
- description
- `SKILL.md` 路径

然后在 system prompt 中明确告诉模型：

- 先扫描 `<available_skills>` 的 description
- 如果只有一个 skill 明显匹配，就去读那个 `SKILL.md`
- 如果多个都可能，选最具体的一个
- 如果没有明显匹配，就不要读 skill
- 默认不要一上来读多个 skill

这说明 Skill 匹配主机制是：

> 先由 OpenBot 过滤候选 Skill，再由模型选择是否读取某个 Skill。

### 5.4 显式 Skill 命令是例外

如果用户显式触发某个 skill command，例如：

- `/skill <name>`
- Skill 自己暴露的 slash command

系统会先做确定性匹配：

- 找到对应 `SkillCommandSpec`
- 若配置了 `command-dispatch: tool`，直接调工具
- 否则把请求改写成 “Use the `<skill>` skill for this request.”

这条路径是确定性的硬匹配，不依赖模型先选 skill。

## 6. 关键执行流程

下面是一次普通用户消息的真实主流程。

### 6.1 渠道接收

渠道收到消息后，先完成：

- 渠道鉴权
- sender 识别
- allowlist / DM policy / group policy 检查
- 附件归一化
- 路由信息抽取

### 6.2 路由解析

系统根据 `agentId`、`channel`、`peer`、`accountId`、`dmScope` 等构建 `sessionKey`，并确定：

- 目标 Agent
- 目标 Session
- 是否主会话
- 是否群聊 / 线程 / 子 Agent 会话

### 6.3 会话初始化

系统加载或创建 Session 元数据：

- `sessionEntry`
- transcript file
- model override
- thinking / verbose 状态
- skills snapshot

这一步决定本轮是“新会话”还是“已有上下文的下一轮”。

### 6.4 指令与上下文预处理

系统会按顺序处理：

- 命令授权
- inline directives
- reset / new session
- media understanding
- link understanding
- pre-agent hooks
- group context
- system events

### 6.5 Skill Snapshot 构建

当 Session 首次运行，或 Skills watcher 检测到变化时，系统会生成 / 刷新 `skillsSnapshot`。

这个 snapshot 会缓存：

- 当前 prompt 用到的技能清单
- 当前 skill filter
- 解析后的 resolved skills
- snapshot version

它的作用是让同一会话中的技能集合保持稳定，不至于每轮漂移。

### 6.6 Runtime 组装

进入 `runEmbeddedPiAgent` / `runEmbeddedAttempt` 后，系统开始组装真正的执行环境：

- resolve workspace
- resolve sandbox
- apply skill env overrides
- build tools
- build docs/runtime info
- build bootstrap/context injection
- create session manager
- create agent session
- override system prompt

### 6.7 System Prompt 构造

OpenBot 的 system prompt 是运行时构造的，主要包含：

- Tooling
- Safety
- Skills
- Memory Recall
- Messaging
- Workspace
- Documentation
- Sandbox
- Runtime
- Reasoning / thinking guidance
- 注入的 bootstrap files

它不是 pi 默认 prompt，而是 OpenBot 自己的 prompt contract。

### 6.8 模型执行与工具循环

当 `activeSession.prompt(...)` 被调用后，模型开始真正执行一轮 Agent Loop：

1. 理解用户请求
2. 判断是否需要某个 Skill
3. 视情况读取 `SKILL.md`
4. 生成工具调用
5. 执行工具
6. 读取工具结果
7. 再次推理
8. 输出最终回复或继续调用工具

这就是 OpenBot 的核心 Agentic Loop。

### 6.9 流式输出与持久化

执行期间，系统会把事件桥接成统一流：

- `lifecycle`
- `assistant`
- `tool`

然后根据渠道能力和当前模式做：

- partial reply
- block reply
- tool result summary
- messaging-tool 去重
- final payload delivery
- session transcript 落盘
- usage / token 统计

## 7. 工具策略、沙箱与安全模型

### 7.1 Tool Profile 和 Skill 匹配不是一回事

OpenBot 里确实存在：

- `minimal`
- `coding`
- `messaging`
- `full`

但它们属于 Tool Catalog / Tool Policy 范畴，用于控制某类会话默认能看到哪些工具。

它们不是主要的 Skill 匹配系统。

### 7.2 沙箱是可配置机制，不是默认“非主会话必沙箱”

OpenBot 支持 Docker-based sandbox，但是否启用取决于：

- `agents.defaults.sandbox.mode`
- `agents.list[].sandbox.mode`

主要模式有：

- `off`
- `non-main`
- `all`

因此：

- 可能所有会话都在主机上执行
- 也可能只有 non-main 会话被沙箱化
- 也可能所有会话都沙箱化

不能笼统说“主会话完全访问主机，非主会话都在 Docker”。

### 7.3 Tool Policy 与 Elevated 是独立层

系统需要同时区分三件事：

- Tool policy：哪些工具允许出现
- Sandbox：工具在哪里执行
- Elevated：sandbox 场景下 exec 是否可以逃逸到主机

这三层共同决定最终执行权限。

## 8. 记忆与上下文管理

### 8.1 工作区记忆

Workspace 中的重要文件包括：

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `IDENTITY.md`
- `USER.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md`
- `MEMORY.md`
- `memory/*.md`

其中：

- bootstrap 文件会被注入 prompt
- `memory/*.md` 主要通过 memory tools 按需读取
- subagent 默认只注入 `AGENTS.md` 和 `TOOLS.md`

### 8.2 语义记忆

OpenBot 提供：

- `memory_search`
- `memory_get`

并通过 system prompt 告诉模型，在回答“历史决策、偏好、人物、日期、todo”等问题前，应优先使用 memory tools。

注意，这不表示系统总会自动先做语义检索；是否调用工具仍取决于模型在当前上下文下的决策。

### 8.3 Context Engine

OpenBot 支持可插拔 Context Engine Slot。

它可以参与：

- assemble
- ingest / ingestBatch
- afterTurn
- compact 相关处理

但它不是唯一上下文来源，也不是整个需求理解的唯一核心。

## 9. 多 Agent 与隔离机制

多 Agent 模式下，每个 Agent 可拥有独立：

- workspace
- session store
- auth profiles
- sandbox policy
- tools policy
- skills filter
- bindings

因此 OpenBot 的多 Agent 不是“同一个脑子换 persona”，而是更接近“多个隔离的运行域共享一个 Gateway 进程”。

## 10. 插件、Hooks 与扩展点

OpenBot 提供多层扩展机制：

- 插件 skills
- plugin hooks
- context-engine slot
- memory slot
- 内部 hooks

常见 hook 点包括：

- `before_model_resolve`
- `before_prompt_build`
- `before_tool_call`
- `after_tool_call`
- `tool_result_persist`
- `agent_end`
- `message_received`
- `message_sending`

这意味着很多“业务逻辑”不仅来自主代码，也可能来自插件和 hook 注入。

## 11. 最值得记住的实现事实

### 11.1 对“需求理解”的最准确认识

OpenBot 不是“规则引擎全懂用户需求”，而是：

- 规则层负责运行控制
- 模型负责开放式任务理解
- system prompt 决定模型是在什么约束下理解任务

### 11.2 对“技能匹配”的最准确认识

OpenBot 不是“代码里硬编码意图到 skill 的映射”，而是：

- 系统先过滤出当前环境下可用的 skills
- 把技能清单与选择规则写进 system prompt
- 模型决定是否读取某个 `SKILL.md`

### 11.3 对“执行引擎”的最准确认识

OpenBot 不是简单聊天机器人，也不是纯粹的 pi 外壳。

它是一个围绕 Session、Route、Tools、Skills、Sandbox、Streaming、Persistence 构建的 Agent Runtime Orchestrator。

## 12. 对后续 Provider / Gateway 集成设计的启示

如果要在 OpenBot 中接入新的 Provider 或 Gateway，不能只看“怎么调模型 API”，还必须同时考虑：

- 它如何进入当前模型注册和认证体系
- 它是否影响 system prompt 的能力声明
- 它是否支持现有工具调用模型
- 它如何参与流式输出
- 它如何影响 transcript policy、tool schema、上下文压缩和重试
- 它是否需要额外的 channel / session / sandbox 适配

对 OpenBot 来说，Provider 接入只是执行链路的一部分，而不是全部。
