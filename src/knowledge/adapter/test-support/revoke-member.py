import os,sys
from pathlib import Path
sys.path.insert(0,'/opt/sandbox')
from upgrade_wave2 import connect_wave2
from seed_openbot_sandbox import actor
c=connect_wave2(Path('/data'),os.environ['SANDBOX_MODE'],os.environ.get('KNOWLEDGE_SDK_DSN'))
try:
 a=actor('fixture-tenant-a')
 c.revoke_kb_member(a,'m2b-member','sandbox-reader')
 print('OWNED_MEMBER_REVOKED')
finally:c.store.close()
