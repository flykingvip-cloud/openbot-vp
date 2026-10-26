# kuaishou 路径图（S3 + S6 证据指针）

```yaml
path_unstable: true
provider: kuaishou
verified_live: false
live_probe_date: "2026-10-19"
live_evidence: references/live-evidence.md
```

**诚实声明**：下列 URL 仅为公开文档/站点入口（`public_docs`）。菜单点击序、扫码/2FA、Token 复制控件均为 **UNKNOWN**，禁止当作已验证 live 路径。

S6（2026-10-19 Asia/Shanghai）取证记录见 [live-evidence.md](live-evidence.md)：本切片无云电脑会话 / 无 bind 成功 → **保持** `path_unstable: true` / `verified_live: false`。

## 公开入口

| 名称                         | URL                          | 来源级别    |
| ---------------------------- | ---------------------------- | ----------- |
| 快手开放平台（公开文档入口） | `https://open.kuaishou.com/` | public_docs |

## 人机步骤（未验证）

| 步骤                              | 状态                              |
| --------------------------------- | --------------------------------- |
| 登录开发者/创作者后台             | UNKNOWN                           |
| 创建应用 / 开通权限               | UNKNOWN                           |
| 取得 Access Token / Cookie / 密钥 | UNKNOWN                           |
| 复制账号标识（快手号）            | UNKNOWN                           |
| 回到 OpenBot「添加并认证」提交    | 产品内路径已知；取证面仍 unstable |

## 大白策略

- 默认推荐队列：**跳过** `path_unstable`（除非用户显式点名本 provider / 本 skill）
- 显式调用时：先说明路径未 live 验证，再协助打开 `public_docs` 或让用户粘贴已有凭证
- 合规：不引导绕过平台 ToS；不确定 Cookie vs Token 时优先开放平台 Token 文案
- S6 证据：[live-evidence.md](live-evidence.md)（未 verified_live 前默认跳过）
