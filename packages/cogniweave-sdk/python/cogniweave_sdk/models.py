from dataclasses import asdict, dataclass
from typing import Literal


ScopeVisibility = Literal["private", "shared"]


@dataclass(slots=True)
class Scope:
    workspace_id: str
    project_id: str
    agent_id: str
    visibility: ScopeVisibility = "private"

    def to_payload(self) -> dict[str, str]:
        return {
            "workspaceId": self.workspace_id,
            "projectId": self.project_id,
            "agentId": self.agent_id,
            "visibility": self.visibility,
        }

    def to_headers(self) -> dict[str, str]:
        return {
            "x-cogniweave-workspace-id": self.workspace_id,
            "x-cogniweave-project-id": self.project_id,
            "x-cogniweave-agent-id": self.agent_id,
            "x-cogniweave-visibility": self.visibility,
        }


def to_json_dict(value: object) -> object:
    if isinstance(value, Scope):
        return value.to_payload()
    if hasattr(value, "__dataclass_fields__"):
        return asdict(value)  # type: ignore[arg-type]
    if isinstance(value, list):
        return [to_json_dict(item) for item in value]
    if isinstance(value, dict):
        return {key: to_json_dict(item) for key, item in value.items()}
    return value
