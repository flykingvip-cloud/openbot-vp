# Stage 2.2 — four-tab companion (evidence)

Routing scheme A. Shots are the acceptance set for post-login chrome. Captured on Mac AVD `OpenBot_API34` (see CAPTURE.md).

| File | What it must show |
| --- | --- |
| `01-cold-start-logged-out-login.png` | Cold start, no employee session. Employee Shell **login card** (Stage 2 / #233). Not the four tabs, not the workbench embed. |
| `02-cold-start-logged-in-tabs.png` | Cold start with a valid session. Four tabs **对话 / 任务 / 知识 / 我的**, Chat selected. Not the Shell embed, not RootCanvas / HomeToolbar, not the web five-module bar. |
| `03-tab-tasks.png` | 任务 tab. Light list, same page gutter and header as the other tabs. |
| `04-tab-knowledge-stub.png` | 知识 tab stub. Placeholder copy; search still hands off to chat. No knowledge library. |
| `05-tab-me.png` | 我的 tab. **员工工作台** row: “返回已登录的工作台”. |
| `06-me-shell-embed.png` | After that row. Logged-in Employee Shell **workbench embed**, not the login card. System back returns to the four tabs. |

## TODO

- [x] Capture the six shots above (emulator or device) and commit the PNGs beside this file. See CAPTURE.md.
