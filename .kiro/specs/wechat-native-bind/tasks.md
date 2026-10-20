# Implementation Plan: 个人微信 native bind

## Overview

阶段二：前台绑定本机已有微信登录态。探测 sidecar，已登录则用 wxid 创建 identity/grant/route；未登录只提示本机登录，不触发 QR。

## Agents

- cursor-grok · role: owner · scope: wechat personal native bind-existing RPC and employee form · paths: .kiro/specs/wechat-native-bind/tasks.md, src/gateway/user-operational-identity-wechat/bind-existing.ts, src/gateway/user-operational-identity-wechat/index.ts, src/gateway/user-operational-identity-wechat-personal.test.ts, src/gateway/server-methods/user-operational-identity.ts, src/gateway/server-methods-list.ts, src/gateway/method-scopes.ts, src/gateway/platform-auth/session-domain.ts, ui/src/ui/controllers/user-operational-identity.ts, ui/src/ui/controllers/user-operational-identity-wechat-personal.node.test.ts, ui/src/ui/ports/employee/views/workbench-operational-identity-forms.ts, ui/src/ui/ports/employee/views/workbench-operational-identity-forms.wechat-personal.node.test.ts, ui/src/ui/ports/employee/views/workbench-stage-contracts.ts, ui/src/ui/ports/employee/views/workbench-types.ts, ui/src/ui/ports/employee/views/workbench.ts, ui/src/ui/ports/employee/render-model.ts, ui/src/ui/app.ts, ui/src/ui/app-view-state-shell-slices.ts, ui/src/styles/workbench.css, skills/wechat-personal-ops/SKILL.md, skills/wechat-personal-ops/references/adapter-wechatuse.md, skills/wechat-personal-catalog/SKILL.md, skills/wechat-personal-worker-setup/SKILL.md, skills/wechat-use/SKILL.md · since: 2026-09-09

## Tasks

- [x] 新增 `user-operational-identity.wechat-personal.bind-existing`，复用 `bindWechatPersonalIdentityFromWxid()`。 — cursor-grok
- [x] 前台改为 native 登录态绑定，不再触发 QR。 — cursor-grok
- [x] 写锁外 probe，写锁内只写 identity store。 — cursor-grok
- [x] 从本 PR 移除 credentials.bind/verify session-domain 顺带改动。 — cursor-grok
- [x] 普通用户指引改为 bind-existing，不再写 Telegram 激活。 — cursor-grok
- [x] 未登录/离线时展示通道自检步骤和重新检测。 — cursor-grok
