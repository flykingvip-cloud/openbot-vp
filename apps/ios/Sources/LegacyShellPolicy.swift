import Foundation
import SwiftUI

enum LegacyShellPolicy {
    private static let envKey = "OPENBOT_ENABLE_LEGACY_UI_SHELL"

    /// Native RootCanvas remains available for onboarding + manual gateway setup.
    /// After cloud login, `RootView` prefers `EmployeeWorkspaceView` (员工工作台).
    /// - Debug: ON by default (so simulator Run isn't stuck on the frozen placeholder).
    /// - Release: OFF by default; set `OPENBOT_ENABLE_LEGACY_UI_SHELL=1` to re-enable.
    /// Explicit env always wins (`1/true/yes/on` or `0/false/no/off`).
    static var isLegacyShellEnabled: Bool {
        if let raw = ProcessInfo.processInfo.environment[Self.envKey]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased(),
            !raw.isEmpty
        {
            switch raw {
            case "1", "true", "yes", "on":
                return true
            case "0", "false", "no", "off":
                return false
            default:
                return false
            }
        }
        #if DEBUG
        return true
        #else
        return false
        #endif
    }
}

struct LegacyShellDisabledView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Legacy UI Disabled")
                .font(.title3.weight(.semibold))
            Text(
                "This native shell is frozen behind OPENBOT_ENABLE_LEGACY_UI_SHELL. "
                    + "Use the new OpenBot surfaces or re-enable the legacy shell for fallback testing.")
                .foregroundStyle(.secondary)
            Text("Debug tip: leave the env unset (defaults ON), or set OPENBOT_ENABLE_LEGACY_UI_SHELL=1 in the Run scheme.")
                .font(.footnote)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(24)
    }
}
