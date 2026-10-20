---
name: user-guidance-protocol
description: "大白管家标配：上下文感知式用户陪伴协议。当 AI 无法直接操作用户界面时，通过上下文定位、置信度判断、导航状态机、视觉描述与分步确认，引导用户完成配置；并在完成/失败时沉淀可复用路径。一步一确认只用于代理点不了的界面导航，不要用于已经派下的写作、调研、技能草稿。触发：用户自己点界面配置公众号、安装技能、系统设置、绑定账号、导入导出、找不到按钮/怎么配等。数字人扫码代写公众号 AppID / AppSecret / IP 白名单走 wechat-official-credential。"
metadata:
  openclaw:
    always: false
    emoji: "🧭"
  version: "2.0"
  category:
    - interaction
    - navigation
    - onboarding
  capabilities:
    - context_detection
    - visual_navigation
    - step_guidance
    - error_recovery
    - asset_incubation
  not_responsible_for:
    - executing_external_actions
    - changing_user_configuration_automatically
  priority: high
---

# 用户引导协议 v2 🧭

核心准则：**永远不给「教程」，只给「带路」。**

定位：面向 Agent 的上下文感知式导航协议——理解用户在哪、判断下一步、陪用户完成任务、把成功路径沉淀为资产。

## 适用范围

一步一确认只用于代理点不了的界面导航：用户自己点菜单、找按钮、填后台页面。

不要用于已经派下的写作、调研、技能草稿。那些任务里已经说清的内部步骤（检索、起草、改一节、换格式、再出一版、继续写、改标题、出下一节）直接做。

可执行任务的默认行为以系统提示中的 MainPath 执行契约为准；细则见技能 `execution-discipline`（standby，非 always）。本协议不得把「一步一确认」扩大到建会、开云电脑、工具调用等已派下执行类任务。

高风险动作仍须先确认，但不靠本协议逐步带路：对外发送、广播、外部写入、删除、发布、改权限、写凭证、重置密钥、不可逆覆盖。

## 与私有数字身份智能化编排

用户要「大白帮我配数字身份 / 绑定账户 / 完善授权」且明确授权代配时：优先加载 **`oi-orchestrate-personal-identity`**（默认推荐 `verified_live`；再委派 `oi-bind-wechat-official` / `oi-bind-personal-email` / `oi-bind-github-personal` / `oi-bind-xiaohongshu` 等社媒 oi-bind-* / `oi-grant-owned-bots`）。本协议仍用于**用户自己点界面**的带路；公众号扫码代写底层仍是 `wechat-official-credential`。微信个人号非云电脑主路径，见 `oi-bind-wechat-personal`（委派 `wechat-personal-worker-setup`）。


## 架构

```
User Request
  → Context Detector (+ contextConfidence)
  → Navigation Planner (NavigationState)
  → Step Executor (actionRisk + 一步一确认)
  → Feedback Collector (Issue Classification)
  → Asset Incubation Event
```

## 一、Context Detector

用户发出需求后，按优先级定位上下文：

1. **浏览器扩展** → `browser(action="tabs", profile="chrome")`
2. **节点检测** → `nodes(action="status")`（可截图/屏幕共享）
3. **会话线索** → 历史是否提到当前页面/后台
4. **平台推断** → 控制台 / 公众号后台 / 飞书等

### contextConfidence（必须输出）

| 级别     | 条件                             | 行为                      |
| -------- | -------------------------------- | ------------------------- |
| `high`   | Chrome Tab / 截图 / 明确页面信号 | 直接导航，不假设性确认    |
| `medium` | 仅会话或身份推断                 | 先确认 1 个视觉锚点再继续 |
| `low`    | 全部失败                         | 进入场景选择模式          |

**禁止**：在 `medium`/`low` 下假装已确定页面。

### 场景选择模式（low）

不要问「你在哪」，给出三条递进路径：

```
你当前可能在操作以下场景之一（选一个，我带你走）：
A. 公众号后台（mp.weixin.qq.com）
B. OpenBot 平台页面
C. 其他页面 / 我不太确定
```

## 二、NavigationState（会话内状态机）

引导开始后，在会话中维护（可用记忆或回复前自检），用户说「我已经配好了」时从 `completed` 续跑，禁止重开。

字段对齐 YAML：`currentStage` = `stages[].id`，`completed` / `nextAction` = `steps[].id`。

```yaml
currentScenario: wechat_oa_setup # scenario.name
currentStage: developer_credentials # stages[].id（不是 step id）
completed: [login, enter_settings] # steps[].id
nextAction: enable_app_secret # steps[].id
confidence: medium # 同步 contextConfidence
exceptions: 0
```

阶段推进：仅当用户给出 `success_signal` 对应确认后，才把当前 step 写入 `completed` 并更新 `nextAction`。

## 三、Step Executor

### 沟通规范

1. **一步一确认**（默认，仅界面导航）— 每条消息一个操作；用户回复「好了/下一步」再继续。已经派下的写作、调研、技能草稿不要套用本条。
2. **不说套话** — 禁止「请查看/请参考」；只说具体点击位置
3. **视觉描述** — 「左侧灰色菜单栏倒数第 2 个齿轮」优于「导航栏」
4. **预期引导** — 告诉点击后会看到什么

### actionRisk（可覆盖「一步一确认」）

| 风险     | 示例                               | 规则                          |
| -------- | ---------------------------------- | ----------------------------- |
| `low`    | 点击菜单、打开 Tab                 | 允许同条消息最多 2 个连续动作 |
| `medium` | 填写字段、保存非敏感配置           | 单步 + 确认                   |
| `high`   | 重置 AppSecret、删除、发布、改权限 | 必须二次确认；说明后果        |

### 指令模板

```
✅ 「看屏幕左侧灰色菜单，找到带齿轮⚙️的『设置与开发』，点它。
你会看到上方出现『公众号设置 / 基本配置』等 Tab。看到了告诉我。」

❌ 「请到后台完成开发者配置。」（模糊）
```

## 四、Issue Classification（找不到/失败时必做）

用户说「找不到按钮」等，先分类再动作——不要只重复描述：

| 原因码          | 判断线索                 | 动作                  |
| --------------- | ------------------------ | --------------------- |
| `ui_changed`    | 菜单名对不上、版本差异   | 重新识别 / 截图       |
| `permission`    | 灰显、无入口、权限提示   | 说明缺什么权限/角色   |
| `viewport`      | 移动端、精简视图、无侧栏 | 切换路径（☰ / 搜索） |
| `user_misread`  | 描述邻域文字后可定位     | 缩小视觉锚点          |
| `blocked_error` | 报错文案                 | 要截图或复制错误      |

## 五、场景 references（结构化）

员工工作台怎么点：先 Read 下表 YAML，再开口。禁止凭记忆编菜单。路径相对本 skill 目录，按 `steps[].id` 执行：

| 场景            | 文件                                     | 触发词                                                                                               |
| --------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 登录与外壳      | `references/employee-shell.yaml`         | 登录、工作台、侧栏、每日概览                                                                         |
| AI 助手         | `references/employee-assistant.yaml`     | AI 助手、大白、添加机器人、新建数字员工                                                              |
| 协作空间        | `references/employee-collaboration.yaml` | 协作空间、创建小组、拉人                                                                             |
| 我的任务        | `references/employee-tasks.yaml`         | 定时任务、待我处理、开发监督、新建任务                                                               |
| 知识宇宙        | `references/employee-knowledge.yaml`     | 知识宇宙、上传知识、我的资产、知识治理                                                               |
| 系统/个人设置   | `references/platform-settings.yaml`      | 系统设置、个人设置、我的机器人；旧词机器人管理/技能管理也走这份，但按文件里的新入口说                |
| 个人邮箱 Path B | `references/personal-email.yaml`         | 配邮箱、绑定邮箱、SMTP/IMAP                                                                          |
| 个人邮箱 Path C | `references/personal-email-browser.yaml` | 网页登录、授权码、126/163/QQ、不知道怎么拿凭证                                                       |
| 公众号配置      | `references/wechat-oa.yaml`              | 用户自己点：公众号、AppID、AppSecret、IP 白名单、草稿箱。数字人代操作走 `wechat-official-credential` |
| 导入导出        | `references/data-import-export.yaml`     | 导入、导出、CSV、Excel                                                                               |

员工大白工作区路径：`skills/user-guidance-protocol/references/...`（会话开始已同步）。

每步字段：`id` / `instruction` / `visual_anchor` / `success_signal` / `risk` / `on_fail`。

## 六、Asset Incubation + 可恢复进度（完成/失败时）

引导**完成**、某步**失败**或用户**放弃**后，调用工具 `guidance_event`（不要臆造 gateway RPC）：

```
guidance_event({
  event: "guidance_completed",   // 或 guidance_step_failed / guidance_abandoned
  scenario: "wechat_oa_setup",
  contextConfidence: "high",
  stepsCompleted: 8,
  exceptions: 1,
  reusablePattern: true
})
```

失败卡点示例：

```
guidance_event({
  event: "guidance_step_failed",
  scenario: "wechat_oa_setup",
  stepId: "enter_settings",
  failureReason: "button_missing",
  issueClass: "ui_changed",
  userAction: "searched",
  contextConfidence: "medium"
})
```

**禁止**在 `failureReason` / `userAction` 中写入 AppSecret、API Key 或其它密钥。

### 字段对齐（Gateway progress record · P1）

`guidance_event` 与 Gateway 权威进度（`guidance.progress.*`）字段对应关系：

| protocol / guidance_event | progress record                                             |
| ------------------------- | ----------------------------------------------------------- |
| `scenario`                | `scenario`                                                  |
| `stepId`                  | `currentStage`（失败/完成时写入）                           |
| `contextConfidence`       | `confidence`                                                |
| `stepsCompleted`          | `metadata.stepsCompletedHint`（不臆造 step id 列表）        |
| `event`                   | `lastGuidanceEventType` + `status`（completed / abandoned） |
| intent key                | `lastGuidanceEventId`                                       |

进度键（Gateway 权威，**禁止**仅用浏览器 localStorage）：`tenantId + userId + scope + entityId`。  
跨会话恢复请走 `guidance.progress.get` / `guidance.progress.applyEvent`；**不要**把进度写进 `GrowthStatus`。

## 七、沟通风格

- 开头：确认需求 → 立刻第一步
- 中间：每步 2–3 句（指令 + 预期）
- 收尾：确认完成 → 可选下一步 / 沉淀事件
- 语气：资深同事带新人；用户说「我自己来」立刻停

> 用户找你不是要说明书，是要有人带他走过去。
