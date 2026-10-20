/**
 * Read-only baseline cases for inbound depth routing.
 * Metrics are collected during gray rollout; this file does not claim results.
 */

export type ChatInboundBaselineLane = "chat" | "retrieve" | "act" | "failure";

export type ChatInboundBaselineCase = {
  id: string;
  lane: ChatInboundBaselineLane;
  category: string;
  input: string;
  hasAttachments?: boolean;
};

export const CHAT_INBOUND_BASELINE_CASES: readonly ChatInboundBaselineCase[] = [
  { id: "zh-greeting", lane: "chat", category: "寒暄", input: "晚上好" },
  { id: "en-greeting", lane: "chat", category: "寒暄", input: "good evening" },
  { id: "zh-explain", lane: "chat", category: "解释", input: "用一句话解释什么是知识库" },
  { id: "zh-rewrite", lane: "chat", category: "改写", input: "把这句话改得更礼貌：赶紧处理" },
  { id: "zh-followup", lane: "chat", category: "追问", input: "然后呢" },
  { id: "zh-minutes", lane: "retrieve", category: "纪要", input: "帮我查一下上周的会议纪要" },
  {
    id: "zh-enterprise-kb",
    lane: "retrieve",
    category: "企业知识",
    input: "查询知识库里的差旅政策",
  },
  {
    id: "zh-personal-kb",
    lane: "retrieve",
    category: "个人知识",
    input: "检索我之前保存的客户备注",
  },
  { id: "zh-read-file", lane: "act", category: "文件读取", input: "打开工作区里的 README" },
  { id: "zh-write-file", lane: "act", category: "写入", input: "把结论写入工作区 notes.md" },
  { id: "zh-publish", lane: "act", category: "发布", input: "把这份草稿发布到知识库" },
  {
    id: "empty-retrieve",
    lane: "failure",
    category: "空检索",
    input: "查一个不存在的知识条目 XYZ-NO-HIT",
  },
  {
    id: "timeout-knowledge",
    lane: "failure",
    category: "知识超时",
    input: "查询知识库超时后仍要回答",
  },
  { id: "tool-fail", lane: "failure", category: "工具失败", input: "写入一个只读路径" },
];
