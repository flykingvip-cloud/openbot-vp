import OpenBotKit
import SwiftUI

struct SupervisorNodeBindSettingsSection: View {
    @AppStorage(supervisorNodeBindTenantIdKey) private var tenantId = ""
    @AppStorage(supervisorNodeBindSeatIdKey) private var seatId = ""
    @State private var bindStatus: String?
    @State private var bindInFlight = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("开发监督")
                .font(.title3.weight(.semibold))
                .frame(maxWidth: .infinity, alignment: .leading)

            Text(
                "将本 Mac 绑定为租户席位的 Node Agent。"
                    + "需本地 IDE 登录的 Cursor / Devin 监督任务将在此机执行。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            self.fieldRow(title: "租户 ID", prompt: "租户 ID", text: self.$tenantId)
            self.fieldRow(title: "席位 ID", prompt: "席位 ID", text: self.$seatId)

            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("Node ID")
                    .font(.callout.weight(.medium))
                    .frame(width: 88, alignment: .leading)
                Text(MacSupervisorNodeBinder.localNodeId)
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            HStack(spacing: 10) {
                Button(self.bindInFlight ? "绑定中…" : "立即绑定") {
                    Task { await self.bindNow() }
                }
                .disabled(self.bindInFlight || self.tenantId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    || self.seatId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                if MacSupervisorNodeBinder.isConfigured {
                    Text("Node 重连时自动绑定")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if let bindStatus {
                Text(bindStatus)
                    .font(.caption)
                    .foregroundStyle(bindStatus.hasPrefix("已绑定") ? .green : .secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func fieldRow(title: String, prompt: String, text: Binding<String>) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(title)
                .font(.callout.weight(.medium))
                .frame(width: 88, alignment: .leading)
            TextField(prompt, text: text)
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 320, alignment: .leading)
        }
    }

    @MainActor
    private func bindNow() async {
        self.bindInFlight = true
        defer { self.bindInFlight = false }
        let result = await MacSupervisorNodeBinder.bindNow(
            tenantId: self.tenantId,
            seatId: self.seatId)
        switch result {
        case .success:
            self.bindStatus = "已绑定 Gateway。若任务仍未命中本机，请重新以 Node 模式连接。"
        case let .failure(error):
            self.bindStatus = error.localizedDescription
        }
    }
}

#if DEBUG
extension SupervisorNodeBindSettingsSection {
    static func exerciseForTesting() {
        let view = SupervisorNodeBindSettingsSection()
        _ = view.body
    }
}
#endif
