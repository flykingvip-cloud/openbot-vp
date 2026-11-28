"""Python DTO drafts for Wave-V21-0 contracts. Validation lives in validate.py."""
from __future__ import annotations
from typing import Any, Dict, List, Optional, Union

class LLMInvokeRequest(object):
    __slots__ = ('tenant_id', 'user_id', 'agent_id', 'trace_id', 'run_id', 'plan_id', 'policy_generation', 'provider', 'messages', 'max_output_tokens')
class LLMInvokeResponse(object):
    __slots__ = ('tenant_id', 'trace_id', 'run_id', 'provider', 'text', 'fallback_used', 'usage')
class EmbedRequest(object):
    __slots__ = ('tenant_id', 'policy_generation', 'provider', 'inputs')
class EmbedResponse(object):
    __slots__ = ('tenant_id', 'provider', 'vectors', 'dim')
class RerankRequest(object):
    __slots__ = ('tenant_id', 'policy_generation', 'provider', 'query', 'candidates')
class RerankResponse(object):
    __slots__ = ('tenant_id', 'provider', 'rankings')
class ModeADeclaration(object):
    __slots__ = ('mode', 'tenant_id', 'policy_generation', 'freshness_ts', 'masking_receipt', 'tombstone', 'user_delegation_handle', 'query_kind')
class ModeBDeclaration(object):
    __slots__ = ('mode', 'tenant_id', 'policy_generation', 'freshness_ts', 'masking_receipt', 'tombstone', 'service_credential_handle', 'row_level_predicate', 'query_kind')
class ModeCDeclaration(object):
    __slots__ = ('mode', 'tenant_id', 'policy_generation', 'freshness_ts', 'masking_receipt', 'tombstone', 'snapshot_id', 'query_kind')
class MemoryDiscoveryMetadata(object):
    __slots__ = ('tenant_id', 'resource_type', 'memory_resource_id', 'owner_agent_id', 'policy_generation', 'discoverable', 'freshness_ts', 'label')
class Channel4InvalidationNotice(object):
    __slots__ = ('notice_id', 'tenant_id', 'memory_resource_id', 'policy_generation', 'channel', 'reason_code')
class RevocationPurgeReceipt(object):
    __slots__ = ('task_id', 'tenant_id', 'subject_id', 'policy_generation', 'channels', 'purged', 'hash_algorithm', 'receipt_hash')
class AIExecutionTrace(object):
    __slots__ = ('tenant_id', 'user_id', 'agent_id', 'trace_id', 'run_id', 'plan_id', 'policy_generation', 'cost_attribution')

DTO_NAMES = (
    'LLMInvokeRequest', 'LLMInvokeResponse', 'EmbedRequest', 'EmbedResponse',
    'RerankRequest', 'RerankResponse', 'ModeADeclaration', 'ModeBDeclaration',
    'ModeCDeclaration', 'MemoryDiscoveryMetadata', 'Channel4InvalidationNotice',
    'RevocationPurgeReceipt', 'AIExecutionTrace',
)
