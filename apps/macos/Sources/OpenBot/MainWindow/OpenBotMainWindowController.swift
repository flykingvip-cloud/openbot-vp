import AppKit
import Foundation

extension Notification.Name {
    static let openOpenBotMainWindow = Notification.Name("ai.openbot.mac.openMainWindow")
}

@MainActor
enum OpenBotMainWindowController {
    static let shared = OpenBotMainWindowControllerProxy()
}

@MainActor
final class OpenBotMainWindowControllerProxy {
    func show() {
        DockIconManager.shared.temporarilyShowDock()
        NotificationCenter.default.post(name: .openOpenBotMainWindow, object: nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}
