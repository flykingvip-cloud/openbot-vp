import os,sys
from pathlib import Path
sys.path.insert(0,"/opt/sandbox")
from upgrade_wave2 import connect_wave2
from seed_openbot_sandbox import actor
c=connect_wave2(Path("/data"),os.environ["SANDBOX_MODE"],os.environ.get("KNOWLEDGE_SDK_DSN"))
try:
 c.update_agent_profile(actor("fixture-tenant-a"),"m2b-profile-agent",active=False)
 print("OWNED_PROFILE_REVOKED")
finally:c.store.close()
