---
name: wechat-use
description: >-
  仅当用户明确选择 wechat-use /「已登录本机微信→适配器:3000」可选旁路时使用。
  须端到端走完本技能：安装 CLI、激活、Accessibility、doctor、init、bridge，再接 OpenBot 3000 适配器。
  默认个人微信运营仍走 wechat-personal-ops。不要在未确认风险时推荐。
---

# wechat-use（可选 · 非 OpenBot 默认）

**禁止写进普通本地用户指引。** 不要引导用户打开 Telegram、`t.me/WechatCliBot`、`@WechatCliBot` 或运行 `wechat-use auth activate`。产品已省去这条自助激活路径。普通用户只走 [wechat-personal-ops](sand-workflow:wechat-personal-ops) 的 `bind-existing`。

## OpenBot 路由 + 风险确认（先读）

1. **默认**个人微信运营走 [wechat-personal-ops](sand-workflow:wechat-personal-ops)（`127.0.0.1:18789/` + 本机 `:3000` + 工作台 `bind-existing`）。
2. **仅当**用户明确要求 wechat-use，或 ops 因缺少协议引擎无法收发且用户同意改走「已登录本机微信 → 适配器接 3000」时，才使用本技能。
3. **进入完整流程前必须口头确认风险**：非官方 API、可能违 ToS / 封号、需本机 Accessibility / Telegram 激活；仅限用户本人个人账号；禁止商用群发；**不要**默认开 Cloudflare Tunnel。
4. 本技能 **不替代** OpenBot identity grant。正式数字人运营仍应回到 ops 的 grant 模型；本旁路只是把本机桥接到 `:3000` 契约。
5. 分流总表见 [wechat-personal-catalog](sand-workflow:wechat-personal-catalog)。
6. **Agent 行为**：若终端出现 `command not found: wechat-use`，**禁止**跳过安装直接起 bridge / 适配器；必须从下方「安装 CLI」步骤带用户走完。不要只甩一句「请自行安装」就结束——按完整流程陪跑。

## 协作普通用户完整流程

用户已明确选择本可选通道后，**按顺序**带用户完成（macOS Apple Silicon；个人号 only）：

0. **确认前提**
   - 再次确认风险（见上）且用户同意继续
   - 确认机器是 **macOS Apple Silicon**
   - 确认只用 **用户本人个人微信账号**（非商用群发）

1. **安装 CLI**

   ```bash
   curl -fsSL https://raw.githubusercontent.com/leeguooooo/wechat-use/main/install.sh | bash
   ```

   - 确保 `~/.local/bin` 在 PATH（必要时写入 shell rc 并 `source`）
   - 验收：`which wechat-use` 能找到可执行文件
   - `command not found` → 停在本步排查 PATH / 重装，**不要**跳到 bridge

2. **激活**
   - 打开 Telegram，找 `@WechatCliBot`，按指引提交 **personal-use** 申请，取得激活信息
   - 运行：`wechat-use auth activate …`（按 CLI 提示填入）
   - **注意**：中国大陆手机号常无法完成 Telegram 注册/验证。若用户卡在 Telegram 注册或无法拿到激活码：**停止**，说明没有激活则无法完成发送；**不要**编造绕过激活的方法

3. **Accessibility**
   - 打开 macOS「系统设置 → 隐私与安全性 → 辅助功能」
   - 启用 **wechat-bridge**（及安装指引要求的相关项）

4. **doctor**

   ```bash
   wechat-use doctor
   ```

   - 反复修到「足够绿」再往下（缺权限 / 缺二进制 / 未激活等按 doctor 提示处理）

5. **WeChat 副本登录**
   - 打开 **WeChat-4.1.9-wechat-use**（或安装脚本落地的专用副本）
   - 用户用手机扫码 / 确认，使该副本处于**已登录**状态

6. **init + warmup**

   ```bash
   wechat-use init
   ```

   - 会重启微信；需用户在窗口内点「进入 WeChat」
   - 用户向 **文件传输助手** 发送：`1`（warmup）

7. **启动 bridge**

   ```bash
   wechat-bridge
   ```

   - 监听 `127.0.0.1:18400`（loopback only；**不要**默认开 Cloudflare Tunnel）
   - 验收：`curl -s http://127.0.0.1:18400/health` 正常

8. **OpenBot 适配器 :3000**
   - 接线细节以 ops 文档为准：[adapter-wechatuse.md](sand-workflow:wechat-personal-ops/references/adapter-wechatuse.md)
   - LaunchAgent / 进程环境示例：
     - `WECHAT_PROTOCOL_MODULE=…/protocol.wechatuse.mjs`
     - `WECHAT_USE_BRIDGE_URL=http://127.0.0.1:18400`
   - kickstart 适配器后验收：
     - `curl` `:3000` 的 health / loginStatus
     - `POST /api/login` → **501** + `NATIVE_WECHAT_SESSION_REQUIRED`
     - `POST /api/sendTextMsg` 能发（如 filehelper 探针）

9. **OpenBot 产品侧**
   - `~/.openbot/wechat-personal-worker.json` 的 `proxyUrl` **仍为** `http://127.0.0.1:3000`（**禁止**把 `:18400` 写入默认 worker.json）
   - grant / 数字人授权仍走 ops 模型
   - 本模式下工作台 **不应**期望弹出 QR；登录态来自本机已登录微信

10. **验收清单（短）**
    - [ ] `which wechat-use` OK；`wechat-use doctor` 足够绿
    - [ ] `wechat-bridge` health OK（`:18400`）
    - [ ] 适配器 `:3000` health / loginStatus OK；`login` → 501 NATIVE_WECHAT_SESSION_REQUIRED
    - [ ] `sendTextMsg` 探针成功
    - [ ] worker.json `proxyUrl` 仍是 `:3000`；未默认开公网 Tunnel

## 快速路径（仅当 CLI 已装好）

安装与激活**已经完成**时可走捷径；若 `command not found: wechat-use`，回到完整流程第 1 步。

```bash
wechat-use doctor
wechat-use init          # 会重启微信；需用户在窗口内点「进入 WeChat」
wechat-bridge &          # 127.0.0.1:18400
wechat-use send "你好" filehelper --json
```

发送消歧：模糊名多候选时读 JSON `candidates`，用明确 wxid 重试。

HTTP：`GET /health`、`POST /send`、`GET /messages/stream?since=<epoch>`（**必须**带 since）。

入站务必丢弃 `fromSelf === true`。群聊仅在产品需要且 `isMentioned` 时处理。

## 与 OpenBot 契约

适配器实现见运营方 sidecar 目录的 `protocol.wechatuse.mjs`（交付包 `/workspace/wechat-adapter`）；契约验收见 wechat-personal-ops `references/adapter-wechatuse.md`。字段对齐 `sidecar-http.md` / `sidecar-http-vnext.md`。

- 对外仍是 OpenBot `:3000`；桥在 `:18400` 仅本机
- **不要**把 `18400` 写入默认 `wechat-personal-worker.json`
- `POST /api/login` 保持 **501** `NATIVE_WECHAT_SESSION_REQUIRED`
- 不替代 identity grant

## 不要

- 未确认风险就安装或开 Cloudflare Tunnel
- 发现未安装就跳过「安装 CLI」直接起 bridge / 适配器
- 只告诉用户「自己去装」而不陪跑完整流程
- 用本技能绕过 OpenBot grant 冒充「已授权数字人」
- 规模化群发 / 操作非本人账号
- 把 `:18400` 写成默认 worker `proxyUrl`
- 为绕过 Telegram 激活编造变通方案

## 免责（摘要）

研究/个人学习；非腾讯授权 API；可能违反 ToS；作者声明非商用。完整条款见上游 DISCLAIMER。用户自负风险。

上游：https://github.com/leeguooooo/wechat-use
