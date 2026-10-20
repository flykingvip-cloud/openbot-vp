# 已知链接素材与 3:4 复用

热点发现只出选题。下载、截图、切片只接受**当前任务已确认**的链接。

## 已知链接

确认来源（满足一条即可）：

- 用户本轮粘贴的 URL
- Source of Truth 索引里已有、且用户说「用这条」
- 调研 `candidates.md` 里勾过、并交接过来的条目

未确认的搜索结果、热榜、收藏夹批量导出，只进选题，不进素材目录。

分配输出目录（不覆盖）：

```bash
python3 skills/content-ops/scripts/known_link.py --url "https://example.com/p/1" --confirmed --out-root output/content-ops/assets
```

脚本打印 `run-N` 路径。把抓取/截图/切片都写进该目录。禁止改旧 run。

抓取用 `web_fetch` / `defuddle`。本技能不内置平台下载器、不写 Cookie。

## 3:4 复用

输入：一条已确认的公开帖（X / 小红书等）+ 同一 Source of Truth。

输出（按需，不要默认全做）：

- 1080×1440 图组（一页一信息，事实句能指回源锚点）
- 可选成片：交接 `qiaomu-cut` 或 `video-frames`，**默认不发布**
- 回溯表增加：`切片文件 → 源 URL → 源段落`

禁止：为了画面去改数字或因果；给未确认链接做切片；生成 TTS/BGM 冒充原帖音频（原帖若无声就保持无声）。

文字平台版本仍走 `references/repurpose.md`。图组也要能通过：

```bash
python3 skills/content-ops/scripts/source_trace.py --source <源文件> --derived <图组说明或字幕>
```
