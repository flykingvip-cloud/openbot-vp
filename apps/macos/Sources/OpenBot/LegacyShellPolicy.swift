import Foundation
import SwiftUI

enum LegacyShellPolicy {
    private static let envKey = "OPENBOT_ENABLE_LEGACY_UI_SHELL"

    static var isLegacyShellEnabled: Bool {
        guard let raw = ProcessInfo.processInfo.environment[Self.envKey]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased(),
            !raw.isEmpty
        else {
            return false
        }
        switch raw {
        case "1", "true", "yes", "on":
            return true
        default:
            return false
        }
    }
}

struct LegacyShellDisabledMenuContent: View {
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("OpenBot")
                .font(.headline)
            Text("打开主窗口以登录或进入工作区。")
                .font(.caption)
                .foregroundStyle(.secondary)
            Divider()
            Button("打开主窗口") {
                self.openMainWindow()
            }
            Button("Quit") {
                NSApplication.shared.terminate(nil)
            }
        }
        .padding(12)
        .frame(width: 280, alignment: .leading)
        .onReceive(NotificationCenter.default.publisher(for: .openOpenBotMainWindow)) { _ in
            self.openMainWindow()
        }
    }

    private func openMainWindow() {
        DockIconManager.shared.temporarilyShowDock()
        self.openWindow(id: OpenBotMainWindow.id)
        NSApp.activate(ignoringOtherApps: true)
    }
}

struct LegacyShellDisabledSettingsView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("OpenBot")
                .font(.title3.weight(.semibold))
            Text("请从菜单栏选择「打开主窗口」进行登录或进入工作区。")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(24)
    }
}
