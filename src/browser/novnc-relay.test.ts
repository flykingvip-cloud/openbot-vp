import { describe, expect, it } from "vitest";
import { sandboxDesktopHotspots } from "./novnc-observer-http.js";
import { drainRfbClientPending, forwardRfbClientBytes } from "./novnc-relay.js";
import { desEncryptBlock, rfbVncAuthResponse } from "./novnc-rfb-des.js";

function pointerEvent(x: number, y: number, mask: number): Buffer {
  const bytes = Buffer.alloc(6);
  bytes[0] = 5;
  bytes[1] = mask;
  bytes.writeUInt16BE(x, 2);
  bytes.writeUInt16BE(y, 4);
  return bytes;
}

const KEY_EVENT = Buffer.from([0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x61]);
const POINTER_EVENT = Buffer.from([0x05, 0x01, 0x00, 0x0a, 0x00, 0x14]);
const FRAMEBUFFER_REQUEST = Buffer.from([
  0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

describe("noVNC relay input filter", () => {
  it("matches the DES test vector used by RFB auth", () => {
    const key = Uint8Array.from(Buffer.from("133457799BBCDFF1", "hex"));
    const plain = Uint8Array.from(Buffer.from("0123456789ABCDEF", "hex"));
    expect(Buffer.from(desEncryptBlock(key, plain)).toString("hex")).toBe("85e813540f0ab405");
    const challenge = Buffer.alloc(16, 7);
    expect(rfbVncAuthResponse(challenge, "secretvn").toString("hex")).toBe(
      "5809655dff39a78f5809655dff39a78f",
    );
  });

  it("forwards pointer down and up on the Chrome, files, and terminal icons when input is on", () => {
    const fb = sandboxDesktopHotspots(1280, 800);
    for (const target of [fb.chrome, fb.files, fb.terminal]) {
      const down = pointerEvent(target.cx, target.cy, 1);
      const up = pointerEvent(target.cx, target.cy, 0);
      const click = Buffer.concat([down, up]);
      expect(forwardRfbClientBytes(click, true).equals(click)).toBe(true);
      expect(forwardRfbClientBytes(click, false).length).toBe(0);
      const split = drainRfbClientPending(down.subarray(0, 2), true);
      const rest = drainRfbClientPending(
        Buffer.concat([split.pending, down.subarray(2), up]),
        true,
      );
      expect(rest.invalid).toBe(false);
      expect(Buffer.concat([split.forward, rest.forward]).equals(click)).toBe(true);
    }
  });

  it("forwards a takeover pointer click unchanged and drops it when input is off", () => {
    // Framebuffer center of the 1280×800 desktop: x=640 (0x0280), y=400 (0x0190).
    const click = Buffer.from([0x05, 0x01, 0x02, 0x80, 0x01, 0x90]);
    expect(forwardRfbClientBytes(click, true).equals(click)).toBe(true);
    expect(forwardRfbClientBytes(click, false).length).toBe(0);
  });

  it("forwards framebuffer requests and drops key and pointer bytes when input is off", () => {
    const mixed = Buffer.concat([KEY_EVENT, FRAMEBUFFER_REQUEST, POINTER_EVENT]);
    const viewed = forwardRfbClientBytes(mixed, false);
    expect(viewed.equals(FRAMEBUFFER_REQUEST)).toBe(true);
    const controlled = forwardRfbClientBytes(mixed, true);
    expect(controlled.equals(mixed)).toBe(true);
  });

  it("drops a key split across chunks and rejects an unknown RFB type", () => {
    const first = drainRfbClientPending(KEY_EVENT.subarray(0, 3), false);
    expect(first.forward.length).toBe(0);
    expect(first.invalid).toBe(false);
    const second = drainRfbClientPending(
      Buffer.concat([first.pending, KEY_EVENT.subarray(3), POINTER_EVENT, FRAMEBUFFER_REQUEST]),
      false,
    );
    expect(second.invalid).toBe(false);
    expect(second.forward.equals(FRAMEBUFFER_REQUEST)).toBe(true);
    expect(drainRfbClientPending(Buffer.from([0x99]), false).invalid).toBe(true);
  });
});
