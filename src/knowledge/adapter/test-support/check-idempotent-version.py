import os,sys,json
from pathlib import Path
sys.path.insert(0,'/opt/sandbox')
from upgrade_wave2 import connect_wave2
c=connect_wave2(Path('/data'),os.environ['SANDBOX_MODE'],os.environ.get('KNOWLEDGE_SDK_DSN'))
try:
 from contextlib import nullcontext
 with c.store.tenant_scope('fixture-tenant-a') if hasattr(c.store,'tenant_scope') else nullcontext():
  docs=[d for d in c.store.list_documents('fixture-tenant-a') if d.title=='m2b.txt']
  assert len(docs)==1, len(docs)
  assert c.store.latest_version(docs[0].doc_id)==1
 print(json.dumps({'matching_documents':1,'latest_version':1,'source':'authoritative_owned_store'}))
finally:c.store.close()
