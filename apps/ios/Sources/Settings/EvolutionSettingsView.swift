import OpenBotKit
import SwiftUI

struct EvolutionSettingsView: View {
    @Environment(NodeAppModel.self) private var appModel
    let agentId: String
    @State private var model: EvolutionPerceptionModel?

    var body: some View {
        Group {
            if let model {
                EvolutionPerceptionScreen(model: model)
            } else {
                ProgressView("读取进化投影")
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            }
        }
        .navigationTitle("进化")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard self.model == nil else { return }
            let trimmed = self.agentId.trimmingCharacters(in: .whitespacesAndNewlines)
            self.model = EvolutionPerceptionModel(
                transport: NodeSessionEvolutionTransport(session: self.appModel.operatorSession),
                agentId: trimmed.isEmpty ? nil : trimmed)
        }
    }
}

private struct NodeSessionEvolutionTransport: EvolutionPerceptionTransport {
    let session: GatewayNodeSession

    func performEvolutionPerception(method: String, paramsJSON: String) async throws -> Data {
        guard EvolutionPerceptionMethod.isAllowed(method) else {
            throw EvolutionPerceptionClientError.forbiddenMethod(method)
        }
        return try await self.session.request(method: method, paramsJSON: paramsJSON, timeoutSeconds: 20)
    }
}
