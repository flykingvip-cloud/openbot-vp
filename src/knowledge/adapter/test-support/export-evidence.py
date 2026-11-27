import sys,os,json,hashlib
from pathlib import Path
sys.path.insert(0,'/opt/sandbox')
from upgrade_wave2 import connect_wave2
from seed_openbot_sandbox import actor
from knowledge_sdk.contracts.uri import build_uri
from knowledge_sdk.storage.migration_v6 import version_id
c=connect_wave2(Path('/data'),os.environ['SANDBOX_MODE'],os.environ.get('KNOWLEDGE_SDK_DSN'))
try:
 a=actor('fixture-tenant-a');doc='fixture-tenant-a-private-doc';d=c.store.get_document(doc);v=d.current_version;chunk=c.store.get_chunks(doc,v)[0];text=chunk.text
 print(json.dumps(dict(evidence_id='m2b-evidence',tenant_id=a.org_id,kb_id=d.kb_id,doc_id=doc,version=v,version_id=version_id(c.store,a.org_id,doc,v),chunk_id=chunk.chunk_id,anchor_id='',title=d.title,section_path=chunk.section_path,excerpt=text,excerpt_hash=hashlib.sha256(text.encode()).hexdigest(),canonical_uri=build_uri(a.org_id,doc,v,chunk.chunk_id),locator=dict(page=0,char_start=chunk.start_offset,char_end=chunk.end_offset,table_cell=None),masking_summary='',verification_status='unverified',hash_algorithm='sha256')))
finally:c.store.close()
