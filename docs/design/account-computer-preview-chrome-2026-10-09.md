# Account Computer preview chrome

Date: 2026-10-09

The preview bar is Control UI chrome. It sits outside the remote framebuffer and does not cover Chromium.

## Header order

While the computer surface is docked or expanded:

1. **返回桌面** / Show desktop — unmap cloud apps so the dock icons return. It does not hand control back and does not close the preview.
2. **全屏** — enters fullscreen. Escape or the header X leaves fullscreen and restores the docked preview. The X is labeled 退出全屏. 返回桌面, 全屏, and 给AI are not drawn on the fullscreen picture.
3. **给AI** / Give to AI — the previous 交还 control. Same handback. 接管 stays when this chat does not hold the desktop.
4. **关闭预览** / Close preview — the sidebar close while the preview is docked or expanded. In fullscreen the same X leaves fullscreen and returns to the docked preview. It does not close the sidebar from fullscreen.

Fullscreen hides 返回桌面, 全屏, and 给AI, plus the 成果/电脑 tabs and the operator mark. The X stays in the sidebar header. Docked and expanded previews width-fit the 1280×800 desktop to the pane (top/bottom letterbox when the pane is taller). Fullscreen width-fits the same desktop and bottom-aligns it so a wide pane fills left-to-right; if height overflows, the stage clips the top (wallpaper) and keeps the Dock on screen — not a cover crop of the Dock.

## 返回桌面

The button calls `__openbotShowDesktop()` on the visible, non-inert computer iframe. That hook lives on the noVNC page, so the click does not depend on `postMessage` `event.source`. If the frame is cross-origin, the button falls back to `{ source: "openbot-control-ui", type: "show_desktop" }`, and the iframe accepts that message from any ancestor window.

The hook writes classic RFB KeyEvent messages (type 4) for Shift, Control, Alt, and D up, then Control+Alt+D. It does not call `sendKey` with `KeyD` / `ControlLeft` / `AltLeft`. noVNC turns those codes into a QEMU extended key event (type 255) when the server advertises that pseudo-encoding, and x11vnc 0.9.16 closes the session on type 255 instead of pressing the chord. If the RFB client is not connected yet, the chord is sent once on `connect`.

Openbox still binds `C-A-d` to `openbot-sandbox-desktop --show-desktop`, which unmaps visible apps (`wmctrl` hidden). The desktop poll then maps the dock shelf. The relay still drops the chord when this session has no input grant. Dock icon clicks still raise an app; they do not hide it.

The Files window lists `/tmp/openbot-home`, `openbot-desktop.log`, and `openbot-openbox.log`. Those names live in the sandbox browser image tip (the COPY of the entrypoint). An older image still shows `openclaw-*` until `scripts/sandbox-browser-setup.sh` is rebuilt and the browser container is recreated. That rebuild is not a production cutover.

## Re-verify 返回桌面

This key path is the observer page served by the gateway. Restart or redeploy that gateway, then reload the computer preview so the iframe fetches a new `/sandbox/novnc` document. A sandbox image rebuild is not required when that image already has the `C-A-d` bind (`xdotool key ctrl+alt+d` already unmaps Chromium).

1. Open 电脑 and take over so this chat holds input. 给AI is shown, and the iframe `data-input-forward` is true (not `inert`).
2. With Chromium mapped (`xprop` `WM_STATE` `IsViewable`), click 返回桌面. Chromium becomes `IsUnMapped` and the dock icons return. The preview sidebar stays open. 全屏, 给AI, and 关闭预览 stay in the same slots.
3. Fullscreen has no 返回桌面 title. Leave fullscreen with the X or Escape, then click 返回桌面. 关闭预览 on the docked bar still closes the sidebar.

## Files window

Openbox draws no titlebar on the window titled 文件. The path bar keeps **上一级** and adds a large **关闭** that destroys the window (also on `WM_DELETE_WINDOW`). With no other app mapped, the dock shelf returns.

## Demo

Files 关闭 needs a sandbox browser image built with `scripts/sandbox-browser-setup.sh`. 返回桌面 uses the gateway observer page: restart that gateway and reload the preview. Rebuild the image only when `xdotool key ctrl+alt+d` does not already unmap Chromium. The header labels and fullscreen slot do not need that rebuild.

1. Open 电脑, not fullscreen. Order is 返回桌面, 全屏, 接管 or 给AI, 关闭预览. 全屏 does not float over the picture.
2. Click 全屏. 返回桌面, 全屏, and 给AI disappear. The whole desktop stays visible, including the dock. The X returns to the docked bar (the sidebar stays open). Escape does the same. On the docked bar those three titles show again, and 关闭预览 closes the sidebar. The docked picture fills the pane width.
3. With input, click 返回桌面 while Chromium, Files, or the terminal is up. The picture returns to the wallpaper and the three dock icons.
4. Open Files, go up to `/`. 上一级 still changes directory. 关闭 dismisses the window and the dock icons come back.
