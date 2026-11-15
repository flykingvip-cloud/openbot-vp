# 真实任务接缝修复

## Agents

- codex-runtime-manager · role: owner · scope: 最新主干隔离修复成果根、群快照和协议契约 · paths: .kiro/specs/runtime-three-role-live-seams/\*\* · since: 2026-11-15

## Tasks

- [x] 复现并修复本地成果根解析，同时保留 managed 失身份 fail-closed
- [x] 群无业务变化同步不应使提案过期，真实变化仍拒旧提案
- [x] 原生交互输出模式按 kind 保持互斥，不放松主链准入
- [ ] 定向回归、最新构建及隔离真实复测；不部署生产

原现场：726bfc53 / 隔离19101，日志在 /tmp/openbot-live-uat-726bfc53-20261115。当前修复基线8aa10c0c含#297，原树registry WIP完整保留。— codex-runtime-manager

## 2026-11-15 checkpoint

- 成果root和群状态两项红例已复现，协议schema 4FAIL/3PASS已复现；最新定向79PASS，chat单独21PASS，构建三次通过，8变更文件lint0错误。— codex-runtime-manager
- 真实文件复测：deliverablePublish=delivered/registered/readable，hash与preview相同；真实长任务完成原板准入和计划/报告交付。— codex-runtime-manager
- 真实群复测：快照不再误拒，已进入原成员链；后续GROUP_TASK_ACTIVATION_FORBIDDEN仍开放，未绕过角色授权，未假称组任务闭环。— codex-runtime-manager
- 所有构建与实测仅19101隔离环境。原18789未重启；前次主干审计构建曾自动同步现有UI目录，本次修复构建显式配置只同步本工作树。— codex-runtime-manager
- 完整tsgo本机依赖环境仍有既有117类可选依赖/类型诊断，本轮变更文件无诊断；不称全库绿。日志在/tmp/runtime-live-seams-\*。— codex-runtime-manager

## 2026-11-16 verified handoff

- 本轮三项有限修复已完成真实复测，6个单流源码/回归提交收口；登记册保留原任务所有路径/历史，仅精确共享落地指向本轮owner，未提交原共享registry。— codex-runtime-manager
- 最终两首要问题：文件可读登记/hash一致；群从伪过期进入原成员路径。协议schema收紧后，真实长任务已写板并产出计划/报告。— codex-runtime-manager
- 长任务TaskOutcome为awaiting_acceptance，delivery=delivered，看板unfinished=true；原验收仅支持明确checks，本次五条自然语言条件未提供可自动验收checks，未伪造通过。不能称任务闭环完成，需后续梳理验收和用户可见状态。— codex-runtime-manager
- 协作正式任务被write_acl拒绝；CLI token客户端只有设备身份，无authenticatedSessionSubjects服务端成员主体，设备ID夹具不能代替服务端认证用户。成员已能讨论，不代表有建任务权限，下一轮需真实登录测试主体，不允许靠connect.user伪造授权。— codex-runtime-manager
- 尚未修复/未宣称：组终稿、停止级联、无归属远端取消、真实PPT/外发。仍需在有合法主体的隔离环境完成场景。— codex-runtime-manager
