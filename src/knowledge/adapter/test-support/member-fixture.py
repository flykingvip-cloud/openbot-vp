import os,sys
from pathlib import Path
sys.path.insert(0,'/opt/sandbox')
from upgrade_wave2 import connect_wave2
from seed_openbot_sandbox import actor
c=connect_wave2(Path('/data'),os.environ['SANDBOX_MODE'],os.environ.get('KNOWLEDGE_SDK_DSN'))
try:
 a=actor('fixture-tenant-a')
 c.create_kb(a,'member revocation fixture','private',kb_id='m2b-member')
 c.grant_kb_member(a,'m2b-member','sandbox-reader','viewer')
 c.ingest(a,'m2b-member','member revocation evidence',doc_id='m2b-member-doc',visibility='team')
 c.register_agent_profile(a,'m2b-member-agent',allowed_kb_ids=['m2b-member'])
 print('OWNED_MEMBER_FIXTURE_CREATED')
finally:c.store.close()
