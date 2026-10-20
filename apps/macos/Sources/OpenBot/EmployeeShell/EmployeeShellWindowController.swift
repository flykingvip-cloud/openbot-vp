//
//  EmployeeShellWindowController.swift
//  Main-window host for the embedded employee shell (task 1.5-macos, D-MACOS-FORM).
//
//  macOS embeds the employee shell in a real app window (not a menu-bar popover),
//  while the menu-bar companion (Canvas / voice / exec / node pairing) is retained
//  unchanged. Full web parity (no `shell=mobile`).
//
//  Stage 53 / ADR option 1: this window IS the desktop employee Web shell.
//  Do not grow a native four-tab IA here; do not fold employee tabs into the
//  menu-bar popover.
//

import AppKit
import WebKit

@MainActor
final class EmployeeShellWindowController: NSWindowController, NSWindowDelegate {
    private var shell: EmployeeShellWebViewController?
    var onSessionUnauthorized: () -> Void = {}
    var onNativeIntent: (EmployeeShellIntent) -> Void = { _ in }
    var onEmbedReady: () -> Void = {}

    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false)
        window.title = EmployeeShellStrings.string(.windowTitle)
        window.titlebarAppearsTransparent = false
        window.isReleasedWhenClosed = false
        window.center()
        window.setFrameAutosaveName("EmployeeShellWindow")
        window.minSize = NSSize(width: 720, height: 520)
        self.init(window: window)
        window.delegate = self
    }

    /// Install (or replace) the shell content bound to `config` and show the window.
    func present(config: EmployeeShellConfig) {
        let controller = EmployeeShellWebViewController(
            config: config,
            onIntent: { [weak self] intent in self?.onNativeIntent(intent) },
            onBootstrapError: { [weak self] error in
                if let e = error as? EmployeeShellBootstrapError, e == .unauthorized {
                    self?.onSessionUnauthorized()
                }
            })
        controller.onEmbedReady = { [weak self] in self?.onEmbedReady() }
        self.shell?.teardown()
        self.shell = controller
        self.window?.contentViewController = controller
        self.showAndFocus()
    }

    func showAndFocus() {
        NSApp.activate(ignoringOtherApps: true)
        self.showWindow(nil)
        self.window?.makeKeyAndOrderFront(nil)
    }

    func navigate(toEmbedPath path: String) {
        self.shell?.navigate(toEmbedPath: path)
    }

    func reBootstrap() {
        self.shell?.reBootstrap()
    }

    var hasShell: Bool { self.shell != nil }

    func windowWillClose(_: Notification) {
        self.shell?.teardown()
        self.shell = nil
    }
}
