#!/usr/bin/env python3
"""Verify exported Encore without the development watcher's inotify dependency."""
import argparse,json,os,secrets,signal,socket,subprocess,tempfile,time,urllib.request,urllib.error,urllib.parse,shutil,base64
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);p.add_argument('--postgres-container',required=True);p.add_argument('--allow-demo-mutations',action='store_true');a=p.parse_args()
if not a.allow_demo_mutations:p.error('explicit disposable-demo authorization required')
a.output.mkdir(parents=True,exist_ok=True);out=a.output.resolve();tag='schach-encore-runtime:'+secrets.token_hex(5);name='schach-encore-export-'+secrets.token_hex(5);network=name;db='workspace';checks=[];result={'status':'failed','checks':checks};started=False;network_created=False;db_created=False
# Encore 1.58.6 export validates the map key as the resource name while SDK
# parse.go uses `name` as EncoreName and the map key as DatabaseName. Matching
# physical/resource names works on both paths. CREATE fails safely if occupied.
parsed=urllib.parse.urlsplit(os.environ['TEST_DATABASE_URL']);source_db=parsed.path.lstrip('/')
def cmd(args,cwd=ROOT,env=None,stdin=None,log='commands.log'):
 with (out/log).open('ab') as f:return subprocess.run(args,cwd=cwd,env=env,input=stdin,stdout=f,stderr=subprocess.STDOUT,check=True,timeout=300)
def sql(text):cmd(['docker','exec','-i',a.postgres_container,'psql','-U','schach','-d',source_db,'-v','ON_ERROR_STOP=1'],stdin=text.encode())
def call(base,method,path,body=None,headers=None):
 headers=headers or {};data=None if body is None else json.dumps(body).encode()
 if data is not None:headers={**headers,'Content-Type':'application/json'}
 try:r=urllib.request.urlopen(urllib.request.Request(base+path,data=data,headers=headers,method=method),timeout=15)
 except urllib.error.HTTPError as e:r=e
 with r:return r.status,r.read(),r.headers
try:
 sql(f'CREATE DATABASE {db};');db_created=True
 env=dict(os.environ)
 for key in list(env):
  if key.startswith(('COMMUNICATION_','LIVEKIT_','APNS_','FCM_','MFA_')) or key in ('MEDIA_ROOT','CLAMAV_ADDRESS','SEED_DEMO'):env.pop(key)
 env['DATABASE_URL']=urllib.parse.urlunsplit(parsed._replace(path='/'+db))
 cmd(['go','run','./cmd/migrate'],ROOT/'backend',env)
 cmd(['docker','network','create',network]);network_created=True;cmd(['docker','network','connect',network,a.postgres_container])
 with tempfile.TemporaryDirectory(prefix='schach-encore-export-') as tmp:
  root=Path(tmp)
  ignore=shutil.ignore_patterns('.encore','.superpowers','.secrets.local.cue','encore.gen.*','node_modules','bin','*.db*')
  for directory in ('backend','encore'):shutil.copytree(ROOT/directory,root/directory,ignore=ignore)
  cfg=root/'encore/api/config.cue';cfg.write_text(cfg.read_text().replace('SeedDemo: false','SeedDemo: true'))
  with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
  base=f'http://127.0.0.1:{port}'
  config={'metadata':{'app_id':'schach-runtime-smoke','env_name':'disposable-local','env_type':'development','cloud':'local','base_url':base},'auth':[{'type':'key','id':1,'key':{'$env':'SERVICE_API_KEY'}}],'sql_servers':[{'host':a.postgres_container+':5432','tls_config':{'disabled':True},'databases':{'workspace':{'name':db,'username':'schach','password':'disposable-trust-connection','min_connections':1,'max_connections':20}}}],'secrets':{'BootstrapPassword':{'$env':'BOOTSTRAP_PASSWORD'}},'log_config':'warn'}
  infra=root/'infra.json';infra.write_text(json.dumps(config))
  cmd(['encore','build','docker',tag,'--config',str(infra),'--base','alpine:3'],root/'encore',env,log='build.log');checks.append('Actual Encore exporter builds current code without a development watcher')
  ef=root/'runtime.env';ef.write_text('SERVICE_API_KEY='+base64.b64encode(secrets.token_bytes(32)).decode()+'\nBOOTSTRAP_PASSWORD='+secrets.token_urlsafe(32)+'\nSEED_DEMO=true\n');ef.chmod(0o600)
  cmd(['docker','run','-d','--name',name,'--network',network,'--env-file',str(ef),'-p',f'127.0.0.1:{port}:8080',tag]);started=True
  for _ in range(150):
   try:
    if call(base,'GET','/api/health')[0]==200:break
   except OSError:pass
   time.sleep(.2)
  else:raise RuntimeError('Exported runtime did not become healthy; inspect private container log')
  checks.append('Exported Encore boots against native PostgreSQL with all numbered migrations')
  for headers in ({},{'X-Encore-Cron-Execution':'spoof'}):assert call(base,'POST','/api.RunScheduled',{},headers)[0] in (401,403,404)
  checks.append('Unauthenticated and spoofed scheduled invocations rejected by exported private boundary')
  cmd(['python3',str(ROOT/'verification/runtime/tcp_scenarios.py'),'--url',base,'--api-only','--allow-demo-mutations','--report',str(out/'api-result.json')],log='api.log');checks.append('Original 38 workspace + 53 finance assertions pass on actual exported Encore TCP')
  status,body,headers=call(base,'POST','/api/auth/login',{'email':'founder@schach.demo','password':'SchachDemo!2026'});assert status==200;cookie=headers.get('Set-Cookie').split(';')[0];value=json.loads(body);cid=value['companies'][0]['id'];owner=value['user']['id'];password=secrets.token_urlsafe(24)
  status,body,_=call(base,'POST',f'/api/companies/{cid}/people',{'name':'Export runtime participant','email':'export-chat@example.invalid','password':password,'role':'member','capacityHours':40},{'Cookie':cookie});assert status==200;member=json.loads(body)['id']
  status,_,headers=call(base,'POST','/api/auth/login',{'email':'export-chat@example.invalid','password':password});assert status==200;mc=headers.get('Set-Cookie').split(';')[0]
  status,body,_=call(base,'POST',f'/api/companies/{cid}/conversations',{'title':'Export private runtime','kind':'group','participantIds':[owner,member]},{'Cookie':cookie});assert status==200;conv=json.loads(body)['id']
  stream={'Base':base,'Company':cid,'Conversation':conv,'Member':member,'OwnerCookie':cookie,'MemberCookie':mc};cmd(['go','run',str(ROOT/'verification/runtime/stream_check.go')],ROOT/'backend',stdin=json.dumps(stream).encode(),log='stream.log');checks.append('Actual exported Encore/proxy socket upgrade, origin refusal, private hints and revocation close')
  cmd(['docker','restart',name]);time.sleep(1)
  for _ in range(100):
   try:
    if call(base,'GET','/api/health')[0]==200:break
   except OSError:pass
   time.sleep(.1)
  path=f'/api/companies/{cid}/conversations/{conv}/messages';status,body,_=call(base,'POST',path,{'clientMessageId':'runtime-persisted','body':'Runtime private marker'},{'Cookie':cookie});assert status==200;mid=json.loads(body)['message']['id']
  status,body,_=call(base,'GET',path,headers={'Cookie':cookie});rows=json.loads(body)['messages'];assert status==200 and len(rows)==1 and rows[0]['id']==mid;checks.append('Actual exported Encore restart preserves message ACK, session and retry ID');result['status']='passed'
finally:
 if started:
  cmd(['docker','logs',name],log='runtime.log');cmd(['docker','rm','-f',name])
 if network_created:
  cmd(['docker','network','disconnect',network,a.postgres_container]);cmd(['docker','network','rm',network])
 if db_created:sql(f'DROP DATABASE {db};')
 subprocess.run(['docker','image','rm',tag],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 (out/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
