# @openbot/constitutional-registry

Phase D §9.2 的 **Registry 脚手架**。书面范围是 `phase_d_product_split_scaffold`（2026-09-25）。

执行方案把「拆独立产品」标成推迟。本包是用户要求的边界刀：私有 workspace 包，只重新导出 `@openbot/constitutional-contracts` 的适配器与只读账本视图。它不是独立可部署产品，也没有自己的发布列车。

发现注：`.kiro/specs/constitutional-governance-discovery/phase-d-product-split-scaffold.md`。

## 指向的既有表面

| 重新导出     | 来源         |
| ------------ | ------------ |
| 源账适配器   | `adapters`   |
| 宪法账本视图 | `read-model` |

源账 id（plugin registry、evolution、validation receipt、execution trace）保持分开。本包不复制 Zod schema。

## 仍未证明（本包不主张）

部署边界、所有权、生命周期都还没有被证明需要分离。`REGISTRY_SCAFFOLD_BOUNDARY` 里这三项都是 `false`。

## 明确不做

- 不独立交付，不新增生产部署或发布流水线
- 不物理并账，不合并 Profile A/B
- 不把回执写成证明，不把已安装插件写成已授权能力
- 不 enforce，不 live invoke，不默认打开 Fabric，不选择 Path
- 不接入 gateway chat、tool invoke、ACP、AOR、dispatch、gateway-hook
- 不把 Phase C 写成 GO

## 本地检查

先构建契约包，再检查本包：

```bash
pnpm --dir packages/constitutional-contracts run build
pnpm --dir packages/constitutional-registry run typecheck
pnpm --dir packages/constitutional-registry test
pnpm --dir packages/constitutional-registry run build
```
