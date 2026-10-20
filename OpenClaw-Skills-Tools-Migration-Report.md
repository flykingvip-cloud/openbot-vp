# OpenBot 技能和工具迁移分析报告

## 概述

本报告分析了 OpenBot 系统中的技能（Skills）和工具（Tools）生态系统，为迁移到另一个产品提供详细的技术指导。OpenBot 采用了模块化的架构，包含 50+ 个技能和 40+ 个扩展插件。

## 系统架构概览

### 核心组件结构

```
openbot/
├── skills/           # 技能目录 (50+ 个技能)
├── extensions/       # 扩展插件 (40+ 个插件)
├── src/
│   ├── plugin-sdk/   # 插件开发 SDK
│   ├── agents/       # 代理系统核心
│   ├── config/       # 配置管理
│   └── ...
└── package.json      # 核心依赖
```

## 技能系统 (Skills)

### 技能列表 (50个)

1. **开发工具类**
   - `coding-agent` - 代码开发代理
   - `github` - GitHub 操作
   - `gh-issues` - GitHub 问题管理
   - `skill-creator` - 技能创建工具

2. **生产力工具类**
   - `1password` - 密码管理
   - `apple-notes` - Apple 笔记
   - `apple-reminders` - Apple 提醒事项
   - `bear-notes` - Bear 笔记应用
   - `notion` - Notion 集成
   - `obsidian` - Obsidian 笔记
   - `things-mac` - Things 任务管理
   - `trello` - Trello 项目管理

3. **通信工具类**
   - `discord` - Discord 集成
   - `slack` - Slack 集成
   - `imsg` - iMessage 集成
   - `himalaya` - 邮件客户端

4. **媒体处理类**
   - `openai-image-gen` - AI 图像生成
   - `openai-whisper` - 语音转文字
   - `openai-whisper-api` - Whisper API
   - `sherpa-onnx-tts` - 文字转语音
   - `video-frames` - 视频帧处理
   - `camsnap` - 摄像头截图

5. **智能家居类**
   - `openhue` - Philips Hue 灯光控制
   - `sonoscli` - Sonos 音响控制
   - `spotify-player` - Spotify 播放器

6. **系统工具类**
   - `tmux` - 终端复用器
   - `healthcheck` - 健康检查
   - `session-logs` - 会话日志
   - `model-usage` - 模型使用统计

### 技能结构分析

每个技能都遵循标准结构：

```
skills/<skill-name>/
└── SKILL.md          # 技能定义文件（包含元数据和文档）
```

#### SKILL.md 文件结构

```markdown
---
name: skill-name
description: 技能描述
homepage: 官方网站
metadata:
  openbot:
    emoji: 🔧
    os: ["darwin", "linux", "win32"] # 支持的操作系统
    requires:
      bins: ["command1", "command2"] # 需要的命令行工具
    install: # 安装指令
      - id: brew
        kind: brew
        formula: package-name
        bins: ["command"]
        label: 安装描述
---

# 技能文档内容
```

## 扩展系统 (Extensions)

### 扩展列表 (40个)

1. **通信渠道扩展**
   - `discord` - Discord 频道
   - `slack` - Slack 频道
   - `telegram` - Telegram 频道
   - `matrix` - Matrix 协议
   - `msteams` - Microsoft Teams
   - `whatsapp` - WhatsApp
   - `signal` - Signal 消息
   - `imessage` - iMessage
   - `googlechat` - Google Chat
   - `feishu` - 飞书
   - `wecom` - 企业微信
   - `line` - Line 消息
   - `irc` - IRC 协议
   - `nostr` - Nostr 协议
   - `twitch` - Twitch 集成
   - `zalo` - Zalo 消息
   - `nextcloud-talk` - Nextcloud Talk
   - `synology-chat` - 群晖聊天
   - `mattermost` - Mattermost

2. **功能扩展**
   - `memory-core` - 核心内存管理
   - `memory-lancedb` - LanceDB 内存存储
   - `voice-call` - 语音通话
   - `talk-voice` - 语音对话
   - `phone-control` - 手机控制
   - `device-pair` - 设备配对
   - `diagnostics-otel` - OpenTelemetry 诊断
   - `diffs` - 差异比较
   - `thread-ownership` - 线程所有权
   - `llm-task` - LLM 任务处理

3. **认证扩展**
   - `google-gemini-cli-auth` - Google Gemini CLI 认证
   - `minimax-portal-auth` - MiniMax 门户认证
   - `qwen-portal-auth` - 通义千问门户认证

4. **特殊功能**
   - `copilot-proxy` - Copilot 代理
   - `lobster` - Lobster 集成
   - `open-prose` - 开放散文
   - `acpx` - ACP 扩展
   - `bluebubbles` - BlueBubbles 集成
   - `tlon` - Tlon 集成

### 扩展结构分析

每个扩展都有标准结构：

```
extensions/<extension-name>/
├── package.json      # 扩展配置和依赖
├── index.ts         # 扩展入口点
└── src/             # 源代码目录
```

#### package.json 扩展配置

```json
{
  "name": "@openbot/extension-name",
  "version": "2026.3.9",
  "openbot": {
    "extensions": ["./index.ts"],
    "channel": {
      "id": "channel-id",
      "label": "显示名称",
      "docsPath": "/channels/path",
      "order": 70
    },
    "install": {
      "npmSpec": "@openbot/extension-name",
      "localPath": "extensions/extension-name"
    }
  }
}
```

## 核心基础设施

### 1. Plugin SDK (`src/plugin-sdk/`)

- **功能**: 为技能和扩展提供统一的 API 接口
- **关键文件**:
  - `index.ts` - 主要 API 导出
  - `core.ts` - 核心功能
  - `types.ts` - 类型定义
- **依赖**: TypeScript, Node.js 22+

### 2. 代理系统 (`src/agents/`)

- **功能**: 管理 AI 代理的生命周期和通信
- **关键组件**:
  - ACP (Agent Communication Protocol) 支持
  - 会话管理
  - 代理生成和控制
- **依赖**: `@agentclientprotocol/sdk`

### 3. 配置系统 (`src/config/`)

- **功能**: 统一的配置管理
- **支持格式**: JSON5
- **配置类型**:
  - 技能配置 (`types.skills.ts`)
  - 插件配置 (`types.plugins.ts`)
  - 渠道配置等

### 4. 通信渠道系统 (`src/channels/`)

- **功能**: 多渠道消息处理
- **支持协议**: Discord, Slack, Telegram, Matrix 等
- **架构**: 插件化设计，每个渠道都是独立插件

## 核心依赖分析

### 主要运行时依赖

```json
{
  "@agentclientprotocol/sdk": "0.15.0",
  "@mariozechner/pi-coding-agent": "0.57.1",
  "@sinclair/typebox": "0.34.48",
  "commander": "^14.0.3",
  "express": "^5.2.1",
  "grammy": "^1.41.1",
  "hono": "4.12.7",
  "jiti": "^2.6.1",
  "playwright-core": "1.58.2",
  "sharp": "^0.34.5",
  "undici": "^7.22.0",
  "ws": "^8.19.0",
  "zod": "^4.3.6"
}
```

### 开发依赖

```json
{
  "@types/node": "^25.3.5",
  "typescript": "^5.9.3",
  "vitest": "^4.0.18",
  "oxlint": "^1.51.0",
  "oxfmt": "0.36.0"
}
```

### 系统要求

- **Node.js**: >= 22.12.0
- **包管理器**: pnpm 10.23.0
- **TypeScript**: 5.9.3+
- **操作系统**: macOS, Linux, Windows

## 迁移建议

### 1. 核心基础设施迁移优先级

**高优先级 (必须迁移)**

1. Plugin SDK (`src/plugin-sdk/`) - 提供统一 API
2. 配置系统 (`src/config/`) - 管理技能和扩展配置
3. 代理系统核心 (`src/agents/`) - AI 代理管理

**中优先级 (按需迁移)**

1. 通信渠道系统 (`src/channels/`) - 如需多渠道支持
2. 会话管理 (`src/sessions/`) - 会话持久化
3. 工具系统 (`src/tools/`) - 工具调用框架

**低优先级 (可选)**

1. 特定平台功能 (macOS/iOS 特有功能)
2. 高级诊断工具
3. 性能监控组件

### 2. 技能迁移策略

**按类别迁移**

1. **开发工具类** - 优先迁移，通用性强
2. **生产力工具类** - 用户价值高
3. **通信工具类** - 根据目标平台需求
4. **媒体处理类** - 技术复杂度较高
5. **智能家居类** - 特定用户群体

**迁移步骤**

1. 复制 `SKILL.md` 文件
2. 验证依赖的命令行工具可用性
3. 测试技能功能
4. 更新配置和元数据

### 3. 扩展迁移策略

**核心扩展 (必须)**

- `memory-core` - 内存管理
- `llm-task` - LLM 任务处理
- `diagnostics-otel` - 诊断功能

**通信扩展 (按需)**

- 根据目标产品的通信需求选择相应扩展
- 每个扩展都有独立的依赖和配置

**认证扩展 (按需)**

- 根据支持的 AI 服务选择相应认证扩展

## 技术实施指南

### 1. 环境准备

```bash
# 安装 Node.js 22+
# 安装 pnpm
npm install -g pnpm@10.23.0

# 克隆源码
git clone https://github.com/gmood2008/openbot.git
cd openbot

# 安装依赖
pnpm install
```

### 2. 构建系统

```bash
# 构建项目
pnpm build

# 运行测试
pnpm test

# 代码检查
pnpm check
```

### 3. 技能系统集成

```typescript
// 技能加载示例
import { loadSkills } from "./src/config/skills";

const skillsConfig = {
  extraDirs: ["./custom-skills"],
  watch: true,
  entries: {
    github: { enabled: true },
    "coding-agent": { enabled: true },
  },
};

const skills = await loadSkills(skillsConfig);
```

### 4. 扩展系统集成

```typescript
// 扩展加载示例
import { loadExtensions } from "./src/plugins";

const extensions = await loadExtensions({
  enabledExtensions: ["discord", "slack", "memory-core"],
});
```

## 风险评估

### 高风险项

1. **依赖兼容性** - 某些依赖可能与目标环境不兼容
2. **平台特定功能** - macOS/iOS 特有功能需要替代方案
3. **配置复杂性** - 配置系统较为复杂，需要仔细迁移

### 中风险项

1. **API 变更** - Plugin SDK API 可能需要适配
2. **性能影响** - 大量技能和扩展可能影响性能
3. **测试覆盖** - 需要全面测试迁移后的功能

### 低风险项

1. **文档迁移** - 技能文档相对独立
2. **配置文件** - JSON5 格式通用性好
3. **核心逻辑** - TypeScript 代码可移植性强

## 建议的迁移时间线

### 第一阶段 (2-3周)

- 迁移核心基础设施 (Plugin SDK, 配置系统)
- 迁移 10-15 个核心技能
- 迁移 5-8 个核心扩展

### 第二阶段 (3-4周)

- 迁移剩余技能 (按优先级)
- 迁移剩余扩展
- 集成测试和调试

### 第三阶段 (1-2周)

- 性能优化
- 文档更新
- 用户验收测试

## 总结

OpenBot 的技能和工具系统设计良好，模块化程度高，为迁移提供了良好的基础。建议采用分阶段迁移策略，优先迁移核心基础设施和高价值技能，然后逐步扩展到完整的生态系统。

关键成功因素：

1. 保持 Plugin SDK 的 API 兼容性
2. 确保配置系统的正确迁移
3. 充分测试每个迁移的组件
4. 维护良好的文档和示例

通过遵循本报告的建议，执行团队应该能够成功地将 OpenBot 的技能和工具生态系统迁移到新产品中。
