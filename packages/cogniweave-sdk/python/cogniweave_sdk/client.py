from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from .errors import ApiError, CogniWeaveError
from .models import Scope, to_json_dict


def _normalize_base_url(base_url: str) -> str:
    return base_url.rstrip("/")


@dataclass(slots=True)
class CogniWeaveClient:
    base_url: str
    default_scope: Scope | None = None
    timeout_seconds: float = 10.0
    default_headers: dict[str, str] | None = None

    def __post_init__(self) -> None:
        self.base_url = _normalize_base_url(self.base_url)
        self.default_headers = self.default_headers or {}

    def _resolve_scope(self, scope: Scope | None, *, operation: str) -> Scope:
        resolved = scope or self.default_scope
        if not resolved:
            raise CogniWeaveError(f"{operation} requires scope (or configure default_scope)")
        return resolved

    def _request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        url = f"{self.base_url}{path}"
        merged_headers = {
            "content-type": "application/json",
            **(self.default_headers or {}),
            **(headers or {}),
        }
        data = json.dumps(to_json_dict(payload)).encode("utf-8") if payload is not None else None
        request = Request(url=url, method=method.upper(), headers=merged_headers, data=data)
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                raw = response.read().decode("utf-8")
                if not raw.strip():
                    return None
                return json.loads(raw)
        except HTTPError as err:
            body_text = err.read().decode("utf-8")
            try:
                body_json = json.loads(body_text) if body_text else None
            except json.JSONDecodeError:
                body_json = body_text
            raise ApiError(err.code, body_text or err.reason, body=body_json) from err
        except URLError as err:
            raise CogniWeaveError(f"Failed to connect to CogniWeave service: {err}") from err

    def frame_task(
        self,
        raw_input: str | dict[str, Any],
        *,
        scope: Scope | None = None,
        hints: dict[str, Any] | None = None,
        force_llm: bool = False,
    ) -> dict[str, Any]:
        resolved_scope = self._resolve_scope(scope, operation="frame_task")
        payload: dict[str, Any] = {
            "rawInput": raw_input,
            "scope": resolved_scope.to_payload(),
        }
        if hints:
            payload["hints"] = hints
        if force_llm:
            payload["forceLlm"] = True
        return self._request("POST", "/v1/tasks/frame", payload=payload)

    def reason(
        self,
        task_frame: dict[str, Any],
        *,
        max_paths: int = 5,
        include_explainability: bool = True,
        include_optional_evidence_refs: bool = False,
    ) -> dict[str, Any]:
        payload = {
            "taskFrame": task_frame,
            "maxPaths": max_paths,
            "includeExplainability": include_explainability,
            "includeOptionalEvidenceRefs": include_optional_evidence_refs,
        }
        return self._request("POST", "/v1/reason", payload=payload)

    def reason_with_debug(
        self,
        task_frame: dict[str, Any],
        *,
        max_paths: int = 10,
    ) -> dict[str, Any]:
        payload = {
            "taskFrame": task_frame,
            "maxPaths": max_paths,
        }
        return self._request("POST", "/v1/reason/debug", payload=payload)

    def ingest(
        self,
        raw_input: str | dict[str, Any],
        *,
        scope: Scope | None = None,
        source_type: str,
        source_session_id: str | None = None,
        source_turn_range: tuple[int, int] | None = None,
    ) -> dict[str, Any]:
        resolved_scope = self._resolve_scope(scope, operation="ingest")
        payload: dict[str, Any] = {
            "rawInput": raw_input,
            "scope": resolved_scope.to_payload(),
            "sourceType": source_type,
        }
        if source_session_id:
            payload["sourceSessionId"] = source_session_id
        if source_turn_range:
            payload["sourceTurnRange"] = [source_turn_range[0], source_turn_range[1]]
        return self._request("POST", "/v1/ingest", payload=payload)

    def distill(
        self,
        raw_input: str | dict[str, Any],
        *,
        scope: Scope | None = None,
        source_type: str,
        source_session_id: str | None = None,
        source_turn_range: tuple[int, int] | None = None,
        force_rebuild: bool = False,
    ) -> dict[str, Any]:
        resolved_scope = self._resolve_scope(scope, operation="distill")
        payload: dict[str, Any] = {
            "rawInput": raw_input,
            "scope": resolved_scope.to_payload(),
            "sourceType": source_type,
            "forceRebuild": force_rebuild,
        }
        if source_session_id:
            payload["sourceSessionId"] = source_session_id
        if source_turn_range:
            payload["sourceTurnRange"] = [source_turn_range[0], source_turn_range[1]]
        return self._request("POST", "/v1/distill", payload=payload)

    def write_back(
        self,
        raw_input: str | dict[str, Any],
        *,
        scope: Scope | None = None,
        source_type: str = "agent_run",
        source_session_id: str | None = None,
        source_turn_range: tuple[int, int] | None = None,
        package: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        resolved_scope = self._resolve_scope(scope, operation="write_back")
        payload: dict[str, Any] = {
            "rawInput": raw_input,
            "scope": resolved_scope.to_payload(),
            "sourceType": source_type,
            "package": package,
        }
        if source_session_id:
            payload["sourceSessionId"] = source_session_id
        if source_turn_range:
            payload["sourceTurnRange"] = [source_turn_range[0], source_turn_range[1]]
        headers = {"Idempotency-Key": idempotency_key} if idempotency_key else None
        return self._request("POST", "/v1/write-back", payload=payload, headers=headers)

    def trace(self, atom_id: str, *, scope: Scope | None = None) -> dict[str, Any]:
        resolved_scope = self._resolve_scope(scope, operation="trace")
        return self._request(
            "GET",
            f"/v1/atoms/{quote(atom_id)}/trace",
            headers=resolved_scope.to_headers(),
        )

    def trace_package(self, package_id: str, *, scope: Scope | None = None) -> dict[str, Any]:
        resolved_scope = self._resolve_scope(scope, operation="trace_package")
        return self._request(
            "GET",
            f"/v1/packages/{quote(package_id)}/trace",
            headers=resolved_scope.to_headers(),
        )

    def trace_reasoning_session(self, session_id: str, *, scope: Scope | None = None) -> dict[str, Any]:
        resolved_scope = self._resolve_scope(scope, operation="trace_reasoning_session")
        return self._request(
            "GET",
            f"/v1/reasoning-sessions/{quote(session_id)}/trace",
            headers=resolved_scope.to_headers(),
        )

    def resolve_evidence(
        self,
        *,
        atom_id: str | None = None,
        evidence_id: str | None = None,
        include_content: bool = False,
        scope: Scope | None = None,
    ) -> dict[str, Any] | list[dict[str, Any]]:
        resolved_scope = self._resolve_scope(scope, operation="resolve_evidence")
        payload: dict[str, Any] = {
            "atomId": atom_id,
            "evidenceId": evidence_id,
            "includeContent": include_content,
            "scope": resolved_scope.to_payload(),
        }
        return self._request("POST", "/v1/evidence/resolve", payload=payload)

    def get_evidence_refs(self, atom_id: str, *, scope: Scope | None = None) -> list[str]:
        resolved_scope = self._resolve_scope(scope, operation="get_evidence_refs")
        result = self._request(
            "GET",
            f"/v1/atoms/{quote(atom_id)}/evidence-refs",
            headers=resolved_scope.to_headers(),
        )
        return result if isinstance(result, list) else []

    def repair_indexes(
        self,
        *,
        journal_id: str | None = None,
        scope: Scope | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"journalId": journal_id}
        if scope or self.default_scope:
            payload["scope"] = self._resolve_scope(scope, operation="repair_indexes").to_payload()
        return self._request("POST", "/v1/repair/indexes", payload=payload)

    def rebuild_from_truth(self, *, object_type: str, object_id: str) -> dict[str, Any]:
        payload = {"objectType": object_type, "objectId": object_id}
        return self._request("POST", "/v1/rebuild/from-truth", payload=payload)

    def get_write_journal(self, journal_id: str, *, scope: Scope | None = None) -> dict[str, Any]:
        resolved_scope = self._resolve_scope(scope, operation="get_write_journal")
        return self._request(
            "GET",
            f"/v1/journals/{quote(journal_id)}",
            headers=resolved_scope.to_headers(),
        )
