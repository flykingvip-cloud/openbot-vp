// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { toSanitizedMarkdownHtml } from "../markdown.ts";
import { handleCodeBlockCopyClick, withCodeBlockCopyButtons } from "./code-block-copy.ts";
import { renderMessageGroup } from "./grouped-render.ts";

const COMMAND = "npx --yes openbot node run --host example.internal --port 443 --tls";

function renderMarkdown(markdown: string): HTMLElement {
  const host = document.createElement("div");
  host.className = "chat-text";
  host.innerHTML = withCodeBlockCopyButtons(toSanitizedMarkdownHtml(markdown));
  document.body.appendChild(host);
  return host;
}

describe("withCodeBlockCopyButtons", () => {
  it("attaches one copy button per code block", () => {
    const host = renderMarkdown(
      ["Try one of these:", "", "```", COMMAND, "```", "", "```", "npm run build", "```"].join(
        "\n",
      ),
    );

    expect(host.querySelectorAll(".chat-code-block")).toHaveLength(2);
    expect(host.querySelectorAll(".chat-copy-btn--code")).toHaveLength(2);
    // The code stays inside its own wrapper, untouched.
    expect(host.querySelector(".chat-code-block pre")?.textContent).toContain(COMMAND);
  });

  it("leaves prose-only markdown untouched", () => {
    const plain = toSanitizedMarkdownHtml("Just a sentence with `inline code`.");
    expect(withCodeBlockCopyButtons(plain)).toBe(plain);
  });
});

describe("handleCodeBlockCopyClick", () => {
  it("copies only the clicked code block, not the whole message", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const host = renderMarkdown(
      ["Problem found. Two options:", "", "```", COMMAND, "```"].join("\n"),
    );
    host.addEventListener("click", handleCodeBlockCopyClick);

    const button = host.querySelector(".chat-copy-btn--code");
    expect(button).not.toBeNull();
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

    const copied = writeText.mock.calls[0]?.[0] as string;
    expect(copied.trim()).toBe(COMMAND);
    expect(copied).not.toContain("Problem found");
  });

  it("ignores clicks outside a code copy button", () => {
    const host = renderMarkdown(["```", COMMAND, "```"].join("\n"));
    const pre = host.querySelector("pre");
    const event = new MouseEvent("click", { bubbles: true });
    pre?.dispatchEvent(event);
    expect(handleCodeBlockCopyClick(event)).toBe(false);
  });
});

describe("assistant message bubble", () => {
  it("wires the code-block copy button end to end, without a whole-message copy button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    render(
      renderMessageGroup(
        {
          kind: "group",
          key: "group-1",
          role: "assistant",
          senderLabel: "大白管家",
          timestamp: Date.UTC(2026, 7, 1, 8, 0, 0),
          isStreaming: false,
          messages: [
            {
              key: "m-1",
              message: {
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: ["问题找到了，推荐第一个：", "", "```bash", COMMAND, "```"].join("\n"),
                  },
                ],
              },
            },
          ],
        } as never,
        { showReasoning: false },
      ),
      container,
    );

    const bubble = container.querySelector(".chat-bubble");
    expect(bubble).not.toBeNull();
    expect(bubble?.querySelectorAll(".chat-copy-btn--code")).toHaveLength(1);
    expect(bubble?.querySelector(".chat-copy-btn--inline")).toBeNull();

    bubble
      ?.querySelector(".chat-copy-btn--code")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0]?.[0] as string | undefined;
    expect(copied?.trim()).toBe(COMMAND);
  });
});
