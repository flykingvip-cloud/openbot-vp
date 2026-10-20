// @vitest-environment jsdom
import { render } from "lit";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { renderAccountComputerLoginThreadCards } from "./account-computer-login-cards.ts";

beforeAll(async () => {
  await i18n.setLocale("zh-CN");
});

describe("account computer login cards", () => {
  it("renders a one-time method choice and a save prompt in the thread", () => {
    const onChoose = vi.fn();
    const onSave = vi.fn();
    const container = document.createElement("div");
    render(
      renderAccountComputerLoginThreadCards({
        sessionKey: "session-1",
        choice: {
          choiceId: "choice-1",
          sessionKey: "session-1",
          host: "login.example.com",
          methods: ["password", "qr"],
        },
        save: {
          saveId: "save-1",
          sessionKey: "session-1",
          host: "login.example.com",
        },
        onChoose,
        onSave,
      }),
      container,
    );
    expect(container.querySelector("[data-login-choice='choice-1']")?.textContent).toContain(
      "选择登录方式",
    );
    expect(container.textContent).toContain("是否保存该网站登录信息");
    container.querySelector<HTMLButtonElement>("[data-login-method='password']")?.click();
    container.querySelector<HTMLButtonElement>("[data-login-save='yes']")?.click();
    expect(onChoose).toHaveBeenCalledWith("choice-1", "password");
    expect(onSave).toHaveBeenCalledWith("save-1", true);
  });

  it("hides cards for another session", () => {
    const container = document.createElement("div");
    render(
      renderAccountComputerLoginThreadCards({
        sessionKey: "session-1",
        choice: {
          choiceId: "choice-1",
          sessionKey: "other",
          host: "login.example.com",
          methods: ["password", "qr"],
        },
      }),
      container,
    );
    expect(container.querySelector("[data-login-choice]")).toBeNull();
  });
});
