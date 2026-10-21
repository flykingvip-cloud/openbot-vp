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
3. `~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome`（仅当系统没有 Chrome/Chromium 时回退）
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

```bash
CHROME="<已解析的可执行文件>"
WORK="tmp/<task>"
timeout 90 "$CHROME" \
  --headless=new --disable-gpu --no-sandbox --disable-dev-shm-usage \
  --no-pdf-header-footer --print-to-pdf="$WORK/out.pdf" \
  --user-data-dir="$WORK/ud-$RANDOM" \
  --virtual-time-budget=12000 "file://$PWD/$WORK/page.html"
echo "exit=$?"
ls -la "$WORK/out.pdf"
```

要点：

- **每次新建一次性 `--user-data-dir`**：复用同一 profile 目录会与上次进程争用而挂起。
- **必带 `timeout`**：无头渲染在缺依赖 / profile 争用时可能不退。
- 判据是**退出码 + 出文件**，不是 stdout 里的 `ERROR:dbus` 之类噪声（无 D-Bus 的容器里这些属正常）。

## 5. 已知环境事实（示例，随机器变化，勿硬编码）

- OpenBot 对话沙箱（标签仍是 `openbot-sandbox:bookworm-slim`，系统是 Debian 13 trixie）预装 `/usr/bin/chromium`、poppler、`fonts-noto-cjk`（含 Noto Sans CJK SC）。用这个系统 Chromium，不要把 Playwright 缓存当成安装前提。
- `~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome` 只在 PATH 上没有 Chrome/Chromium 时使用。
- Linux 容器通常无 D-Bus。无头渲染时 stdout 里的 `ERROR:dbus` 是噪声。
- `--headless=new` 在缺依赖时可能卡住，`--headless=old` 亦不能保证；真正的解法是一次性 `user-data-dir` + `--disable-dev-shm-usage`。若仍失败，按第 3 节判「缺失」并停机。
