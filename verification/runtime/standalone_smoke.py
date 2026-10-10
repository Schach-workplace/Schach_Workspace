#!/usr/bin/env python3
"""Owned PostgreSQL TCP/restart/full SQL+media restore probe. Never use a real company database."""
import argparse,json,os,secrets,signal,socket,subprocess,tempfile,time,urllib.request,urllib.error,urllib.parse,hashlib,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);p.add_argument('--postgres-container',required=True);p.add_argument('--allow-demo-mutations',action='store_true');a=p.parse_args()
if not a.allow_demo_mutations:p.error('explicit --allow-demo-mutations is required')
if not os.environ.get('TEST_CLAMAV_ADDRESS'):p.error('TEST_CLAMAV_ADDRESS is required for real media scan/restore acceptance')
a.output.mkdir(parents=True,exist_ok=True);out=a.output.resolve();checks=[];processes=[];schema='schach_runtime_'+secrets.token_hex(8);restore_db='schach_restore_'+secrets.token_hex(8)
parsed=urllib.parse.urlsplit(os.environ['TEST_DATABASE_URL']);source_db=parsed.path.lstrip('/');query=urllib.parse.parse_qs(parsed.query);query['search_path']=[schema];dsn=urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query,doseq=True)))
result={'status':'failed','checks':checks};created_restore=False

def cmd(args,cwd=ROOT,env=None,stdin=None,log='commands.log'):
 with (out/log).open('ab') as f:return subprocess.run(args,cwd=cwd,env=env,input=stdin,stdout=f,stderr=subprocess.STDOUT,check=True,timeout=180)
def sql(text,db=source_db):cmd(['docker','exec','-i',a.postgres_container,'psql','-U','schach','-d',db,'-v','ON_ERROR_STOP=1'],stdin=text.encode())
def call(base,method,path,body=None,cookie=None,raw=None):
 data=raw if raw is not None else None if body is None else json.dumps(body).encode();headers={};
 if body is not None:headers['Content-Type']='application/json'
 if cookie:headers['Cookie']=cookie
 r=urllib.request.Request(base+path,data=data,headers=headers,method=method)
 try:response=urllib.request.urlopen(r,timeout=15)
 except urllib.error.HTTPError as e:response=e
 with response:return response.status,response.read(),response.headers
def stop(proc):
 if proc.poll() is None:
  os.killpg(proc.pid,signal.SIGTERM)
  try:proc.wait(10)
  except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(10)
def start(binary,env):
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 with (out/f'server-{len(processes)}.log').open('wb') as f:proc=subprocess.Popen([str(binary),'--addr',f'127.0.0.1:{port}','--frontend',str(ROOT/'frontend/dist'),'--demo'],env=env,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
 processes.append(proc);base=f'http://127.0.0.1:{port}'
 for _ in range(100):
  try:
   if call(base,'GET','/api/health')[0]==200:return proc,base
  except OSError:pass
  if proc.poll() is not None:raise RuntimeError('server exited; inspect private log')
  time.sleep(.1)
 raise RuntimeError('server startup timed out')
try:
 sql(f'CREATE SCHEMA {schema};')
 with tempfile.TemporaryDirectory(prefix='schach-standalone-runtime-') as tmp:
  temp=Path(tmp);binary=temp/'server';env=dict(os.environ)
  for name in list(env):
   if name.startswith(('COMMUNICATION_','LIVEKIT_','APNS_','FCM_','MFA_','BOOTSTRAP_')):env.pop(name)
  env.update(DATABASE_URL=dsn,ENVIRONMENT='development',SECURE_COOKIES='false',DISABLE_SCHEDULER='true',MEDIA_ROOT=str(temp/'media'),CLAMAV_ADDRESS=os.environ.get('TEST_CLAMAV_ADDRESS',''),ALLOWED_ORIGINS='')
  cmd(['go','run','./cmd/migrate'],ROOT/'backend',env);cmd(['go','build','-o',str(binary),'./cmd/server'],ROOT/'backend',env)
  proc,base=start(binary,env);checks.append('Versioned migrations and compiled standalone server start on owned PostgreSQL schema')
  cmd(['python3',str(ROOT/'verification/runtime/tcp_scenarios.py'),'--url',base,'--allow-demo-mutations','--report',str(out/'api-result.json')],log='api.log')
  report=json.loads((out/'api-result.json').read_text());assert report['status']=='passed';checks.append(f"Original workspace/finance TCP scenarios: {report['workspaceChecks']} + {report['financeChecks']} assertions")
  status,body,headers=call(base,'POST','/api/auth/login',{'email':'founder@schach.demo','password':'SchachDemo!2026'});assert status==200
  owner_cookie=headers.get('Set-Cookie').split(';')[0];session=json.loads(body);cid=session['companies'][0]['id'];owner=session['user']['id'];password=secrets.token_urlsafe(24)
  status,body,_=call(base,'POST',f'/api/companies/{cid}/people',{'name':'Runtime participant','email':'runtime-chat@example.invalid','password':password,'role':'member','capacityHours':40},owner_cookie);assert status==200;member=json.loads(body)['id']
  status,body,headers=call(base,'POST','/api/auth/login',{'email':'runtime-chat@example.invalid','password':password});assert status==200;mc=headers.get('Set-Cookie').split(';')[0]
  status,body,_=call(base,'POST',f'/api/companies/{cid}/conversations',{'title':'Runtime private group','kind':'group','participantIds':[owner,member]},owner_cookie);assert status==200;conv=json.loads(body)['id'];root=f'/api/companies/{cid}/conversations/{conv}'
  cfg={'Base':base,'Company':cid,'Conversation':conv,'Member':member,'OwnerCookie':owner_cookie,'MemberCookie':mc}
  cmd(['go','run',str(ROOT/'verification/runtime/stream_check.go')],ROOT/'backend',stdin=json.dumps(cfg).encode(),log='stream.log');checks.append('Actual standalone reverse-proxy WebSocket hints/origin/removal')
  # Durable acknowledgement, private scanned media, and shared backup boundary.
  content=b'Clean evidence in coordinated database and private media backup';hash_=hashlib.sha256(content).hexdigest()
  status,body,_=call(base,'POST',root+'/media',{'clientUploadId':'restore-upload','fileName':'restore.txt','size':len(content),'sha256':hash_},owner_cookie);assert status==200;media=json.loads(body)['id']
  assert call(base,'POST',root+f'/media/{media}/upload',cookie=owner_cookie,raw=content)[0]==200
  assert call(base,'POST',root+f'/media/{media}/finalize',{},owner_cookie)[0]==200
  message_input={'clientMessageId':'restore-media-send','body':'Selected restore evidence','mediaIds':[media]}
  status,body,_=call(base,'POST',root+'/messages',message_input,owner_cookie);assert status==200;message_id=json.loads(body)['message']['id']
  os.killpg(proc.pid,signal.SIGKILL);proc.wait(10);proc,base=start(binary,env)
  status,body,_=call(base,'POST',root+'/messages',message_input,owner_cookie);assert status==200 and json.loads(body)['message']['id']==message_id;checks.append('Acknowledged send and exact retry result survive SIGKILL crash and compiled-process restart')
  stop(proc)
  backup=subprocess.run(['docker','exec',a.postgres_container,'pg_dump','-U','schach','-d',source_db,'--schema',schema,'--no-owner','--no-privileges'],capture_output=True,check=True).stdout
  (out/'restore-private.sql').write_bytes(backup);(out/'restore-private.sql').chmod(0o600)
  shutil.copytree(temp/'media',temp/'restored-media')
  sql(f'CREATE DATABASE {restore_db};');created_restore=True
  cmd(['docker','exec','-i',a.postgres_container,'psql','-U','schach','-d',restore_db,'-v','ON_ERROR_STOP=1'],stdin=backup,log='restore.log')
  env.update(DATABASE_URL=urllib.parse.urlunsplit(urllib.parse.urlsplit(dsn)._replace(path='/'+restore_db)),MEDIA_ROOT=str(temp/'restored-media'))
  proc,base=start(binary,env);status,body,_=call(base,'POST',root+'/messages',message_input,owner_cookie);assert status==200 and json.loads(body)['message']['id']==message_id
  assert call(base,'GET',root+f'/media/{media}/download',cookie=owner_cookie)[1]==content
  assert call(base,'GET',root+'/messages',cookie=mc)[0]==404
  checks.append('Real pg_dump/restore plus private media copy preserve ACKs, retry identities, bytes and revoked membership')
  stop(proc);result['status']='passed'
finally:
 for proc in processes:stop(proc)
 if created_restore:sql(f'DROP DATABASE {restore_db};',source_db)
 sql(f'DROP SCHEMA IF EXISTS {schema} CASCADE;')
 (out/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
