// @vitest-environment node
import { describe, expect, it } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { zh_CN } from "../../i18n/locales/zh-CN.ts";
import {
  buildChatSenderIdentityLookup,
  renderMessageGroup,
  renderPeerExchange,
} from "./grouped-render.ts";
import { foldPeerExchangeThread } from "./peer-exchange.ts";

function templateToString(tpl: unknown): string {
  if (Array.isArray(tpl)) {
    return tpl.map((item) => templateToString(item)).join("");
  }
  const t = tpl as { strings?: TemplateStringsArray; values?: unknown[] };
  if (!t.strings) {
    return JSON.stringify(tpl);
  }
  let out = "";
  for (let i = 0; i < t.strings.length; i += 1) {
    out += t.strings[i] ?? "";
    if (i < (t.values?.length ?? 0)) {
      const v = t.values?.[i];
      out +=
        typeof v === "object" && v !== null
          ? templateToString(v)
          : String(v as string | number | boolean | bigint | null | undefined);
    }
  }
  return out;
}

const CRON_RESULT_MARKDOWN = [
  "**定时任务结果** · 市场分析",
  "",
  "## 任务摘要",
  "",
  "**状态**：✅ 成功",
  "**耗时**：1 分 5 秒",
  "",
  "## 任务成果",
  "",
  "| id | name |",
  "| --- | --- |",
  "| notion | Notion |",
  "",
  "---",
  "",
  "任务 ID：`abc-123`",
].join("\n");

async function withZhCn(run: () => void) {
  const previous = i18n.getLocale();
  i18n.registerTranslation("zh-CN", zh_CN);
  await i18n.setLocale("zh-CN");
  try {
    run();
  } finally {
    await i18n.setLocale(previous);
  }
}

describe("renderMessageGroup", () => {
  it("renders cron result messages without temporal dead zone errors", () => {
    const group = {
      kind: "group" as const,
      key: "group-1",
      role: "assistant",
      senderLabel: "OpenBot",
      timestamp: Date.UTC(2026, 5, 26, 8, 0, 0),
      isStreaming: false,
      messages: [
        {
          key: "msg-1",
          message: {
            role: "assistant",
            content: [{ type: "text", text: CRON_RESULT_MARKDOWN }],
            openclawCronResult: {
              jobId: "abc-123",
              jobName: "市场分析",
            },
          },
        },
      ],
    };

    const rendered = renderMessageGroup(group, {
      showReasoning: false,
      onOpenCronTaskDetail: () => undefined,
      onOpenCronTaskResult: () => undefined,
    });

    const output = templateToString(rendered);
    expect(output).toContain("chat-cron-result-header");
    expect(output).toContain("任务摘要");
    expect(output).toContain("任务成果");
  });

  it("renders occupied-focus cron wake as an in-thread choice card", () => {
    const group = {
      kind: "group" as const,
      key: "group-parked",
      role: "assistant",
      senderLabel: "OpenBot",
      timestamp: Date.UTC(2026, 8, 17, 8, 0, 0),
      isStreaming: false,
      messages: [
        {
          key: "msg-parked",
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "**定时任务结果** · 竞品价格\n\n[CRON_PARKED_NOTICE]\n\n定时任务已完成。\n\n任务 ID：`job-1`",
              },
            ],
            openclawCronResult: { jobId: "job-1", jobName: "竞品价格", kind: "parked_notice" },
          },
        },
      ],
    };
    const output = templateToString(
      renderMessageGroup(group, {
        showReasoning: false,
        onOpenCronTaskDetail: () => undefined,
      }),
    );
    expect(output).toContain("chat-delivery__choices");
    expect(output).not.toContain("任务成果");
  });

  it("renders occupied-focus heartbeat wake as a clickable parked-task choice card", async () => {
    await withZhCn(() => {
      const submits: string[] = [];
      const group = {
        kind: "group" as const,
        key: "group-hb-parked",
        role: "assistant",
        senderLabel: "OpenBot",
        timestamp: Date.UTC(2026, 8, 17, 8, 0, 0),
        isStreaming: false,
        messages: [
          {
            key: "msg-hb-parked",
            message: {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: "**后台结果** · 命令完成\n\n[HEARTBEAT_PARKED_NOTICE]\n\n当前对话还在做别的事。\n\n唤醒：`exec-event`",
                },
              ],
            },
          },
        ],
      };
      const output = templateToString(
        renderMessageGroup(group, {
          showReasoning: false,
          onSubmitChoice: (text) => {
            submits.push(text);
          },
        }),
      );
      expect(output).toContain("chat-delivery__choices");
      expect(output).toContain('type="button"');
      expect(output).toContain("继续前任务");
      expect(output).toContain("暂停前任务");
      expect(output).toContain("关闭前任务");
      expect(output).not.toContain("先不管");
      expect(output).not.toContain("[HEARTBEAT_PARKED_NOTICE]");
      expect(output).not.toContain("唤醒：");
    });
  });

  it("renders post-completion parked-task reminder as a clickable choice card", async () => {
    await withZhCn(() => {
      const group = {
        kind: "group" as const,
        key: "group-parked-reminder",
        role: "assistant",
        senderLabel: "OpenBot",
        timestamp: Date.UTC(2026, 8, 17, 9, 0, 0),
        isStreaming: false,
        messages: [
          {
            key: "msg-reminder",
            message: {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: [
                    "**挂起提醒** · 还有未结束的任务",
                    "",
                    "[PARKED_TASK_REMINDER]",
                    "",
                    "当前任务已完成，交付已核对。前面还有未结束的挂起任务，可以继续、先暂停，或关闭。",
                    "",
                    "前任务：「竞品价格」",
                    "任务 ID：`task-abc123`",
                    "停在：未完成：竞品价格",
                    "",
                    "继续挂起 task-abc123",
                    "取消挂起 task-abc123",
                  ].join("\n"),
                },
              ],
              taskCompletionNotice: true,
            },
          },
        ],
      };
      const output = templateToString(
        renderMessageGroup(group, {
          showReasoning: false,
          onSubmitChoice: () => undefined,
        }),
      );
      expect(output).toContain("chat-delivery__choices");
      expect(output).toContain('type="button"');
      expect(output).toContain("继续前任务");
      expect(output).toContain("暂停前任务");
      expect(output).toContain("关闭前任务");
      expect(output).not.toContain("[PARKED_TASK_REMINDER]");
    });
  });

  function renderAssistantArtifact(text: string): string {
    const group = {
      kind: "group" as const,
      key: "group-artifact",
      role: "assistant",
      senderLabel: "大白管家",
      timestamp: Date.UTC(2026, 6, 8, 8, 0, 0),
      isStreaming: false,
      messages: [{ key: "m-1", message: { role: "assistant", content: [{ type: "text", text }] } }],
    };
    return templateToString(renderMessageGroup(group, { showReasoning: false }));
  }

  it("does not render 打开成果 chrome for a planning mention of SKILL.md", () => {
    const output = renderAssistantArtifact(
      [
        "五、我现在就能替你做的两件事",
        "",
        "1. 写一份公众号主编技能包：把选题、撰写、排版、配图固化成一份可复用的 SKILL.md。",
        "2. 配一份选题策划模板，数字人按模板撰写、你来审。",
      ].join("\n"),
    );
    expect(output).not.toContain("chat-bubble--artifact-output");
    expect(output).not.toContain("chat-response-reference-summary--artifact");
    expect(output).not.toContain("chat.openArtifact");
  });

  it("badges a producer-declared deliverable as a first-class 成果 (no excerpt modifier)", () => {
    const text = [
      "已经生成好了！优化后的 Word 文档已在工作区。",
      '<<DELIVERABLE title="Alice简历" type="doc" file="Alice_爱丽_瑜伽老师简历.docx">>',
      "已优化头部设计、结构重组为五大板块、深蓝主色调排版，内容详实完整。",
      "<</DELIVERABLE>>",
    ].join("\n");
    const output = renderAssistantArtifact(text);
    expect(output).toContain("chat-artifact-output-header__badge");
    expect(output).not.toContain("chat-artifact-output-header__badge--excerpt");
    expect(output).toContain("chat-msg-actions");
    expect(output).toContain("chat-copy-btn");
    expect(output).not.toContain("chat-copy-btn--inline");
  });

  it("exposes data-message-id on user bubbles so peek navigation can focus them", () => {
    const group = {
      kind: "group" as const,
      key: "group-user",
      role: "user",
      timestamp: Date.UTC(2026, 8, 2, 8, 0, 0),
      isStreaming: false,
      messages: [
        {
          key: "m-user",
          message: { id: "msg-user-1", role: "user", content: "请按 6efc8e811a 验收。" },
        },
      ],
    };
    const output = templateToString(renderMessageGroup(group, { showReasoning: false }));
    expect(output).toContain("data-message-id=");
    expect(output).toContain("msg-user-1");
  });

  it("scrubs historical false preview claims when deliverablePublish is undelivered", () => {
    const group = {
      kind: "group" as const,
      key: "group-history-false-claim",
      role: "assistant",
      senderLabel: "Skill孵化",
      timestamp: Date.UTC(2026, 9, 25, 8, 0, 0),
      isStreaming: false,
      messages: [
        {
          key: "m-1",
          message: {
            role: "assistant",
            content: [
              {
                type: "text",
                text: "PDF 已经生成，可以直接打开。分析结论仍然有效。",
              },
            ],
            deliverablePublish: {
              presentation: "undelivered",
              reasonLabel: "文件缺失或为空",
            },
          },
        },
      ],
    };
    const output = templateToString(renderMessageGroup(group, { showReasoning: false }));
    expect(output).not.toContain("可以直接打开");
    expect(output).toContain("分析结论仍然有效");
  });

  it("keeps preview claims when deliverablePublish is delivered", () => {
    const group = {
      kind: "group" as const,
      key: "group-history-delivered",
      role: "assistant",
      senderLabel: "Skill孵化",
      timestamp: Date.UTC(2026, 9, 25, 8, 1, 0),
      isStreaming: false,
      messages: [
        {
          key: "m-1",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "可以直接打开这份 PDF。" }],
            deliverablePublish: { presentation: "delivered" },
          },
        },
      ],
    };
    const output = templateToString(renderMessageGroup(group, { showReasoning: false }));
    expect(output).toContain("可以直接打开");
  });

  it("uses senderLabel initials for collaboration group assistant avatars", () => {
    for (const [senderLabel, expectedInitial] of [
      ["Skill孵化", "S"],
      ["高密度分析", "高"],
      ["熊猫学习", "熊"],
      ["市场助手", "市"],
    ] as const) {
      const group = {
        kind: "group" as const,
        key: `group-${senderLabel}`,
        role: "assistant",
        senderLabel,
        timestamp: Date.UTC(2026, 6, 14, 5, 21, 0),
        isStreaming: false,
        messages: [
          {
            key: "m-1",
            message: {
              role: "assistant",
              senderLabel,
              content: [{ type: "text", text: "reply" }],
            },
          },
        ],
      };
      const output = templateToString(
        renderMessageGroup(group, {
          showReasoning: false,
          assistantName: "大白管家",
          sessionKey: "space:alpha",
        }),
      );
      expect(output, senderLabel).toContain(`chat-avatar assistant`);
      expect(output, senderLabel).not.toContain("chat-avatar--lead");
      expect(output, senderLabel).not.toContain("chat-turn-speaker");
      expect(output, senderLabel).toContain(`>${expectedInitial}</div>`);
      expect(output, senderLabel).not.toContain('chat-avatar assistant">大</div>');
    }
  });

  it("keeps an inferred conversation scrape in the chat lane, not 打开成果 chrome", () => {
    const text = [
      "好的，报告如下：",
      "",
      "# 市场分析周报",
      "",
      "## 一、核心结论",
      "",
      "本周市场需求回暖，转化率提升明显，建议加大投放。".repeat(4),
      "",
      "## 二、下一步",
      "",
      "1. 扩大高转化渠道预算。",
      "2. 优化落地页文案。",
      "3. 复盘上周投放数据。",
    ].join("\n");
    const output = renderAssistantArtifact(text);
    expect(output).not.toContain("chat-bubble--artifact-output");
    expect(output).not.toContain("chat-artifact-output-header__badge");
    expect(output).not.toContain("chat-response-reference-summary--artifact");
    expect(output).toContain("chat-msg-actions");
    expect(output).toContain("chat-copy-btn");
  });

  it("puts the copy affordance on each code block instead of the whole reply", () => {
    const output = renderAssistantArtifact(
      [
        "问题找到了，两个办法：",
        "",
        "```bash",
        "npx --yes openbot node run --host example.internal --port 443 --tls",
        "```",
        "",
        "```bash",
        "npm run build",
        "```",
      ].join("\n"),
    );
    expect(output.match(/chat-code-block/g)).toHaveLength(2);
    expect(output.match(/chat-copy-btn--code/g)).toHaveLength(2);
    expect(output).not.toContain("chat-copy-btn--inline");
  });

  it("uses per-sender emoji instead of the global steward avatar in collaboration threads", () => {
    const lookup = buildChatSenderIdentityLookup([
      {
        id: "market-bot",
        name: "market-bot",
        identity: { name: "市场助手", emoji: "市" },
      },
      {
        id: "steward",
        name: "steward",
        identity: { name: "大白管家", emoji: "大" },
      },
    ]);
    const group = {
      kind: "group" as const,
      key: "group-market",
      role: "assistant",
      senderLabel: "市场助手",
      timestamp: Date.UTC(2026, 6, 25, 8, 0, 0),
      isStreaming: false,
      messages: [
        {
          key: "m-market",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "这是市场助手的回复。" }],
          },
        },
      ],
    };

    const output = templateToString(
      renderMessageGroup(group, {
        showReasoning: false,
        assistantName: "大白管家",
        assistantAvatar: "大",
        senderIdentityLookup: lookup,
        sessionKey: "space:alpha",
      }),
    );

    expect(output).toContain('class="chat-avatar assistant"');
    expect(output).toContain(">市<");
    expect(output).not.toContain(">大<");
    expect(output).not.toContain("chat-sender-name");
    expect(output).not.toContain("chat-peer-route");
    expect(output).not.toContain("消息来自");
    expect(output).not.toContain("chat-turn-speaker");
    expect(output).not.toContain("chat-avatar--lead");
    expect(output.indexOf("chat-avatar assistant")).toBeLessThan(
      output.indexOf("这是市场助手的回复"),
    );
    expect(output.indexOf("这是市场助手的回复")).toBeLessThan(
      output.indexOf("chat-group-timestamp"),
    );
    expect(output.indexOf("chat-group-timestamp")).toBeLessThan(output.indexOf("chat-copy-btn"));
  });

  it("falls back to sender initials when no roster match exists", () => {
    const group = {
      kind: "group" as const,
      key: "group-unknown",
      role: "assistant",
      senderLabel: "市场助手",
      timestamp: Date.UTC(2026, 6, 25, 8, 1, 0),
      isStreaming: false,
      messages: [
        {
          key: "m-unknown",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "没有 roster 也应显示正确首字。" }],
          },
        },
      ],
    };

    const output = templateToString(
      renderMessageGroup(group, {
        showReasoning: false,
        assistantName: "大白管家",
        assistantAvatar: "大",
        senderIdentityLookup: buildChatSenderIdentityLookup([]),
        sessionKey: "space:alpha",
      }),
    );

    expect(output).toContain(">市<");
    expect(output).not.toContain(">大<");
  });

  it("does not fall back to steward identity for unlabeled space assistant groups", () => {
    const group = {
      kind: "group" as const,
      key: "group-space-unlabeled",
      role: "assistant",
      senderLabel: null,
      timestamp: Date.UTC(2026, 8, 2, 12, 0, 0),
      isStreaming: false,
      messages: [
        {
          key: "m-space",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "在" }],
          },
        },
      ],
    };
    const output = templateToString(
      renderMessageGroup(group, {
        showReasoning: false,
        assistantName: "大白管家",
        assistantAvatar: "大",
        sessionKey: "space:alpha",
      }),
    );
    expect(output).not.toContain('chat-avatar assistant">大');
    expect(output).not.toContain("大白");
    expect(output).toContain(">群<");
  });

  it("treats agent-scoped space keys as the same group lane as space: keys", () => {
    const group = {
      kind: "group" as const,
      key: "group-space-unlabeled-agent-scoped",
      role: "assistant",
      senderLabel: null,
      timestamp: Date.UTC(2026, 8, 2, 12, 0, 0),
      isStreaming: false,
      messages: [
        {
          key: "m-space",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "在" }],
          },
        },
      ],
    };
    const canonical = templateToString(
      renderMessageGroup(group, {
        showReasoning: false,
        assistantName: "大白管家",
        assistantAvatar: "大",
        sessionKey: "space:alpha",
      }),
    );
    const scoped = templateToString(
      renderMessageGroup(group, {
        showReasoning: false,
        assistantName: "大白管家",
        assistantAvatar: "大",
        sessionKey: "agent:bot-2:main:space:alpha",
      }),
    );
    expect(canonical).toContain('class="chat-avatar assistant"');
    expect(scoped).toContain('class="chat-avatar assistant"');
    expect(canonical).toContain(">群<");
    expect(scoped).toContain(">群<");
    expect(scoped).not.toContain(">大<");
    expect(scoped).not.toContain("chat-group--solo");
  });

  it("keeps the steward icon when the open lane is the steward's own group-scoped session", () => {
    const group = {
      kind: "group" as const,
      key: "group-steward-scoped",
      role: "assistant",
      senderLabel: null,
      timestamp: Date.UTC(2026, 8, 2, 12, 0, 0),
      isStreaming: false,
      messages: [
        {
          key: "m-steward",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "在" }],
          },
        },
      ],
    };
    const output = templateToString(
      renderMessageGroup(group, {
        showReasoning: false,
        assistantName: "大白管家",
        assistantAvatar: "大",
        sessionKey: "agent:main:main:space:alpha",
      }),
    );
    expect(output).toContain(">大<");
    expect(output).not.toContain(">群<");
  });

  it("shows the 1:1 robot icon in the same column as group chats, without a name", () => {
    const group = {
      kind: "group" as const,
      key: "group-direct-labeled",
      role: "assistant",
      senderLabel: "市场助手",
      timestamp: Date.UTC(2026, 8, 2, 12, 0, 0),
      isStreaming: false,
      messages: [
        {
          key: "m-direct",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "在的" }],
          },
        },
      ],
    };
    const output = templateToString(
      renderMessageGroup(group, {
        showReasoning: false,
        assistantName: "市场助手",
        assistantAvatar: "市",
        sessionKey: "agent:bot-2:main",
        onQuoteMessage: () => undefined,
      }),
    );
    expect(output).toContain('class="chat-avatar assistant"');
    expect(output).toContain(">市<");
    expect(output).not.toContain("chat-sender-name");
    expect(output).not.toContain("市场助手");
    expect(output).not.toContain("群成员");
    expect(output).not.toContain("chat-group--solo");
    expect(output.indexOf("chat-avatar assistant")).toBeLessThan(output.indexOf("在的"));
    const timestampAt = output.indexOf("chat-group-timestamp");
    const copyAt = output.indexOf("chat-copy-btn");
    const quoteAt = output.indexOf("chat-msg-quote-btn");
    expect(timestampAt).toBeGreaterThan(-1);
    expect(copyAt).toBeGreaterThan(timestampAt);
    expect(quoteAt).toBeGreaterThan(copyAt);
  });

  it("keeps only the owner avatar on 1:1 user turns", () => {
    const group = {
      kind: "group" as const,
      key: "group-owner-direct",
      role: "user",
      senderLabel: "CEO",
      timestamp: Date.UTC(2026, 8, 2, 8, 42, 0),
      isStreaming: false,
      messages: [
        {
          key: "m-owner",
          message: { id: "msg-owner-1", role: "user", content: "为何上面的 pdf 无法打开预览？" },
        },
      ],
    };
    const output = templateToString(
      renderMessageGroup(group, {
        showReasoning: false,
        localUserDisplayName: "CEO",
        sessionKey: "agent:bot-skill:main",
      }),
    );
    expect(output).toContain('class="chat-avatar user"');
    expect(output).toContain(">C<");
    expect(output).not.toContain("chat-sender-name");
    expect(output).not.toContain("chat-group-timestamp");
    expect(output).not.toContain("CEO");
  });

  it("keeps owner avatars in collaboration groups without names or timestamps", () => {
    const group = {
      kind: "group" as const,
      key: "group-owner-space",
      role: "user",
      senderLabel: "CEO",
      timestamp: Date.UTC(2026, 8, 2, 8, 42, 0),
      isStreaming: false,
      messages: [
        {
          key: "m-owner-space",
          message: { id: "msg-owner-space", role: "user", content: "hello" },
        },
      ],
    };
    const output = templateToString(
      renderMessageGroup(group, {
        showReasoning: false,
        localUserDisplayName: "CEO",
        sessionKey: "space:alpha",
      }),
    );
    expect(output).toContain('class="chat-avatar user"');
    expect(output).toContain(">C<");
    expect(output).not.toContain("chat-sender-name");
    expect(output).not.toContain("CEO");
    expect(output).not.toContain("chat-group-timestamp");
  });
});

describe("chat delivery bubble wiring", () => {
  const DABAI = [
    "本机微信客户端数据在容器目录里，不能直接当知识库。",
    "",
    "建议先导出到 ~/OpenBot/wechat-exports/，导出后把文件夹路径发给我。",
    "",
    "下一步",
    "把聊天记录导出到建议目录",
    "",
    "你选",
    "A · 按步骤导出（我带你）",
    "B · 我已有导出目录",
    "C · 只看客户端数据在哪",
  ].join("\n");

  function renderAssistant(
    text: string,
    opts: { isStreaming?: boolean; messageExtras?: Record<string, unknown> } = {},
  ) {
    const group = {
      kind: "group" as const,
      key: "group-delivery",
      role: "assistant",
      senderLabel: "大白管家",
      timestamp: Date.UTC(2026, 8, 4, 4, 0, 0),
      isStreaming: opts.isStreaming === true,
      messages: [
        {
          key: "m-delivery",
          message: {
            role: "assistant",
            content: [{ type: "text", text }],
            ...opts.messageExtras,
          },
        },
      ],
    };
    return templateToString(renderMessageGroup(group, { showReasoning: false }));
  }

  it("renders delivery chrome for 大白 1:1 envelope on final bubble", () => {
    const output = renderAssistant(DABAI);
    expect(output).toContain("chat-bubble--delivery");
    expect(output).toContain("chat-delivery__conclusion");
    expect(output).toContain("chat-delivery__next");
    expect(output).toContain("chat-delivery__choice");
    expect(output).toContain("把聊天记录导出到建议目录");
  });

  it("keeps delivery chrome while streaming so the skeleton does not jump", () => {
    const output = renderAssistant(DABAI, { isStreaming: true });
    expect(output).toContain("chat-bubble--delivery");
    expect(output).toContain("chat-delivery__conclusion");
    expect(output).toContain("chat-delivery__next");
  });

  it("does not paint historical thinking when showReasoning is off", () => {
    const group = {
      kind: "group" as const,
      key: "group-thinking",
      role: "assistant",
      senderLabel: "大白管家",
      timestamp: Date.UTC(2026, 8, 4, 4, 0, 0),
      isStreaming: false,
      messages: [
        {
          key: "m-thinking",
          message: {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "Let me inspect the sandbox path." },
              { type: "text", text: "本机微信客户端数据在容器目录里，不能直接当知识库。" },
            ],
          },
        },
      ],
    };
    const hidden = templateToString(renderMessageGroup(group, { showReasoning: false }));
    expect(hidden).not.toContain("chat-thinking");
    expect(hidden).toContain("chat-delivery__conclusion");
    const shown = templateToString(renderMessageGroup(group, { showReasoning: true }));
    expect(shown).toContain("chat-thinking-fold");
    expect(shown).toContain("chat-thinking");
  });

  it("puts copy and quote only on the last assistant text bubble of the turn", () => {
    const group = {
      kind: "group" as const,
      key: "group-fragments",
      role: "assistant",
      senderLabel: "Skill孵化",
      timestamp: Date.UTC(2026, 8, 2, 8, 42, 0),
      isStreaming: false,
      messages: [
        {
          key: "m-status-1",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "我先查一下这份 PDF 的实际状态和存储位置。" }],
          },
        },
        {
          key: "m-status-2",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "我找到了相关文件，先确认一下具体位置和状态。" }],
          },
        },
        {
          key: "m-final",
          message: {
            id: "msg-final-1",
            role: "assistant",
            content: [{ type: "text", text: "PDF 本身完好，内容也正常。问题出在存放位置上。" }],
          },
        },
      ],
    };
    const output = templateToString(
      renderMessageGroup(group, {
        showReasoning: false,
        sessionKey: "agent:bot-skill:main",
        onQuoteMessage: () => undefined,
      }),
    );
    expect(output.match(/chat-msg-quote-btn/g)).toHaveLength(1);
    expect(output.match(/chat-copy-btn(?!--)/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect((output.match(/chat-msg-actions/g) ?? []).length).toBe(1);
    expect((output.match(/chat-group-timestamp/g) ?? []).length).toBe(1);
    expect(output.indexOf("chat-group-timestamp")).toBeLessThan(output.indexOf("chat-copy-btn"));
    // Chinese process opener「我先…」is scratchpad (assistant-scratchpad CHINESE_SCRATCHPAD_RE);
    // showReasoning:false hides the pure-process bubble. Product answers stay visible in order.
    // Parent 090dcff5 and tip share this omission — not a tip regression; expects track scratchpad SoT.
    expect(output).not.toContain("我先查一下");
    expect(output).toContain("我找到了相关文件");
    expect(output.indexOf("我找到了相关文件")).toBeLessThan(output.indexOf("PDF 本身完好"));
    expect(output.indexOf("PDF 本身完好")).toBeLessThan(output.indexOf("chat-msg-actions"));
  });

  it("keeps the group robot icon in the original column beside the first line", () => {
    const group = {
      kind: "group" as const,
      key: "group-speaker-at-head",
      role: "assistant",
      senderLabel: "市场助手",
      timestamp: Date.UTC(2026, 8, 2, 13, 36, 0),
      isStreaming: false,
      messages: [
        {
          key: "m-process",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "我先查一下文档。" }],
          },
        },
        {
          key: "m-long",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "明白了，是 OpenBot 内部的协作空间。" }],
          },
        },
      ],
    };
    const output = templateToString(
      renderMessageGroup(group, {
        showReasoning: false,
        sessionKey: "space:market",
        onQuoteMessage: () => undefined,
      }),
    );
    expect(output).toContain('class="chat-avatar assistant"');
    expect(output).toContain(">市<");
    expect(output).not.toContain("chat-turn-speaker");
    expect(output).not.toContain("chat-avatar--lead");
    expect(output).not.toContain("chat-group--solo");
    // Process-only「我先查一下文档。」is scratchpad-stripped; avatar still leads the first
    // visible product bubble「明白了…」(same omission on parent 090dcff5 baseline).
    expect(output).not.toContain("我先查一下文档");
    expect(output.indexOf("chat-avatar assistant")).toBeLessThan(output.indexOf("明白了"));
    expect(output.indexOf("明白了")).toBeLessThan(output.indexOf("chat-msg-actions"));
    expect((output.match(/class="chat-avatar assistant"/g) ?? []).length).toBe(1);
    expect((output.match(/chat-msg-actions/g) ?? []).length).toBe(1);
    expect(output.indexOf("chat-group-timestamp")).toBeGreaterThan(output.indexOf("明白了"));
  });

  it("offers a quote action on completed assistant turns", () => {
    const group = {
      kind: "group" as const,
      key: "group-quote",
      role: "assistant",
      senderLabel: "大白管家",
      timestamp: Date.UTC(2026, 8, 4, 4, 0, 0),
      isStreaming: false,
      messages: [
        {
          key: "m-quote",
          message: {
            id: "msg-quote-1",
            role: "assistant",
            content: [{ type: "text", text: "先改邀请门槛，再给管理员开通员工席位。" }],
          },
        },
      ],
    };
    const output = templateToString(
      renderMessageGroup(group, {
        showReasoning: false,
        onQuoteMessage: () => undefined,
      }),
    );
    expect(output).toContain("chat-msg-quote-btn");
    expect(output).toContain("chat-copy-btn");
    expect(output).toContain("chat-msg-action-btn");
    expect(output.indexOf("chat-group-timestamp")).toBeLessThan(output.indexOf("chat-copy-btn"));
    expect(output).not.toContain("chat-sender-name");
    expect(output).not.toContain("chat-peer-route");
    expect(output).not.toContain("消息来自");
    expect(output).not.toContain("已发消息给");
    expect(output).toContain('class="chat-avatar assistant"');
  });

  it("degrades short chitchat to normal paragraph", () => {
    const output = renderAssistant("你好");
    expect(output).not.toContain("chat-bubble--delivery");
    expect(output).toContain("chat-text");
  });

  it("renders Lead+Supplement sample without option UI on supplement", () => {
    const lead = [
      "先做本地 sidecar 验收，再谈 LIVE 切流。",
      "",
      "Gateway 18789 已通；3000 仍缺协议引擎。",
      "",
      "下一步",
      "补上用户自备的 protocol 引擎并 curl 出真码",
      "",
      "你选",
      "A · 继续本机验收清单",
      "B · 先写协议引擎接入说明",
    ].join("\n");
    const leadOut = renderAssistant(lead);
    expect(leadOut).toContain("chat-delivery__choice");

    const supplement =
      "补充：curl 验收顺序是 TRANSPORT_UNCONFIGURED → PROTOCOL_ENGINE_UNCONFIGURED → 真 qrCodeUrl。";
    const supplementOut = renderAssistant(supplement, {
      messageExtras: { collaborationRole: "supplement" },
    });
    expect(supplementOut).toContain("chat-delivery__conclusion");
    expect(supplementOut).not.toContain("chat-delivery__choice");
  });

  it("renders another robot on the left with its own name, not the owner lane", async () => {
    await withZhCn(() => {
      const group = {
        kind: "group" as const,
        key: "group-peer",
        role: "peer",
        senderLabel: "大白管家",
        timestamp: Date.UTC(2026, 8, 28, 7, 0, 0),
        isStreaming: false,
        messages: [
          {
            key: "m-peer",
            message: {
              id: "msg-peer",
              role: "user",
              senderLabel: "大白管家",
              content: [
                "[任务接收]",
                "角色：客（接收方）",
                "主会话：agent:main:employee:90fed19a-1c8b-4420-87e0-bcc6165e32fa",
                "",
                "请准备明天的会议资料",
              ].join("\n"),
            },
          },
        ],
      };
      const output = templateToString(
        renderMessageGroup(group, {
          showReasoning: false,
          localUserDisplayName: "CEO",
          sessionKey: "agent:agt-secretary:main",
          onQuoteMessage: () => undefined,
        }),
      );
      expect(output).toContain('class="chat-group peer');
      expect(output).toContain('class="chat-avatar peer"');
      expect(output).toContain("chat-avatar--chip");
      expect(output).toContain(">大<");
      expect(output).toContain("大白管家");
      expect(output).toContain("消息来自");
      expect(output).toContain("请准备明天的会议资料");
      expect(output).not.toContain("chat-avatar user");
      expect(output).not.toContain("chat-group user");
      expect(output).not.toContain("chat-group-footer");
      expect(output).not.toContain("CEO");
      expect(output).not.toContain("90fed19a");
      expect(output).not.toContain("[任务接收]");
      const bodyAt = output.indexOf("请准备明天的会议资料");
      const actionsAt = output.indexOf("chat-msg-actions");
      const fromAt = output.indexOf("消息来自");
      const timeAt = output.indexOf("chat-group-timestamp");
      const copyAt = output.indexOf("chat-copy-btn");
      const menuAt = output.indexOf("chat-msg-quote-btn");
      expect((output.match(/chat-msg-actions/g) ?? []).length).toBe(1);
      expect(bodyAt).toBeGreaterThan(-1);
      expect(actionsAt).toBeGreaterThan(bodyAt);
      expect(fromAt).toBeGreaterThan(actionsAt);
      expect(timeAt).toBeGreaterThan(fromAt);
      expect(copyAt).toBeGreaterThan(timeAt);
      expect(menuAt).toBeGreaterThan(copyAt);
    });
  });

  it("renders a sent 1:1 line as 已发消息给 in the footer, including multiple targets", async () => {
    await withZhCn(() => {
      const group = {
        kind: "group" as const,
        key: "group-sent",
        role: "peer-out",
        senderLabel: "大白管家",
        peerLabels: ["大白管家", "高级秘书"],
        timestamp: Date.UTC(2026, 8, 28, 7, 5, 0),
        isStreaming: false,
        messages: [
          {
            key: "m-sent",
            message: {
              id: "msg-sent",
              role: "assistant",
              content: [{ type: "text", text: "请准备明天的会议资料" }],
              sentTo: [
                { label: "大白管家", agentId: "steward" },
                { label: "高级秘书", agentId: "secretary" },
              ],
              openclawPeerOutbound: true,
            },
          },
        ],
      };
      const output = templateToString(
        renderMessageGroup(group, {
          showReasoning: false,
          sessionKey: "agent:pm:main",
          onQuoteMessage: () => undefined,
        }),
      );
      expect(output).toContain('class="chat-group peer-out');
      expect(output).toContain("已发消息给");
      expect(output).toContain("大白管家");
      expect(output).toContain("高级秘书");
      expect(output).toContain("和");
      expect(output).toContain("请准备明天的会议资料");
      expect(output).not.toContain("消息来自");
      expect(output).not.toContain("[任务发出]");
      expect(output).not.toContain("chat-group-footer");
      const actionsAt = output.indexOf("chat-msg-actions");
      const sentAt = output.indexOf("已发消息给");
      const timeAt = output.indexOf("chat-group-timestamp");
      const copyAt = output.indexOf("chat-copy-btn");
      const menuAt = output.indexOf("chat-msg-quote-btn");
      expect((output.match(/chat-msg-actions/g) ?? []).length).toBe(1);
      expect(output.indexOf("请准备明天的会议资料")).toBeLessThan(actionsAt);
      expect(actionsAt).toBeLessThan(sentAt);
      expect(sentAt).toBeLessThan(timeAt);
      expect(timeAt).toBeLessThan(copyAt);
      expect(copyAt).toBeLessThan(menuAt);
      expect(output.indexOf("大白管家")).toBeLessThan(output.indexOf("高级秘书"));

      const processLike = {
        ...group,
        key: "group-sent-process",
        messages: [
          {
            key: "m-sent-process",
            message: {
              role: "assistant",
              openclawPeerOutbound: true,
              content: [{ type: "text", text: "我先查一下文档。" }],
              sentTo: [{ label: "大白管家", agentId: "steward" }],
            },
          },
        ],
      };
      const processOut = templateToString(
        renderMessageGroup(processLike, { showReasoning: false, sessionKey: "agent:pm:main" }),
      );
      expect(processOut).toContain("我先查一下文档。");
      expect(processOut).toContain("已发消息给");
    });
  });

  it("folds consecutive messages with the same peer into N 条消息往来", async () => {
    await withZhCn(() => {
      const received = {
        kind: "group" as const,
        key: "group-in",
        role: "peer",
        senderLabel: "大白管家",
        peerLabels: ["大白管家"],
        timestamp: Date.UTC(2026, 8, 28, 7, 0, 0),
        isStreaming: false,
        messages: [
          {
            key: "m-in",
            message: {
              role: "user",
              senderLabel: "大白管家",
              provenance: { kind: "inter_session", sourceSenderLabel: "大白管家" },
              content: [{ type: "text", text: "会议改到下午。" }],
            },
          },
        ],
      };
      const sent = {
        kind: "group" as const,
        key: "group-out",
        role: "peer-out",
        senderLabel: "大白管家",
        peerLabels: ["大白管家"],
        peerKey: "大白管家",
        timestamp: Date.UTC(2026, 8, 28, 7, 1, 0),
        isStreaming: false,
        messages: [
          {
            key: "m-out",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "下午三点可以。" }],
              sentTo: [{ label: "大白管家", agentId: "steward" }],
            },
          },
        ],
      };
      const assistant = {
        kind: "group" as const,
        key: "group-assistant",
        role: "assistant",
        senderLabel: "市场助手",
        timestamp: Date.UTC(2026, 8, 28, 7, 2, 0),
        isStreaming: false,
        messages: [
          {
            key: "m-assistant",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "这是市场助手的回复。" }],
            },
          },
        ],
      };
      const folded = foldPeerExchangeThread([received, sent, assistant]);
      expect(folded.map((item) => item.kind)).toEqual(["peer-exchange", "group"]);
      const exchange = folded[0];
      if (exchange?.kind !== "peer-exchange") {
        throw new Error("expected a peer exchange fold");
      }
      expect(exchange.count).toBe(2);
      expect(exchange.labels).toEqual(["大白管家"]);
      const output = templateToString(renderPeerExchange(exchange, { showReasoning: false }));
      expect(output).toContain("2 条消息往来：");
      expect(output).toContain("大白管家");
      expect(output).toContain("会议改到下午。");
      expect(output).toContain("下午三点可以。");
      expect(output).toContain("消息来自");
      expect(output).toContain("已发消息给");
      expect(output).toContain('<details class="chat-peer-exchange">');
      expect(output).not.toContain('chat-peer-exchange" open');
      const assistantOut = templateToString(
        renderMessageGroup(assistant, { showReasoning: false, sessionKey: "space:alpha" }),
      );
      expect(assistantOut).not.toContain("chat-sender-name");
      expect(assistantOut).not.toContain("chat-peer-route");
      expect(assistantOut).not.toContain("消息来自");
      expect(foldPeerExchangeThread([received]).map((item) => item.kind)).toEqual(["group"]);
    });
  });

  it("renders diagnosis conversation chips on a professional report", () => {
    const report = [
      "【诊断报告】",
      "",
      "一、结论与窗口",
      "对象：Skill孵化",
      "",
      "八、可执行建议",
      "[练未观察技能]",
      "执行者：被诊断数字人（Skill孵化）",
      "任务：请让Skill孵化用已安装技能 data-analysis 做一次练习。",
    ].join("\n");
    const output = renderAssistant(report);
    expect(output).toContain("diagnosis-chat-actions");
    expect(output).toContain("diagnosis-action-run");
    expect(output).toContain("练未观察技能");
    expect(templateToString(renderAssistant(report, { isStreaming: true }))).not.toContain(
      "diagnosis-chat-actions",
    );
    expect(renderAssistant("你好，任务：随便写一句。")).not.toContain("diagnosis-chat-actions");
  });
});

describe("formatGroupTimestamp", () => {
  it("uses the same explicit TZ for day boundary + display (Shanghai fixture)", async () => {
    const { formatGroupTimestamp, resolveChatTimestampTimeZone } =
      await import("./grouped-render.ts");
    expect(resolveChatTimestampTimeZone("Asia/Shanghai")).toBe("Asia/Shanghai");
    const now = Date.parse("2026-10-29T08:00:00.000Z"); // 16:00 +08 same calendar day probe
    const todayMorning = Date.parse("2026-10-29T01:24:18.823Z"); // 09:24 +08
    const priorDay = Date.parse("2026-10-24T01:22:38.940Z"); // 09:22 +08 on 10/24
    const tz = "Asia/Shanghai";
    const todayLabel = formatGroupTimestamp(todayMorning, now, tz);
    const priorLabel = formatGroupTimestamp(priorDay, now, tz);
    expect(todayLabel).toMatch(/9:24|09:24/);
    expect(todayLabel).not.toMatch(/10\/24|24日|2026/);
    expect(priorLabel).toMatch(/9:22|09:22/);
    expect(priorLabel).toMatch(/10|24/);
  });

  it("does not hardcode Shanghai — UTC fixture crosses a different calendar day", async () => {
    const { formatGroupTimestamp } = await import("./grouped-render.ts");
    // 2026-10-29T01:24Z is still 10/28 evening in America/Los_Angeles.
    const value = Date.parse("2026-10-29T01:24:18.823Z");
    const now = Date.parse("2026-10-29T08:00:00.000Z"); // still 10/29 morning UTC
    const shanghaiToday = formatGroupTimestamp(value, now, "Asia/Shanghai");
    const laLabel = formatGroupTimestamp(value, now, "America/Los_Angeles");
    expect(shanghaiToday).toMatch(/9:24|09:24/);
    expect(shanghaiToday).not.toMatch(/10\/28|28/);
    // LA: value is previous local calendar day vs now → must include a date component.
    expect(laLabel).toMatch(/10|28/);
  });

  it("invalid explicit IANA falls back browser → UTC without throwing", async () => {
    const { formatGroupTimestamp, isValidIanaTimeZone, resolveChatTimestampTimeZone } =
      await import("./grouped-render.ts");
    expect(isValidIanaTimeZone("Not/AZone")).toBe(false);
    expect(isValidIanaTimeZone("Asia/Shanghai")).toBe(true);
    const resolved = resolveChatTimestampTimeZone("Not/AZone");
    expect(resolved).toBeTruthy();
    expect(isValidIanaTimeZone(resolved)).toBe(true);
    // Must not throw when computing day boundaries with the illegal input.
    const now = Date.parse("2026-10-29T08:00:00.000Z");
    const value = Date.parse("2026-10-29T01:24:18.823Z");
    expect(() => formatGroupTimestamp(value, now, "Not/AZone")).not.toThrow();
    expect(formatGroupTimestamp(value, now, "Not/AZone").length).toBeGreaterThan(0);
    expect(resolveChatTimestampTimeZone("")).toBe(resolveChatTimestampTimeZone(null));
  });
});
