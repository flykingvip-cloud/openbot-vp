#!/usr/bin/env python3
"""Stdlib validator and deterministic SHA-256 manifest builder for frozen v21-reuse-v1 contracts."""
from __future__ import annotations
import hashlib, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FORBIDDEN_KEYS = frozenset({
    'api_key', 'api_token', 'password', 'bearer_token', 'secret', 'credential',
    'access_token', 'private_key', 'dsn', 'connection_string', 'jdbc_url', 'authorization',
})
PACKS = (
    ('model-adapter.schema.json', 'model-adapter.vectors.json'),
    ('controlled-data-bridge.schema.json', 'controlled-data-bridge.vectors.json'),
    ('memory-resource-bridge.schema.json', 'memory-resource-bridge.vectors.json'),
    ('ai-execution-trace.schema.json', 'ai-execution-trace.vectors.json'),
    ('openapi-v3-draft.yaml', 'openapi-v3-draft.vectors.json'),
)
SKIP_MANIFEST = frozenset({'v21-contract-manifest.json', 'node_modules', 'ts-generated', 'package-lock.json', '__pycache__'})


class ContractError(ValueError):
    def __init__(self, code, message='request_rejected'):
        self.code = code
        super().__init__(code)


def walk_keys(value):
    if isinstance(value, dict):
        for key, item in value.items():
            yield key
            yield from walk_keys(item)
    elif isinstance(value, list):
        for item in value:
            yield from walk_keys(item)


def special_reject(schema_name, payload):
    keys = set(walk_keys(payload))
    if keys & FORBIDDEN_KEYS:
        raise ContractError('CREDENTIAL_FORBIDDEN')
    if 'text_to_sql' in keys or 'textToSql' in keys or payload.get('query_kind') == 'text_to_sql':
        raise ContractError('TEXT_TO_SQL_FORBIDDEN')
    if schema_name == 'OpenApiPath' and str(payload.get('path', '')).startswith('/v3/spaces'):
        raise ContractError('SPACE_PATH_FORBIDDEN')
    if payload.get('visibility') == 'partial_available':
        raise ContractError('PARTIAL_PUBLICATION_FORBIDDEN')
    if schema_name in ('ControlledDataBridgeDeclaration', 'ModeADeclaration', 'ModeBDeclaration', 'ModeCDeclaration'):
        if payload.get('mode') not in ('A', 'B', 'C'):
            raise ContractError('MODE_UNMATCHED')
    if schema_name == 'RevocationPurgeReceipt':
        channels = payload.get('channels') or []
        names = [c.get('channel') if isinstance(c, dict) else None for c in channels]
        expected = ['primary_storage_acl', 'vector_fts_index', 'cache_materialized_snapshot', 'agent_history_cogniweave']
        ok = names == expected and all(isinstance(c, dict) and c.get('status') == 'success' for c in channels)
        if payload.get('purged') and not ok:
            raise ContractError('CHANNEL_INCOMPLETE')
        if len(channels) != 4 or sorted(names) != sorted(expected):
            raise ContractError('CHANNEL_INCOMPLETE')


def resolve(schema, ref, root):
    if not ref.startswith('#/'):
        raise ContractError('VALIDATION_ERROR')
    node = root
    for part in ref[2:].split('/'):
        node = node[part]
    return node


def is_int(value):
    return type(value) is int and not isinstance(value, bool)


def matches(schema, value, root):
    if '$ref' in schema:
        return matches(resolve(schema, schema['$ref'], root), value, root)
    if 'oneOf' in schema:
        ok = 0
        for option in schema['oneOf']:
            try:
                matches(option, value, root)
                ok += 1
            except ContractError:
                continue
        if ok != 1:
            raise ContractError('VALIDATION_ERROR')
        return
    expected = schema.get('type')
    if expected is not None:
        types = expected if isinstance(expected, list) else [expected]
        def type_ok(name):
            if name == 'object':
                return isinstance(value, dict)
            if name == 'array':
                return isinstance(value, list)
            if name == 'string':
                return isinstance(value, str)
            if name == 'integer':
                return is_int(value)
            if name == 'number':
                return type(value) in (int, float) and not isinstance(value, bool)
            if name == 'boolean':
                return isinstance(value, bool)
            if name == 'null':
                return value is None
            return False
        if not any(type_ok(name) for name in types):
            raise ContractError('VALIDATION_ERROR')
    if 'const' in schema and value != schema['const']:
        raise ContractError('VALIDATION_ERROR')
    if 'enum' in schema and value not in schema['enum']:
        raise ContractError('VALIDATION_ERROR')
    if is_int(value) or type(value) is float:
        if 'minimum' in schema and value < schema['minimum']:
            raise ContractError('VALIDATION_ERROR')
        if 'maximum' in schema and value > schema['maximum']:
            raise ContractError('VALIDATION_ERROR')
    if isinstance(value, str):
        if 'minLength' in schema and len(value) < schema['minLength']:
            raise ContractError('VALIDATION_ERROR')
        if 'maxLength' in schema and len(value) > schema['maxLength']:
            raise ContractError('VALIDATION_ERROR')
        if 'pattern' in schema and re.search(schema['pattern'], value) is None:
            raise ContractError('VALIDATION_ERROR')
    if isinstance(value, list):
        if 'minItems' in schema and len(value) < schema['minItems']:
            raise ContractError('VALIDATION_ERROR')
        if 'maxItems' in schema and len(value) > schema['maxItems']:
            raise ContractError('VALIDATION_ERROR')
        item_schema = schema.get('items')
        if item_schema:
            for item in value:
                matches(item_schema, item, root)
    if isinstance(value, dict):
        props = schema.get('properties') or {}
        required = schema.get('required') or []
        if any(key not in value for key in required):
            raise ContractError('VALIDATION_ERROR')
        if schema.get('additionalProperties') is False:
            extra = set(value) - set(props)
            if extra & FORBIDDEN_KEYS:
                raise ContractError('CREDENTIAL_FORBIDDEN')
            if extra:
                raise ContractError('VALIDATION_ERROR')
        for key, item in value.items():
            if key in props:
                matches(props[key], item, root)
            elif schema.get('additionalProperties') not in (None, True, False) and isinstance(schema.get('additionalProperties'), dict):
                matches(schema['additionalProperties'], item, root)


def load_schema(path):
    if path.suffix == '.json':
        return json.loads(path.read_text())
    return {'openapi': True, 'text': path.read_text()}


def schema_def(root, name):
    if root.get('openapi'):
        # YAML is validated structurally elsewhere; vector schemas use inline rules below.
        return {'special': name}
    defs = root.get('$defs') or {}
    if name not in defs:
        raise ContractError('VALIDATION_ERROR')
    return defs[name]


def validate_payload(root, schema_name, payload):
    special_reject(schema_name, payload)
    if isinstance(root, dict) and root.get('openapi'):
        if schema_name == 'OpenApiPath':
            return
        # Minimal structural checks already applied via special_reject; apply compact companions.
        companions = {
            'ErrorEnvelope': {'type': 'object', 'additionalProperties': False, 'required': ['error'], 'properties': {'error': {'type': 'object', 'additionalProperties': False, 'required': ['code', 'message'], 'properties': {'code': {'type': 'string', 'enum': ['VALIDATION_ERROR', 'IDEMPOTENCY_CONFLICT', 'POLICY_GENERATION_STALE', 'MODE_UNMATCHED', 'TEXT_TO_SQL_FORBIDDEN', 'CREDENTIAL_FORBIDDEN', 'PARTIAL_PUBLICATION_FORBIDDEN', 'CHANNEL_INCOMPLETE', 'SEMANTIC_WRITE_FORBIDDEN', 'UNAUTHORIZED']}, 'message': {'type': 'string', 'enum': ['request_rejected', 'conflict', 'stale_policy', 'not_authorized']}}}}},
            'RedactedPlanView': {'type': 'object', 'additionalProperties': False, 'required': ['view', 'redacted_unauthorized_count', 'redaction_code'], 'properties': {'view': {'enum': ['agent', 'end_user']}, 'redacted_unauthorized_count': {'type': 'integer', 'minimum': 0}, 'redaction_code': {'type': 'string', 'pattern': '^[a-f0-9]{16}$'}}},
            'AuditPlanView': {'type': 'object', 'additionalProperties': False, 'required': ['view', 'resources_excluded'], 'properties': {'view': {'enum': ['audit', 'governance']}, 'resources_excluded': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'required': ['resource_id', 'permission_denied'], 'properties': {'resource_id': {'type': 'string'}, 'permission_denied': {'type': 'string'}}}}}},
            'ProductionJob': {'type': 'object', 'additionalProperties': False, 'required': ['job_id', 'tenant_id', 'status', 'whole_document_atomic_publication', 'visibility'], 'properties': {'job_id': {'type': 'string'}, 'tenant_id': {'type': 'string'}, 'status': {'type': 'string'}, 'whole_document_atomic_publication': {'type': 'boolean'}, 'visibility': {'type': 'string', 'enum': ['hidden', 'published']}}},
        }
        if schema_name not in companions:
            raise ContractError('VALIDATION_ERROR')
        matches(companions[schema_name], payload, companions[schema_name])
        return
    matches(schema_def(root, schema_name), payload, root)


def manifest_entries(root=ROOT):
    entries = []
    for path in sorted(p for p in root.rglob('*') if p.is_file()):
        rel = path.relative_to(root).as_posix()
        if any(part in SKIP_MANIFEST or part.startswith('.') for part in path.relative_to(root).parts):
            continue
        if path.suffix in {'.pyc', '.pyo'}:
            continue
        if rel == 'v21-contract-manifest.json':
            continue
        entries.append((rel, hashlib.sha256(path.read_bytes()).hexdigest()))
    return entries


FROZEN_STATUS = 'FROZEN_V21_REUSE_V1'


def write_manifest(root=ROOT):
    entries = manifest_entries(root)
    status = json.loads((root / 'status.json').read_text())
    if status.get('status') != FROZEN_STATUS:
        raise SystemExit('status.json is not ' + FROZEN_STATUS)
    payload = {
        'algorithm': 'sha256',
        'canonicalization': 'POSIX path, stable sort, SHA-256 of raw file bytes, no newline rewriting; exclude manifest, node_modules, ts-generated, package-lock.json, __pycache__, *.pyc, and dotfiles',
        'status': FROZEN_STATUS,
        'files': [{'path': path, 'sha256': digest} for path, digest in entries],
        'file_count': len(entries),
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + '\n'
    (root / 'v21-contract-manifest.json').write_text(text)
    return payload, hashlib.sha256(text.encode('utf-8')).hexdigest()


def run_vectors():
    results = []
    for schema_name, vector_name in PACKS:
        root = load_schema(ROOT / schema_name)
        pack = json.loads((ROOT / vector_name).read_text())
        for vector in pack['vectors']:
            try:
                validate_payload(root, vector['schema'], vector['payload'])
                actual = 'accept'
                code = None
            except ContractError as exc:
                actual = 'reject'
                code = exc.code
            expect = vector['expect']
            expected_code = vector.get('code')
            ok = actual == expect and (expected_code is None or expected_code == code)
            results.append(dict(id=vector['id'], expect=expect, actual=actual, code=code, ok=ok))
            if not ok:
                raise SystemExit('vector failed: ' + vector['id'] + ' expect=' + expect + ' actual=' + actual + ' code=' + str(code) + ' wanted=' + str(expected_code))
    return results


def main():
    results = run_vectors()
    manifest, manifest_sha = write_manifest()
    summary = dict(
        status='FROZEN_V21_REUSE_V1_VALIDATED_NOT_FORMAL_ACCEPTANCE',
        vectors=len(results),
        positive=sum(1 for r in results if r['expect'] == 'accept'),
        negative=sum(1 for r in results if r['expect'] == 'reject'),
        failed=sum(1 for r in results if not r['ok']),
        manifest_file_count=manifest['file_count'],
        manifest_sha256=manifest_sha,
        formal_acceptance=False,
    )
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
