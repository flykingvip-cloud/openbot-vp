import SwiftUI
import UIKit

/// Post-login four-tab companion: 对话 / 任务 / 知识 / 我的.
/// Visual + IA SoT: HTML preview + Android `PostOnboardingTabs` (not system `TabView`,
/// not Employee Shell WebView embeds as primary tab bodies).
struct EmployeeRootTabs: View {
    var onLogout: () -> Void

    @Environment(NodeAppModel.self) private var appModel

    @State private var activeTab: HomeTab = .chat
    @State private var keyboardVisible = false
    @State private var showEmployeeWorkbench = false

    private enum HomeTab: String, CaseIterable, Hashable {
        case chat
        case tasks
        case knowledge
        case me

        var label: String {
            switch self {
            case .chat: "对话"
            case .tasks: "任务"
            case .knowledge: "知识"
            case .me: "我的"
            }
        }

        /// SoT: 💬 / ☑ / 📖 / 👤 — SF Symbols stand-ins matching Android Material icons.
        var systemImage: String {
            switch self {
            case .chat: "bubble.left.fill"
            case .tasks: "checkmark.square.fill"
            case .knowledge: "book.fill"
            case .me: "person.fill"
            }
        }
    }

    var body: some View {
        ZStack {
            OpenBotMobileTokens.backgroundGradient
                .ignoresSafeArea()

            VStack(spacing: 0) {
                ZStack {
                    // Keep chat mounted so session/VM survives tab switches (slice 1).
                    ChatTabView(
                        gateway: self.appModel.operatorSession,
                        sessionKey: self.appModel.chatSessionKey)
                        .opacity(self.activeTab == .chat ? 1 : 0)
                        .allowsHitTesting(self.activeTab == .chat)
                        .accessibilityHidden(self.activeTab != .chat)

                    if self.activeTab == .tasks {
                        TasksTabView(gateway: self.appModel.operatorSession)
                    } else if self.activeTab == .knowledge {
                        KnowledgeTabView(gateway: self.appModel.operatorSession)
                    } else if self.activeTab == .me {
                        MeTabShell(
                            gateway: self.appModel.operatorSession,
                            onLogout: self.onLogout,
                            onOpenEmployeeWorkbench: { self.showEmployeeWorkbench = true })
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                if !(self.activeTab == .chat && self.keyboardVisible) {
                    self.bottomTabBar
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
            self.keyboardVisible = true
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            self.keyboardVisible = false
        }
        .fullScreenCover(isPresented: self.$showEmployeeWorkbench) {
            EmployeeWorkspaceView {
                self.showEmployeeWorkbench = false
                self.onLogout()
            }
        }
    }

    private var bottomTabBar: some View {
        HStack(spacing: 6) {
            ForEach(HomeTab.allCases, id: \.self) { tab in
                self.tabItem(tab)
            }
        }
        .padding(.horizontal, 10)
        .padding(.top, 10)
        .padding(.bottom, 10)
        .frame(maxWidth: .infinity)
        .background {
            UnevenRoundedRectangle(
                topLeadingRadius: OpenBotMobileTokens.tabBarCornerRadius,
                bottomLeadingRadius: 0,
                bottomTrailingRadius: 0,
                topTrailingRadius: OpenBotMobileTokens.tabBarCornerRadius,
                style: .continuous)
                .fill(OpenBotMobileTokens.tabBarBackground)
                .shadow(color: Color.black.opacity(0.06), radius: 8, y: -2)
                .overlay {
                    UnevenRoundedRectangle(
                        topLeadingRadius: OpenBotMobileTokens.tabBarCornerRadius,
                        bottomLeadingRadius: 0,
                        bottomTrailingRadius: 0,
                        topTrailingRadius: OpenBotMobileTokens.tabBarCornerRadius,
                        style: .continuous)
                        .stroke(OpenBotMobileTokens.border, lineWidth: 1)
                }
                .ignoresSafeArea(edges: .bottom)
        }
    }

    private func tabItem(_ tab: HomeTab) -> some View {
        let active = tab == self.activeTab
        return Button {
            self.activeTab = tab
        } label: {
            VStack(spacing: 2) {
                Image(systemName: tab.systemImage)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(active ? OpenBotMobileTokens.accent : OpenBotMobileTokens.textTertiary)
                Text(tab.label)
                    .font(OpenBotMobileTokens.caption2(active ? .bold : .medium))
                    .foregroundStyle(active ? OpenBotMobileTokens.accent : OpenBotMobileTokens.textSecondary)
            }
            .frame(maxWidth: .infinity)
            .frame(minHeight: OpenBotMobileTokens.tabBarMinItemHeight - 14)
            .padding(.horizontal, 6)
            .padding(.vertical, 7)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tab.label)
        .accessibilityAddTraits(active ? AccessibilityTraits.isSelected : AccessibilityTraits())
    }
}
