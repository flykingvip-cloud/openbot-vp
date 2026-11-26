import os,sys
from pathlib import Path
sys.path.insert(0,'/opt/sandbox')
from upgrade_wave2 import connect_wave2
from seed_openbot_sandbox import actor
c=connect_wave2(Path('/data'),os.environ['SANDBOX_MODE'],os.environ.get('KNOWLEDGE_SDK_DSN'))
try:
 from dataclasses import replace
 p=c.store.get_principal('fixture-tenant-a','sandbox-owner')
 c.store.upsert_principal(replace(p,policy_generation=p.policy_generation+1))
 print('OWNED_PRINCIPAL_GENERATION_ADVANCED')
finally:c.store.close()
