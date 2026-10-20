import Combine
import OpenBotKit
import SwiftUI
import UIKit

private enum OnboardingStep: Int, CaseIterable {
    case welcome
    case mode
    case connect
    case auth
    case success

    var previous: Self? {
        Self(rawValue: self.rawValue - 1)
    }

    var next: Self? {
        Self(rawValue: self.rawValue + 1)
    }

    /// Progress label for the manual setup flow (mode → connect → auth → success).
    var manualProgressTitle: String {
        let manualSteps: [OnboardingStep] = [.mode, .connect, .auth, .success]
        guard let idx = manualSteps.firstIndex(of: self) else { return "" }
        return "Step \(idx + 1) of \(manualSteps.count)"
    }

    var title: String {
        switch self {
        case .welcome: "Welcome"
        case .mode: "Connection Mode"
        case .connect: "Connect"
        case .auth: "Authentication"
        case .success: "Connected"
        }
    }

    var canGoBack: Bool {
        self != .welcome && self != .success
    }
}

struct OnboardingWizardView: View {
    @Environment(NodeAppModel.self) private var appModel: NodeAppModel
    @Environment(GatewayConnectionController.self) private var gatewayController: GatewayConnectionController
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("node.instanceId") private var instanceId: String = UUID().uuidString
    @AppStorage("gateway.discovery.domain") private var discoveryDomain: String = ""
    @AppStorage("onboarding.developerMode") private var developerModeEnabled: Bool = false
    @State private var step: OnboardingStep = .welcome
    @State private var selectedMode: OnboardingConnectionMode?
    @State private var manualHost: String = ""
    @State private var manualPort: Int = 18789
    @State private var manualPortText: String = "18789"
    @State private var manualTLS: Bool = true
    @State private var gatewayToken: String = ""
    @State private var gatewayPassword: String = ""
    @State private var connectMessage: String?
    @State private var statusLine: String = "使用云端账号密码登录。"
    @State private var connectingGatewayID: String?
    @State private var issue: GatewayConnectionIssue = .none
    @State private var didMarkCompleted = false
    @State private var pairingRequestId: String?
    @State private var discoveryRestartTask: Task<Void, Never>?
    @State private var lastPairingAutoResumeAttemptAt: Date?
    @State private var cloudBusy: Bool = false
    private static let pairingAutoResumeTicker = Timer.publish(every: 2.0, on: .main, in: .common).autoconnect()

    let allowSkip: Bool
    let onClose: () -> Void

    private var isFullScreenStep: Bool {
        self.step == .welcome || self.step == .success
    }

    var body: some View {
        NavigationStack {
            Group {
                switch self.step {
                case .welcome:
                    self.welcomeStep
                case .success:
                    self.successStep
                default:
                    Form {
                        switch self.step {
                        case .mode:
                            self.modeStep
                        case .connect:
                            self.connectStep
                        case .auth:
                            self.authStep
                        default:
                            EmptyView()
                        }
                    }
                    .scrollDismissesKeyboard(.interactively)
                }
            }
            .navigationTitle(self.isFullScreenStep ? "" : self.step.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                // Welcome/success are brand-first full-screen surfaces — no Close/Done chrome.
                if !self.isFullScreenStep {
                    ToolbarItem(placement: .principal) {
                        VStack(spacing: 2) {
                            Text(self.step.title)
                                .font(.headline)
                            Text(self.step.manualProgressTitle)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    ToolbarItem(placement: .topBarLeading) {
                        if self.step.canGoBack {
                            Button {
                                self.navigateBack()
                            } label: {
                                Label("Back", systemImage: "chevron.left")
                            }
                        }
                    }
                    ToolbarItemGroup(placement: .keyboard) {
                        Spacer()
                        Button("Done") {
                            UIApplication.shared.sendAction(
                                #selector(UIResponder.resignFirstResponder),
                                to: nil,
                                from: nil,
                                for: nil
                            )
                        }
                    }
                }
            }
            .toolbar(self.isFullScreenStep ? .hidden : .automatic, for: .navigationBar)
        }
        .gatewayTrustPromptAlert()
        .onAppear {
            self.initializeState()
        }
        .onDisappear {
            self.discoveryRestartTask?.cancel()
            self.discoveryRestartTask = nil
        }
        .onChange(of: self.discoveryDomain) { _, _ in
            self.scheduleDiscoveryRestart()
        }
        .onChange(of: self.manualPortText) { _, newValue in
            let digits = newValue.filter(\.isNumber)
            if digits != newValue {
                self.manualPortText = digits
                return
            }
            guard let parsed = Int(digits), parsed > 0 else {
                self.manualPort = 0
                return
            }
            self.manualPort = min(parsed, 65535)
        }
        .onChange(of: self.manualPort) { _, newValue in
            let normalized = newValue > 0 ? String(newValue) : ""
            if self.manualPortText != normalized {
                self.manualPortText = normalized
            }
        }
        .onChange(of: self.gatewayToken) { _, newValue in
            self.saveGatewayCredentials(token: newValue, password: self.gatewayPassword)
        }
        .onChange(of: self.gatewayPassword) { _, newValue in
            self.saveGatewayCredentials(token: self.gatewayToken, password: newValue)
        }
        .onChange(of: self.appModel.gatewayStatusText) { _, newValue in
            let next = GatewayConnectionIssue.detect(from: newValue)
            // Avoid "flip-flopping" the UI by clearing actionable issues when the underlying connection
            // transitions through intermediate statuses (e.g. Offline/Connecting while reconnect churns).
            if self.issue.needsPairing, next.needsPairing {
                // Keep the requestId sticky even if the status line omits it after we pause.
                let mergedRequestId = next.requestId ?? self.issue.requestId ?? self.pairingRequestId
                self.issue = .pairingRequired(requestId: mergedRequestId)
            } else if self.issue.needsPairing, !next.needsPairing {
                // Ignore non-pairing statuses until the user explicitly retries/scans again, or we connect.
            } else if self.issue.needsAuthToken, !next.needsAuthToken, !next.needsPairing {
                // Same idea for auth: once we learn credentials are missing/rejected, keep that sticky until
                // the user retries/scans again or we successfully connect.
            } else {
                self.issue = next
            }

            if let requestId = next.requestId, !requestId.isEmpty {
                self.pairingRequestId = requestId
            }

            // If the gateway tells us auth is missing/rejected, stop reconnect churn until the user intervenes.
            if next.needsAuthToken {
                self.appModel.gatewayAutoReconnectEnabled = false
            }

            if self.issue.needsAuthToken || self.issue.needsPairing {
                self.step = .auth
            }
            if !newValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                self.connectMessage = newValue
                self.statusLine = newValue
            }
        }
        .onChange(of: self.appModel.gatewayServerName) { _, newValue in
            guard newValue != nil else { return }
            self.statusLine = "Connected."
            if !self.didMarkCompleted, let selectedMode {
                OnboardingStateStore.markCompleted(mode: selectedMode)
                self.didMarkCompleted = true
            }
            self.onClose()
        }
        .onChange(of: self.scenePhase) { _, newValue in
            guard newValue == .active else { return }
            self.attemptAutomaticPairingResumeIfNeeded()
        }
        .onReceive(Self.pairingAutoResumeTicker) { _ in
            self.attemptAutomaticPairingResumeIfNeeded()
        }
    }

    @ViewBuilder
    private var welcomeStep: some View {
        PlatformAuthView { completion in
            switch completion {
            case let .authenticated(email):
                Task { await self.finishCloudAuth(email: email) }
            case .openManualSetup:
                self.step = .mode
            }
        }
    }

    @ViewBuilder
    private var modeStep: some View {
        Section("Connection Mode") {
            OnboardingModeRow(
                title: OnboardingConnectionMode.homeNetwork.title,
                subtitle: "LAN or Tailscale host",
                selected: self.selectedMode == .homeNetwork)
            {
                self.selectMode(.homeNetwork)
            }

            OnboardingModeRow(
                title: OnboardingConnectionMode.remoteDomain.title,
                subtitle: "VPS with domain",
                selected: self.selectedMode == .remoteDomain)
            {
                self.selectMode(.remoteDomain)
            }

            Toggle(
                "Developer mode",
                isOn: Binding(
                    get: { self.developerModeEnabled },
                    set: { newValue in
                        self.developerModeEnabled = newValue
                        if !newValue, self.selectedMode == .developerLocal {
                            self.selectedMode = nil
                        }
                    }))

            if self.developerModeEnabled {
                OnboardingModeRow(
                    title: OnboardingConnectionMode.developerLocal.title,
                    subtitle: "For local iOS app development",
                    selected: self.selectedMode == .developerLocal)
                {
                    self.selectMode(.developerLocal)
                }
            }
        }

        Section {
            Button("Continue") {
                self.step = .connect
            }
            .disabled(self.selectedMode == nil)
        }
    }

    @ViewBuilder
    private var connectStep: some View {
        if let selectedMode {
            Section {
                LabeledContent("Mode", value: selectedMode.title)
                LabeledContent("Discovery", value: self.gatewayController.discoveryStatusText)
                LabeledContent("Status", value: self.appModel.gatewayStatusText)
                LabeledContent("Progress", value: self.statusLine)
            } header: {
                Text("Status")
            } footer: {
                if let connectMessage {
                    Text(connectMessage)
                }
            }

            switch selectedMode {
            case .cloud:
                Section("Cloud") {
                    Text("使用账号密码登录后会自动连接 \(OpenBotCloudDefaults.wsHost)。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Button("返回登录") {
                        self.step = .welcome
                    }
                }
            case .homeNetwork:
                self.homeNetworkConnectSection
            case .remoteDomain:
                self.remoteDomainConnectSection
            case .developerLocal:
                self.developerConnectSection
            }
        } else {
            Section {
                Text("Choose a mode first.")
                Button("Back to Mode Selection") {
                    self.step = .mode
                }
            }
        }
    }

    private var homeNetworkConnectSection: some View {
        Group {
            Section("Discovered Gateways") {
                if self.gatewayController.gateways.isEmpty {
                    Text("No gateways found yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(self.gatewayController.gateways) { gateway in
                        let hasHost = self.gatewayHasResolvableHost(gateway)

                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(gateway.name)
                                if let host = gateway.lanHost ?? gateway.tailnetDns {
                                    Text(host)
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            Button {
                                Task { await self.connectDiscoveredGateway(gateway) }
                            } label: {
                                if self.connectingGatewayID == gateway.id {
                                    ProgressView()
                                        .progressViewStyle(.circular)
                                } else if !hasHost {
                                    Text("Resolving…")
                                } else {
                                    Text("Connect")
                                }
                            }
                            .disabled(self.connectingGatewayID != nil || !hasHost)
                        }
                    }
                }

                Button("Restart Discovery") {
                    self.gatewayController.restartDiscovery()
                }
                .disabled(self.connectingGatewayID != nil)
            }

            self.manualConnectionFieldsSection(title: "Manual Fallback")
        }
    }

    private var remoteDomainConnectSection: some View {
        self.manualConnectionFieldsSection(title: "Domain Settings")
    }

    private var developerConnectSection: some View {
        Section {
            TextField("Host", text: self.$manualHost)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            TextField("Port", text: self.$manualPortText)
                .keyboardType(.numberPad)
            Toggle("Use TLS", isOn: self.$manualTLS)
            self.manualConnectButton
        } header: {
            Text("Developer Local")
        } footer: {
            Text("Default host is localhost. Use your Mac LAN IP if simulator networking requires it.")
        }
    }

    private var authStep: some View {
        Group {
            Section("Authentication") {
                TextField("Gateway Auth Token", text: self.$gatewayToken)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Gateway Password", text: self.$gatewayPassword)

                if self.issue.needsAuthToken {
                    Text("Gateway rejected credentials. Sign in again with your cloud account or update token/password.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Auth token looks valid.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            if self.issue.needsPairing {
                Section {
                    Button {
                        self.resumeAfterPairingApproval()
                    } label: {
                        Label("Resume After Approval", systemImage: "arrow.clockwise")
                    }
                    .disabled(self.connectingGatewayID != nil)
                } header: {
                    Text("Pairing Approval")
                } footer: {
                    let requestLine: String = {
                        if let id = self.issue.requestId, !id.isEmpty {
                            return "Request ID: \(id)"
                        }
                        return "Request ID: check `openbot devices list`."
                    }()
                    Text(
                        "Approve this device on the gateway.\n"
                            + "1) `openbot devices approve` (or `openbot devices approve <requestId>`)\n"
                            + "2) `/pair approve` in your OpenBot chat\n"
                            + "\(requestLine)\n"
                            + "OpenBot will also retry automatically when you return to this app.")
                }
            }

            Section {
                Button {
                    Task { await self.retryLastAttempt() }
                } label: {
                    if self.connectingGatewayID == "retry" {
                        ProgressView()
                            .progressViewStyle(.circular)
                    } else {
                        Text("Retry Connection")
                    }
                }
                .disabled(self.connectingGatewayID != nil)
            }
        }
    }

    private var successStep: some View {
        VStack(spacing: 0) {
            Spacer()

            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 64))
                .foregroundStyle(.green)
                .padding(.bottom, 20)

            Text("Connected")
                .font(.largeTitle.weight(.bold))
                .padding(.bottom, 8)

            let server = self.appModel.gatewayServerName ?? "gateway"
            Text(server)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .padding(.bottom, 4)

            if let addr = self.appModel.gatewayRemoteAddress {
                Text(addr)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Button {
                self.onClose()
            } label: {
                Text("Open OpenBot")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .padding(.horizontal, 24)
            .padding(.bottom, 48)
        }
    }

    @ViewBuilder
    private func manualConnectionFieldsSection(title: String) -> some View {
        Section(title) {
            TextField("Host", text: self.$manualHost)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            TextField("Port", text: self.$manualPortText)
                .keyboardType(.numberPad)
            Toggle("Use TLS", isOn: self.$manualTLS)
            TextField("Discovery Domain (optional)", text: self.$discoveryDomain)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            self.manualConnectButton
        }
    }

    private var manualConnectButton: some View {
        Button {
            Task { await self.connectManual() }
        } label: {
            if self.connectingGatewayID == "manual" {
                HStack(spacing: 8) {
                    ProgressView()
                        .progressViewStyle(.circular)
                    Text("Connecting…")
                }
            } else {
                Text("Connect")
            }
        }
        .disabled(!self.canConnectManual || self.connectingGatewayID != nil)
    }

    private func resumeAfterPairingApproval() {
        // We intentionally stop reconnect churn while unpaired to avoid generating multiple pending requests.
        self.appModel.gatewayAutoReconnectEnabled = true
        self.appModel.gatewayPairingPaused = false
        self.appModel.gatewayPairingRequestId = nil
        // Pairing state is sticky to prevent UI flip-flop during reconnect churn.
        // Once the user explicitly resumes after approving, clear the sticky issue
        // so new status/auth errors can surface instead of being masked as pairing.
        self.issue = .none
        self.connectMessage = "Retrying after approval…"
        self.statusLine = "Retrying after approval…"
        Task { await self.retryLastAttempt() }
    }

    private func resumeAfterPairingApprovalInBackground() {
        // Keep the pairing issue sticky to avoid visual flicker while we probe for approval.
        self.appModel.gatewayAutoReconnectEnabled = true
        self.appModel.gatewayPairingPaused = false
        self.appModel.gatewayPairingRequestId = nil
        Task { await self.retryLastAttempt(silent: true) }
    }

    private func attemptAutomaticPairingResumeIfNeeded() {
        guard self.scenePhase == .active else { return }
        guard self.step == .auth else { return }
        guard self.issue.needsPairing else { return }
        guard self.connectingGatewayID == nil else { return }

        let now = Date()
        if let last = self.lastPairingAutoResumeAttemptAt, now.timeIntervalSince(last) < 6 {
            return
        }
        self.lastPairingAutoResumeAttemptAt = now
        self.resumeAfterPairingApprovalInBackground()
    }

    private func navigateBack() {
        guard let target = self.step.previous else { return }
        self.connectingGatewayID = nil
        self.connectMessage = nil
        self.step = target
    }
    private var canConnectManual: Bool {
        let host = self.manualHost.trimmingCharacters(in: .whitespacesAndNewlines)
        return !host.isEmpty && self.manualPort > 0 && self.manualPort <= 65535
    }

    private func initializeState() {
        if self.manualHost.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            if let last = GatewaySettingsStore.loadLastGatewayConnection() {
                switch last {
                case let .manual(host, port, useTLS, _):
                    self.manualHost = host
                    self.manualPort = port
                    self.manualTLS = useTLS
                case .discovered:
                    self.manualHost = "openbot.local"
                    self.manualPort = 18789
                    self.manualTLS = true
                }
            } else {
                self.manualHost = "openbot.local"
                self.manualPort = 18789
                self.manualTLS = true
            }
        }
        self.manualPortText = self.manualPort > 0 ? String(self.manualPort) : ""
        if self.selectedMode == nil {
            self.selectedMode = OnboardingStateStore.lastMode()
        }
        if self.selectedMode == .developerLocal &&
            (self.manualHost == "openbot.local")
        {
            self.manualHost = "localhost"
            self.manualTLS = false
        }

        let trimmedInstanceId = self.instanceId.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedInstanceId.isEmpty {
            self.gatewayToken = GatewaySettingsStore.loadGatewayToken(instanceId: trimmedInstanceId) ?? ""
            self.gatewayPassword = GatewaySettingsStore.loadGatewayPassword(instanceId: trimmedInstanceId) ?? ""
        }

    }


    private func scheduleDiscoveryRestart() {
        self.discoveryRestartTask?.cancel()
        self.discoveryRestartTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else { return }
            self.gatewayController.restartDiscovery()
        }
    }

    private func saveGatewayCredentials(token: String, password: String) {
        let trimmedInstanceId = self.instanceId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedInstanceId.isEmpty else { return }
        let trimmedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
        GatewaySettingsStore.saveGatewayToken(trimmedToken, instanceId: trimmedInstanceId)
        let trimmedPassword = password.trimmingCharacters(in: .whitespacesAndNewlines)
        GatewaySettingsStore.saveGatewayPassword(trimmedPassword, instanceId: trimmedInstanceId)
    }

    private func connectDiscoveredGateway(_ gateway: GatewayDiscoveryModel.DiscoveredGateway) async {
        self.connectingGatewayID = gateway.id
        self.issue = .none
        self.connectMessage = "Connecting to \(gateway.name)…"
        self.statusLine = "Connecting to \(gateway.name)…"
        defer { self.connectingGatewayID = nil }
        await self.gatewayController.connect(gateway)
    }

    private func selectMode(_ mode: OnboardingConnectionMode) {
        self.selectedMode = mode
        self.applyModeDefaults(mode)
    }

    private func applyModeDefaults(_ mode: OnboardingConnectionMode) {
        let host = self.manualHost.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let hostIsDefaultLike =
            host.isEmpty || host == "openbot.local" || host == "localhost"

        switch mode {
        case .cloud:
            self.manualHost = OpenBotCloudDefaults.wsHost
            self.manualTLS = true
            self.manualPort = OpenBotCloudDefaults.wsPort
        case .homeNetwork:
            if hostIsDefaultLike { self.manualHost = "openbot.local" }
            self.manualTLS = true
            if self.manualPort <= 0 || self.manualPort > 65535 { self.manualPort = 18789 }
        case .remoteDomain:
            if host == "openbot.local" || host == "localhost" {
                self.manualHost = ""
            }
            self.manualTLS = true
            if self.manualPort <= 0 || self.manualPort > 65535 { self.manualPort = 18789 }
        case .developerLocal:
            if hostIsDefaultLike { self.manualHost = "localhost" }
            self.manualTLS = false
            if self.manualPort <= 0 || self.manualPort > 65535 { self.manualPort = 18789 }
        }
    }

    private func gatewayHasResolvableHost(_ gateway: GatewayDiscoveryModel.DiscoveredGateway) -> Bool {
        let lanHost = gateway.lanHost?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !lanHost.isEmpty { return true }
        let tailnetDns = gateway.tailnetDns?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return !tailnetDns.isEmpty
    }

    private func finishCloudAuth(email: String) async {
        if self.cloudBusy { return }
        self.cloudBusy = true
        self.statusLine = "已登录 \(email)，正在打开工作台…"
        defer { self.cloudBusy = false }
        self.selectedMode = .cloud
        await CloudConnectionApplier.applyAfterLogin(gatewayController: self.gatewayController)
        self.didMarkCompleted = true
        // Notify RootView to switch to EmployeeWorkspaceView (Mac-aligned).
        NotificationCenter.default.post(name: .openBotCloudAuthSucceeded, object: nil)
        self.onClose()
    }

    private func connectManual() async {
        let host = self.manualHost.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !host.isEmpty, self.manualPort > 0, self.manualPort <= 65535 else { return }
        self.connectingGatewayID = "manual"
        self.issue = .none
        self.connectMessage = "Connecting to \(host)…"
        self.statusLine = "Connecting to \(host):\(self.manualPort)…"
        defer { self.connectingGatewayID = nil }
        await self.gatewayController.connectManual(host: host, port: self.manualPort, useTLS: self.manualTLS)
    }

    private func retryLastAttempt(silent: Bool = false) async {
        self.connectingGatewayID = silent ? "retry-auto" : "retry"
        // Keep current auth/pairing issue sticky while retrying to avoid Step 3 UI flip-flop.
        if !silent {
            self.connectMessage = "Retrying…"
            self.statusLine = "Retrying last connection…"
        }
        defer { self.connectingGatewayID = nil }
        await self.gatewayController.connectLastKnown()
    }
}

private struct OnboardingModeRow: View {
    let title: String
    let subtitle: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: self.action) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(self.title)
                        .font(.body.weight(.semibold))
                    Text(self.subtitle)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: self.selected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(self.selected ? Color.accentColor : Color.secondary)
            }
        }
        .buttonStyle(.plain)
    }
}
