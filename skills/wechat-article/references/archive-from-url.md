# 公众号 URL 入库（只读）

用户要把**已发布**的公众号文章收进知识宇宙时读本页。这不是排版，也不是草稿箱发布。

## 何时走这里

- 「把这篇公众号入库」「归档这些历史文章」「这些 mp.weixin 链接收进知识库」
- 用户给出一条或多条 `https://mp.weixin.qq.com/...` 链接，或官方后台导出的明文

不要：扫码登录公众号后台、抓 cookie、装证书代理、点群发。

## 步骤

1. 确认每条 URL 由用户在本轮点名，或来自用户粘贴的清单。搜索到的公众号链接先当候选，不自动抓。
2. 用 OpenBot `web_fetch` 或 `defuddle` 读公开正文。打不开就标「未核实」，不要编标题。
3. 正文落到工作区 `output/wechat-article/archive/run-N/`（不覆盖旧 run）。
4. 已有知识库则 `knowledge.personal.upload` 或 `knowledge.local-folder.bind` 该 run 目录；没有则先 `knowledge.base.create`（标题如「公众号归档」，可见性按用户租户，默认 `private`）。
5. `knowledge.document.preview` 核验原句。引用交接 `source-lock-and-cite`。
6. 若还要改写成新草稿：先出库再走 SKILL 的 Publication mode，不要在归档目录上直接排版覆盖。

## 禁止

- 把归档当成已群发
- 把未打开的搜索结果写入知识库
- 存储 `WECHAT_APP_SECRET` 或扫码凭据到技能目录
- 用发布脚本 `publish_agi_axios.js` 做入库
