# Tasks — Production Agent Runtime Safety

## Overview

本任务处理 2026-07-19 `bot-skill` 在生产网关容器内执行 `kill -TERM 1`
导致共享网关停机的事故，范围仅包含运行时防护、生产容器自恢复和回归验证。

## Agents

- codex-runtime-safety · role: owner · scope: prevent internal agents from terminating the production gateway and make production containers self-recovering · paths: `.kiro/specs/production-agent-runtime-safety/**`, `src/agents/bash-tools.exec.ts`, `src/agents/bash-tools.exec-protected-process.ts`, `src/agents/bash-tools.exec-protected-process.test.ts`, `deploy/production/Dockerfile.runtime-safety-v69`, `deploy/production/cutover-README.md`, `deploy/production/RELEASE_RECORD.md`, `deploy/production/proxy/README.md` · since: 2026-07-19

## Tasks

- [x] 1. 恢复生产网关并验证三域名健康端点；admin/biz/gw 均为 200。— codex-runtime-safety
- [x] 2. 修正无沙箱时绕过 gateway 审批的默认路由，并增加 PID 1 信号操作硬拦截和回归测试。— codex-runtime-safety
- [x] 3. 修正生产切换/回滚命令，v69 已上线且使用 `restart=unless-stopped`，v68 回滚容器已保留。— codex-runtime-safety
- [x] 4. 生产全局 exec 已设为 `gateway + allowlist + always`，并禁用 elevated。— codex-runtime-safety
- [x] 5. 独立验收发现并修复 shell wrapper 绕过；聚焦测试 41/41，边缘 smoke 9/9。全量 tsgo 和 plugin-sdk dts 仍被已有非本任务错误阻断；运行时 bundle 生成、CLI 启动和镜像防护检查通过。— codex-runtime-safety
- [x] 6. v69 与 v68 对比验收：Control UI 摘要一致，qiaomu-cut/ffmpeg 保留，三域名 healthz 200；`readyz` 的 WeCom 503 在 v68/v69 上均可复现，记为独立遗留项。— codex-runtime-safety
