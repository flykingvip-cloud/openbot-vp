"""Executed only inside the explicitly owned sandbox; no SDK source modification."""
import os,sys
from pathlib import Path
sys.path.insert(0,'/opt/sandbox')
from upgrade_wave2 import connect_wave2
from seed_openbot_sandbox import actor
root=Path('/data');mode=os.environ['SANDBOX_MODE'];c=connect_wave2(root,mode,os.environ.get('KNOWLEDGE_SDK_DSN'))
try:
 a=actor('fixture-tenant-a')
 c.create_kb(a,'M2B controlled fixture','private',kb_id='m2b-controlled',space_type='personal',owner_user_id=a.user_id,governance_tier='l2_controlled')
 c.register_agent_profile(a,'m2b-controlled-agent',allowed_kb_ids=['m2b-controlled'])
 print('OWNED_TEST_FIXTURE_EXTENDED_NO_SCHEMA_CHANGE')
finally:c.store.close()
