# Tasks — Platform Pricing Gateway Instability

## Overview

本任务用于承接 2026-06 平台 pricing / gateway instability incident 的剩余后端修复，
仅覆盖网关连接恢复、会话握手补强与 legacy LaunchAgent 清理，不包含共享热文件上的 UI 收口。

## Agents

- codex-pricing-incident · role: owner · scope: gateway incident backend mitigation and recovery cleanup · paths: `src/daemon/launchd.ts`, `src/daemon/launchd.test.ts`, `src/gateway/server/ws-connection.ts`, `src/gateway/server/ws-connection/message-handler.ts`, `.kiro/specs/platform-pricing-gateway-instability/tasks.md` · since: 2026-06-25

## Tasks

- [x] 1. 将 `ai.openbot.gateway.recovery` 纳入 legacy LaunchAgent 检测与清理路径 — codex-pricing-incident
- [x] 2. 为 WebSocket 响应增加 raw send fast-path，避免大 payload 在高频 overview 场景下重复 stringify — codex-pricing-incident
- [x] 3. 在 webchat connect 握手阶段复用平台会话，确保登录后客户端数据装载与会话同步链路一致 — codex-pricing-incident
