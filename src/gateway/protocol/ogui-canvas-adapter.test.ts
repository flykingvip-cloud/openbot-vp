import { describe, expect, it } from "vitest";
import {
  OGUI_CANVAS_A2UI_POLICY,
  isOguiCanvasUserActionName,
  mustNotForceChoiceIntoCanvas,
  oguiAnswerToCanvasUserAction,
  routeOguiComponent,
} from "./ogui-canvas-adapter.js";

describe("routeOguiComponent", () => {
  it("keeps form and choice on chat-inline", () => {
    expect(routeOguiComponent({ type: "form", schema_version: "ogui/v1" })).toBe("chat-inline");
    expect(routeOguiComponent({ type: "choice", schema_version: "ogui/v1" })).toBe("chat-inline");
  });
});

describe("mustNotForceChoiceIntoCanvas", () => {
  it("returns true (policy guard)", () => {
    expect(
      mustNotForceChoiceIntoCanvas({
        schema_version: "ogui/v1",
        type: "choice",
        component_id: "c1",
        label: "继续？",
        options: [
          { value: "yes", label: "是" },
          { value: "no", label: "否" },
        ],
      }),
    ).toBe(true);
  });
});

describe("oguiAnswerToCanvasUserAction", () => {
  it("maps answer to sendUserAction-shaped payload without inventing ui.* RPC", () => {
    const payload = oguiAnswerToCanvasUserAction({
      schema_version: "ogui/v1",
      component_id: "biz-model-form-1",
      submission_id: "550e8400-e29b-41d4-a716-446655440000",
      answers: { channel: "hybrid" },
      submitted_at: "2026-10-13T05:00:00.000Z",
    });
    expect(payload.context).not.toHaveProperty("decision_id");
    expect(payload).toEqual({
      name: "ogui.answer",
      surfaceId: "main",
      sourceComponentId: "biz-model-form-1",
      context: {
        schema_version: "ogui/v1",
        component_id: "biz-model-form-1",
        submission_id: "550e8400-e29b-41d4-a716-446655440000",
        answers: { channel: "hybrid" },
        submitted_at: "2026-10-13T05:00:00.000Z",
        continue_agent: true,
        does_not_bypass_steward_or_exec_approvals: true,
      },
    });
  });
});

describe("oguiAnswerToCanvasUserAction lifecycle ref", () => {
  it("forwards decision_id and decision_version together", () => {
    const payload = oguiAnswerToCanvasUserAction({
      schema_version: "ogui/v1",
      component_id: "biz-model-form-1",
      submission_id: "550e8400-e29b-41d4-a716-446655440000",
      decision_id: "dec-1",
      decision_version: 2,
      answers: { channel: "hybrid" },
    });
    expect(payload.context.decision_id).toBe("dec-1");
    expect(payload.context.decision_version).toBe(2);
    expect(payload.context.submission_id).toBe("550e8400-e29b-41d4-a716-446655440000");
  });
});

describe("isOguiCanvasUserActionName", () => {
  it("recognizes ogui.answer only", () => {
    expect(isOguiCanvasUserActionName("ogui.answer")).toBe(true);
    expect(isOguiCanvasUserActionName("hello")).toBe(false);
  });
});

describe("OGUI_CANVAS_A2UI_POLICY", () => {
  it("stays on A2UI v0.8 without createSurface", () => {
    expect(OGUI_CANVAS_A2UI_POLICY.supportedA2uiVersion).toBe("0.8");
    expect(OGUI_CANVAS_A2UI_POLICY.createSurfaceSupported).toBe(false);
    expect(OGUI_CANVAS_A2UI_POLICY.simpleChoicesGoTo).toBe("chat-inline");
  });
});
