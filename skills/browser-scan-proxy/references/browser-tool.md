# OpenBot `browser` 工具契约

本技能只使用 OpenBot 内置 `browser` 工具。不要发明第二套浏览器栈，也不要把 Cursor Chrome DevTools MCP 写进用户可见回复。

## 配置

需要 `browser.enabled=true`。未开时停止并说明，不要改走「请你自己打开控制台」。

## 配置档

| profile    | 含义                            | 本技能                                                                  |
| ---------- | ------------------------------- | ----------------------------------------------------------------------- |
| `openclaw` | 隔离的托管浏览器                | **登录页默认**                                                          |
| `chrome`   | 用户本机 Chrome / Browser Relay | 禁止当扫码落点，除非用户明确把该标签 attach 给你且你就在该标签上 `wait` |

用户提到「Chrome 扩展 / Browser Relay / 工具栏按钮 / attach tab」时，工具说明要求用 `profile=chrome`。那只适用于「接管用户已打开的标签」。扫码登录仍先开 `openclaw` 隔离页，避免扫到用户自己的窗口。

## 动作

| action                                   | 本技能用法                                          |
| ---------------------------------------- | --------------------------------------------------- |
| `status` / `start`                       | 开干前确认浏览器控制已起来                          |
| `open`                                   | `profile=openclaw` + `url=loginUrl`                 |
| `tabs`                                   | 看当前标签 URL，判断扫码是否落入                    |
| `screenshot`                             | 把二维码发给用户                                    |
| `snapshot`                               | 读 UI 树；后续 `act` 用同一 `targetId` + `ref`      |
| `act` `kind=click\|type\|fill\|evaluate` | 登录后的操作                                        |
| `act` `kind=wait`                        | 仅用于等登录离开 passport；默认不要拿 wait 当主循环 |
| `close`                                  | 重扫前关掉旧登录标签                                |
| `navigate`                               | 已登录后的整页跳转；Hash 路由优先 `evaluate`        |

`snapshot` 默认 `refs=role`。跨多次调用要稳定 ref 时用 `refs=aria`，并一直传回 `targetId`。

## 等登录

优先 snapshot 看是否已离开登录域。没有可靠 UI 态时才：

```
browser action=act kind=wait url=<consoleOrigin> timeoutMs=180000
```

或 `textGone` 等「扫码登录」文案消失。一次最多 180s。

## 关浮层 / Hash 路由

`act kind=evaluate` 的 `fn` 必须返回 JSON 可序列化值。

关阿里云产品浮层：找 `aria-label` / 文本含「收起产品面板」的 button 并 click。

Hash 路由：`location.hash = '#/directmail/Domain/cn-hangzhou'`，然后 snapshot。
