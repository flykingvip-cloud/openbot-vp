# 渲染机依赖探测与 Chromium 路径解析

本文件是本技能**能否运行的前提**。第 6 道工序开始前，先按此清单探测；核心前置缺失则本技能不可用，应如实告知用户，不得假称已出 PDF。

## 1. 探测清单

```bash
# 1) Chromium / Chrome 可执行文件（系统浏览器优先；Playwright 缓存只是回退）
command -v google-chrome google-chrome-stable chromium chromium-browser 2>/dev/null
ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null

# 2) 中文字体
fc-list 2>/dev/null | grep -iE "Noto Sans CJK SC|Songti|Noto Serif CJK SC"

# 3) poppler（取字 / 质检）
command -v pdftotext pdfinfo pdftoppm

# 4) LibreOffice（本技能不使用，仅记录不依赖）
command -v libreoffice soffice
```

## 2. Chromium 路径解析顺序

按优先级取第一个存在且可执行的：

1. 环境变量 `CHROME_BIN`（若已设定）
2. `google-chrome` / `google-chrome-stable` / `chromium` / `chromium-browser`（PATH 上的系统浏览器）
3. `~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome`，以及 `.pw-browsers/chromium-*/chrome-linux/chrome`（仅当系统没有 Chrome/Chromium 时，由 `scripts/print-pdf.mjs` 回退；不要手选这个二进制再裸跑 `--print-to-pdf`）
4. `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`（macOS 本机）

拿到后先验版本与动态库：

```bash
"$CHROME" --version
ldd "$CHROME" 2>&1 | grep -i "not found"   # 应为空
```

## 3. 判据

| 前置             | 状态    | 处置                                                         |
| ---------------- | ------- | ------------------------------------------------------------ |
| Chromium 可执行  | 有      | 进入第 6 道工序                                              |
| Chromium 可执行  | 无      | **停机**：告知用户渲染机缺 Chrome/Chromium，本技能不出 PDF   |
| Noto Sans CJK SC | 有      | 用标准字体栈                                                 |
| Noto Sans CJK SC | 无      | 降级字体栈 `Songti SC`/`serif`，提示用户                     |
| poppler          | 有      | 正常质检                                                     |
| poppler          | 无      | 缺取字改 `web_fetch`；缺质检则人工抽查页数并在交付说明中标注 |
| LibreOffice      | 有 / 无 | 与本技能无关，不因缺失而阻塞                                 |

## 4. 渲染调用模板

只调用打印助手，不要自己拼 Chromium 参数：

```bash
WORK="tmp/<task>"
node skills/web-extract-html-pdf/scripts/print-pdf.mjs \
  --html "$WORK/page.html" \
  --out "$WORK/out.pdf"
echo "exit=$?"
ls -la "$WORK/out.pdf"
```

助手内部等价于（供排障，不要手写）：

```bash
"$CHROME" \
  --headless=new --disable-gpu --no-sandbox --disable-dev-shm-usage \
  --no-pdf-header-footer --print-to-pdf="$WORK/out.pdf" \
  --user-data-dir="$(mktemp -d)" \
  --timeout=10000 \
  "$WORK/page.html"
```

要点：

- **`--timeout` 才是卡住的上限**。`--headless=new` 会等文档 load。一个 SYN 被丢弃的 http(s) 子资源会把进程拖到 TCP 重传结束（大约 120 秒）。`--virtual-time-budget` 在 `--headless=new` 下**不会**打断这次等待，不要再用它当修复。
- **每次新建一次性 `--user-data-dir`**：复用 profile 时，当前 Chromium 会因 ProcessSingleton 立刻失败退出。
- 判据是**退出码 + `print-pdf: ok` + 出文件**。`Failed to connect to socket /run/dbus/system_bus_socket` 在无 system bus 的沙箱里是预期噪声，最小 HTML 也会打出这一行并且仍能写出 PDF。
- 第一轮在 `--timeout` 内没写出 PDF 时，助手会加上 `--host-resolver-rules=MAP * ~NOTFOUND` 再打一次，避免远程子资源把 load 挂死。正文还在，外链图片可能缺。

## 5. 已知环境事实（示例，随机器变化，勿硬编码）

- OpenBot 对话沙箱（标签仍是 `openbot-sandbox:bookworm-slim`，系统是 Debian 13 trixie）预装 `/usr/bin/chromium`、poppler、`fonts-noto-cjk`（含 Noto Sans CJK SC）。**没有** `/run/dbus/system_bus_socket`。用这个系统 Chromium，不要把 Playwright 缓存当成安装前提，也不要为了这条 dbus 日志去给镜像加 dbus。
- `~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome` 和 `.pw-browsers/chromium-*/chrome-linux/chrome` 只在 PATH 上没有 Chrome/Chromium 时由助手回退。
- 最小命令 `chromium --headless=new --disable-gpu --no-sandbox --print-to-pdf=... probe.html` 在该沙箱上大约 10 秒写出 PDF，同时 stderr 仍有 dbus socket 报错。120 秒挂起是子资源等待，不是 dbus。
