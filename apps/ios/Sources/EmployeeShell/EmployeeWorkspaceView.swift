import SwiftUI

/// Post-login employee workbench host (WKWebView embed), matching macOS `SignedInWorkspaceView`.
///
/// Important: shell load failures must NOT auto-logout. Auto-clearing the platform
/// session is what made login immediately bounce back to the login form.
struct EmployeeWorkspaceView: View {
    var onLogout: () -> Void

    @State private var phase: Phase = .loading
    @State private var statusMessage = "正在打开员工工作台…"
    @State private var reloadToken = 0
    @State private var readyTimeoutTask: Task<Void, Never>?
    @State private var didExit = false

    private enum Phase {
        case loading
        case ready
        case failed
    }

    var body: some View {
        ZStack {
            if self.phase != .failed {
                EmployeeShellWebView(
                    config: EmployeeShellConfig(
                        gatewayBaseURL: OpenBotCloudDefaults.baseURL,
                        initialTarget: EmployeeShellBootstrap.defaultTarget,
                        tokenProvider: { target in
                            try await EmployeeShellBootstrap.mintToken(
                                baseURL: OpenBotCloudDefaults.baseURL,
                                session: PlatformAuthClient.urlSession,
                                target: target)
                        }),
                    onIntent: { intent in
                        self.handleIntent(intent)
                    },
                    onBootstrapError: { error in
                        self.fail(Self.describe(error))
                    },
                    onPublicAuthNavigation: {
                        self.fail("工作台会话未能同步到网页容器。请点「重试」；若仍失败，确认账号已加入企业后再登录。")
                    },
                    onEmbedReady: {
                        self.markReady()
                    })
                    .id(self.reloadToken)
                    .ignoresSafeArea()
                    .opacity(self.phase == .ready ? 1 : 0)
                    .allowsHitTesting(self.phase == .ready)
            }

            if self.phase == .loading {
                self.loadingOverlay
            }

            if self.phase == .failed {
                self.failureOverlay
            }
        }
        .onAppear {
            self.didExit = false
            self.startReadyTimeout()
        }
        .onDisappear {
            self.readyTimeoutTask?.cancel()
        }
    }

    private var loadingOverlay: some View {
        VStack(spacing: 16) {
            ProgressView()
                .controlSize(.large)
            Text(self.statusMessage)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(red: 0.965, green: 0.960, blue: 0.949))
    }

    private var failureOverlay: some View {
        VStack(spacing: 14) {
            Text("无法打开员工工作台")
                .font(.headline)
            Text(self.statusMessage)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
            HStack(spacing: 12) {
                Button("重试") {
                    self.retry()
                }
                .buttonStyle(.borderedProminent)
                Button("返回登录") {
                    self.returnToAuth()
                }
                .buttonStyle(.bordered)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(red: 0.965, green: 0.960, blue: 0.949))
    }

    private func handleIntent(_ intent: EmployeeShellIntent) {
        switch intent {
        case .ready:
            self.markReady()
        case .openChat, .openAssistant, .openSpace, .openKnowledgeObject, .openDeviceSettings:
            break
        }
    }

    private func markReady() {
        self.readyTimeoutTask?.cancel()
        withAnimation(.easeInOut(duration: 0.2)) {
            self.phase = .ready
        }
    }

    private func startReadyTimeout() {
        self.readyTimeoutTask?.cancel()
        self.readyTimeoutTask = Task {
            try? await Task.sleep(nanoseconds: 20_000_000_000)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                if self.phase == .loading {
                    self.fail("工作台加载超时。请点「重试」；若反复失败，确认账号已加入企业。")
                }
            }
        }
    }

    private func retry() {
        self.didExit = false
        self.phase = .loading
        self.statusMessage = "正在打开员工工作台…"
        self.reloadToken += 1
        self.startReadyTimeout()
    }

    /// Keep the platform session. Only 「返回登录」 clears cookies.
    private func fail(_ message: String) {
        self.statusMessage = message
        self.phase = .failed
        self.readyTimeoutTask?.cancel()
    }

    private func returnToAuth() {
        guard !self.didExit else { return }
        self.didExit = true
        Task {
            await PlatformAuthClient.logout()
            WorkspaceEntryPolicy.setCloudSignedIn(false)
            WorkspaceEntryPolicy.setPreferEmployeeShell(false)
            self.onLogout()
        }
    }

    private static func describe(_ error: Error) -> String {
        if let typed = error as? EmployeeShellBootstrapError {
            switch typed {
            case .unauthorized:
                return "无法签发工作台令牌：登录会话无效，或账号尚未加入企业。请点「重试」，或返回登录后用邀请码加入企业。"
            case .missingToken:
                return "无法获取工作台令牌。请点「重试」。"
            case .badURL:
                return "工作台地址无效。"
            case .badResponse:
                return "工作台服务响应异常。"
            }
        }
        return error.localizedDescription
    }
}

enum WorkspaceEntryPolicy {
    static let preferEmployeeShellKey = "workspace.preferEmployeeShell"
    static let cloudSignedInKey = "workspace.cloudSignedIn"

    static var preferEmployeeShell: Bool {
        UserDefaults.standard.bool(forKey: preferEmployeeShellKey)
    }

    static var cloudSignedIn: Bool {
        UserDefaults.standard.bool(forKey: cloudSignedInKey)
    }

    static func setPreferEmployeeShell(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: preferEmployeeShellKey)
    }

    static func setCloudSignedIn(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: cloudSignedInKey)
    }
}
