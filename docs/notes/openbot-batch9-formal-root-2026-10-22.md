# 批次 9：Formal Root 收敛

| 项   | 值                                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------- |
| 日期 | 2026-10-22                                                                                                 |
| 仓库 | `flykingvip-cloud/openbot-vp`                                                                              |
| 祖先 | 实现前 `git fetch origin main`。分支自 `origin/main` `3c35aec19b5056a473ec2403408e31ed27b1df1a`            |
| 性质 | 交付写路径、结算、预览共用一个 formal root。不是部署授权。                                                 |
| 不做 | 不扩大 submit / self_advance / accept / finalize。不设生产演化旗。不新造第三套工作区。不授权 LIVE Path B。 |

`readable` / `confirmed` 仍只表示技术上读到了字节，不是业务 accepted。

## 现网证据

Skill孵化声明了 `output/pdf/收入增长是否等于经营改善.pdf`。界面是「文件暂未交付：文件缺失或为空」。发布账本 `failureReason=binary_requires_tool_write`，`settleStatus=unwritten`。同相对路径的约 1MB PDF 在 `operators/<user>/OpenBot/agents/bot-skill/workspace/` 下，平行的 `tenants/…/workspace` 树上没有这份文件。

## 根因

一个 bot 有两种 path shape：`tenants/<tid>/users/<user>/OpenBot/agents/<agent>/workspace` 和 `$STATE_DIR/operators/<user>/OpenBot/agents/<agent>/workspace`。共享寻址打开时，正式根是 operators。

工具 cwd 和 sandbox 工作区会把租户卷上的路径 remount 到 operators。结算用的是另一条公式 `$STATE_DIR/tenants/…`。`relocateTenantsVolumeUserPath` 只改写 `OPENBOT_TENANTS_ROOT` 下面的路径。state 目录里的 tenants 公式经常不在那棵卷上，于是结算继续读空目录，同时 `alignFormalRootForManagedAddressing` 以前还不接收 config：`data.mode=managed` 只写在配置里、环境变量没有 `OPENBOT_DATA_MODE` 时，remount 根本不会开。

PDF 已经在 operators 上，结算却报二进制未落盘。

## 收敛

`alignFormalRootForManagedAddressing` 是唯一正式根入口。managed 且 `OPENBOT_MULTITENANT` 打开时：

- 租户卷上的 bot workspace，以及 `$STATE_DIR/tenants/…/workspace`，都解析到 `$STATE_DIR/operators/<user>/OpenBot/agents/<agent>/workspace`。
- 已经是 operators 的路径保持不动。群协作路径不 remount。
- 结算、预览 Locator 的个人根回退、声明物物化、sandbox `workspaceDir`、工具 cwd 都走这个函数。
- 共享寻址打开时，结算创建的是 operators 根，不把新文件写进另一棵树。

二进制（pdf / office / 图片）只有在 formal root + 相对路径上读到非空字节才登记 `presentation=delivered`。字节只在另一棵 shape 上，或两棵 checksum 不一致：`unwritten`，`failureReason=workspace_root_skew`，不复制、不覆盖。界面对应文案仍是「文件暂未交付：文件缺失或为空」。文本类信封仍可物化到正式根。

## 怎么跑测试

```bash
pnpm exec vitest run \
  src/gateway/workspace-resolver/formal-root-settle.test.ts \
  src/gateway/workspace-resolver/formal-deliverable-root.test.ts \
  src/gateway/workspace-resolver/settle-declared-deliverable.test.ts \
  src/gateway/knowledge/deliverables/chat-deliverable-publish.test.ts
```

本批不授权 LIVE 部署。
