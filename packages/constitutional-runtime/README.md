# @openbot/constitutional-runtime

Phase D §9.2 的 **Runtime 脚手架**。书面范围是 `phase_d_product_split_scaffold`（2026-09-25）。

执行方案把「拆独立产品」标成推迟。本包是用户要求的边界刀：私有 workspace 包，只重新导出 `@openbot/constitutional-contracts` 里默认关闭的 runtime façade shadow。它不是独立可部署产品，也不是第五套执行故事。

发现注：`.kiro/specs/constitutional-governance-discovery/phase-d-product-split-scaffold.md`。

## 指向的既有表面

| 重新导出                            | 来源                        |
| ----------------------------------- | --------------------------- |
| `runRuntimeFacadeShadow`            | `runtime-facade`            |
| enforce / live invoke / Fabric 常量 | `flags`（三者都是 `false`） |

未传入 `shadow: true` 时，门面保持 inert，不调用评估器。传入之后仍然只出报告：`enforce`、`enforced`、`liveInvoke`、`fabricDefaultOn` 为 false，`selectedPath` 为 null。本包不把 shadow 改成 enforce。

## 仍未证明（本包不主张）

部署边界、所有权、生命周期都还没有被证明需要分离。`RUNTIME_SCAFFOLD_BOUNDARY` 里这三项都是 `false`。

## 明确不做

- 不独立交付，不新增生产部署或发布流水线
- 不把 Runtime 门面从默认关闭的 shadow 改成 enforce
- 不把 `ORCHESTRATION_LIVE_INVOKE` 设为 true，不默认打开 Fabric
- 不新增第五套执行状态机，不新增生产账本库，不提供跨域写权威
- 不接入 gateway chat、tool invoke、ACP、AOR、dispatch、gateway-hook
- 不把 Phase C 写成 GO

## 本地检查

先构建契约包，再检查本包：

```bash
pnpm --dir packages/constitutional-contracts run build
pnpm --dir packages/constitutional-runtime run typecheck
pnpm --dir packages/constitutional-runtime test
pnpm --dir packages/constitutional-runtime run build
```
