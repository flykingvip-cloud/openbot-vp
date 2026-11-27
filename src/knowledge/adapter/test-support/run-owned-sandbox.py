"""One-shot isolated M2-B replay. SDK sources must be an exact exported nominated SHA.
No production endpoints, reused state, shared projects or reserved ports are allowed.
"""
import argparse,json,os,socket,subprocess,sys,tempfile,time,uuid
from pathlib import Path
SHA='9940818b962ccb186c0dfb0158de6bd9bd49057b'
p=argparse.ArgumentParser();p.add_argument('--sdk',required=True,type=Path);p.add_argument('--mode',choices=['sqlite','postgres'],required=True);p.add_argument('--image',required=True);p.add_argument('--output',required=True,type=Path);a=p.parse_args()
if os.getuid()==0:raise SystemExit('Nonroot only')
import hashlib
PINNED_SOURCE_HASHES={'src/knowledge_sdk/server/v2.py': '9fc5d7630189f4951a6323a3698be0c8d14506bee331fb45dbd9ee2012e6e56f', 'src/knowledge_sdk/server/v2_auth.py': 'd843f4b942d7ef5b16a7e295576004e7ecf15ca0ae2fc0b51bff1aa9e0f819d0', 'deploy/openbot-sandbox/compose.wave2.yaml': 'b7a5c0e5f181175c39f18ce61ace0f43a6ebfb665ba0b310d83664c65b647e6c'}
for filename,digest in PINNED_SOURCE_HASHES.items():
 if hashlib.sha256((a.sdk/filename).read_bytes()).hexdigest()!=digest:raise SystemExit("Pinned SDK source mismatch")

root=Path(__file__).resolve().parents[4];scripts=a.sdk.resolve()/'deploy/openbot-sandbox';a.output.mkdir(parents=True,exist_ok=True)
project='m2b-replay-'+uuid.uuid4().hex[:12];env=dict(os.environ,SANDBOX_IMAGE=a.image)
with tempfile.TemporaryDirectory(prefix='m2b-owned-replay-') as directory:
 state=Path(directory)/'new'
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 if port in (3000,3001,8000,8002,8090,8091):raise SystemExit('Reserved port')
 subprocess.run([sys.executable,str(scripts/'prepare_sandbox.py'),str(state),'--port',str(port)],check=True)
 compose=['docker','compose','--env-file',str(state/'sandbox.env'),'-p',project,'-f',str(scripts/('compose.'+a.mode+'.yaml')),'-f',str(scripts/'compose.wave2.yaml')]
 def control(name,output=None):
  with (Path(__file__).parent/name).open('rb') as source:
   result=subprocess.run(compose+['exec','-T','sandbox','python','-'],input=source.read(),capture_output=True,env=env)
  if result.returncode:
   raise RuntimeError("Owned fixture control failed: "+name+"\n"+result.stderr.decode())
  if output:output.write_bytes(result.stdout)
 def tests(name,extra=None):
  e=dict(env,OPENBOT_KNOWLEDGE_SDK_V2_INTEGRATION_URL='http://127.0.0.1:'+str(port),OPENBOT_KNOWLEDGE_SDK_V2_INTEGRATION_KEY_FILE=str(state/'secrets/hmac'));e.update(extra or {})
  with (a.output/(name+'-'+str(len(list(a.output.glob(name+'*.log'))))+'.log')).open('w') as log:subprocess.run(['pnpm','exec','vitest','run','src/knowledge/adapter/'+name+'.integration.test.ts','--reporter=dot'],cwd=root,env=e,stdout=log,stderr=subprocess.STDOUT,check=True)
 try:
  subprocess.run(compose+['up','-d'],env=env,check=True)
  import urllib.request
  for attempt in range(60):
   try:
    with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/v1/ready',timeout=2) as response:assert response.status==200
    break
   except Exception:
    if attempt==59:raise
    time.sleep(.5)
  control('controlled-fixture.py');control('member-fixture.py');control('profile-fixture.py');evidence=a.output/'synthetic-evidence.json';control('export-evidence.py',evidence)
  tests('sandbox');tests('evidence',{'OPENBOT_KNOWLEDGE_SDK_EVIDENCE_FIXTURE':str(evidence)})
  tests('identity-mapping')
  tests('member-revocation',{'OPENBOT_KNOWLEDGE_SDK_MEMBER_PHASE':'before'})
  control('revoke-member.py');tests('member-revocation',{'OPENBOT_KNOWLEDGE_SDK_MEMBER_PHASE':'after'})
  subprocess.run(compose+['restart','sandbox'],env=env,check=True)
  time.sleep(2)
  tests('sandbox') # same key, same result after actual service restart
  control('check-idempotent-version.py',a.output/'authoritative-idempotency.json')
  tests('profile-revocation',{'OPENBOT_KNOWLEDGE_SDK_PROFILE_PHASE':'before'})
  control('revoke-profile.py');tests('profile-revocation',{'OPENBOT_KNOWLEDGE_SDK_PROFILE_PHASE':'after'})
  control('advance-principal.py')
  tests('revocation',{'OPENBOT_KNOWLEDGE_SDK_V2_REVOKED_FIXTURE':'true','OPENBOT_KNOWLEDGE_SDK_PRINCIPAL_STALE':'true'})
  subprocess.run(compose+['stop','sandbox'],env=env,check=True)
  tests('outage',{'OPENBOT_KNOWLEDGE_SDK_STOPPED_FIXTURE':'true'})
 finally:
  subprocess.run(compose+['down','--volumes'],env=env,check=True)
print(json.dumps({'sdk_expected_sha':SHA,'mode':a.mode,'cleanup_completed':True,'scope':'existing live cases; full ten-group closure still requires review'}))
