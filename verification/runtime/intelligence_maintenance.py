#!/usr/bin/env python3
"""Compiled provider-disabled restart/TTL/Stop proof with an owned raw fixture."""
import argparse,hashlib,json,os,secrets,socket,sqlite3,subprocess,time,urllib.request
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--binary',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--allow-demo-mutations',action='store_true');a=p.parse_args();assert a.allow_demo_mutations
out=a.output.resolve();out.mkdir(parents=True,exist_ok=True);out.chmod(0o700);db=out/'owned.db';assert not db.exists(), 'refuse to replace an existing database';server=None
result={'status':'failed','qualification':'Actual compiled worker with INTELLIGENCE_ENABLED=false. Explicit expired fictional raw fixture is not generated model output. No external provider calls.','binarySHA256':hashlib.sha256(a.binary.read_bytes()).hexdigest(),'checks':[]}
env={k:v for k,v in os.environ.items() if not(k=='DATABASE_URL' or k.startswith(('INTELLIGENCE_','FINANCE_','PEOPLE_CREDENTIAL_RETRY_','MEDIA_','REPORT_')))}
env.update(INTELLIGENCE_ENABLED='false',FINANCE_OCR_ENABLED='false',DISABLE_SCHEDULER='true',FINANCE_INTAKE_ROOT=str(out/'finance'),MEDIA_ROOT=str(out/'media'),PEOPLE_CREDENTIAL_RETRY_ACTIVE_KEY_ID='owned-maintenance',PEOPLE_CREDENTIAL_RETRY_KEYS_JSON=json.dumps({'owned-maintenance':secrets.token_hex(32)}))
def start():
 global server
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 with(out/'private-runtime.log').open('ab') as log:server=subprocess.Popen([str(a.binary.resolve()),'--addr',f'127.0.0.1:{port}','--db',str(db),'--demo'],env=env,stdout=log,stderr=subprocess.STDOUT)
 for _ in range(300):
  if server.poll() is not None:raise RuntimeError('owned runtime exited')
  try:
   if urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=1).status==200:return
  except OSError:pass
  time.sleep(.1)
 raise RuntimeError('owned startup timed out')
def stop():
 global server
 if server and server.poll() is None:
  started=time.monotonic();server.terminate();assert server.wait(20)==0;result.setdefault('stopMilliseconds',[]).append(round((time.monotonic()-started)*1000))
 server=None
try:
 start();stop()
 with sqlite3.connect(db) as c:
  cid,uid=c.execute('SELECT company_id,user_id FROM memberships WHERE active=1 LIMIT 1').fetchone()
  c.execute('INSERT INTO intelligence_jobs(id,company_id,actor_id,operation,retry_key,originating_session_ref,captured_user_epoch,captured_company_authority_epoch,client_intent_hash,effective_request_hash,source_set_hash,opt_in_version,provider,selection,state,attempts,next_attempt_at,lease_token,lease_until,cancellation_version,reason_code,created_at,updated_at,expires_at,result_hash,result_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',('owned-expiry',cid,uid,'summary','owned-expiry','fictional-session',1,1,'fixture','fixture','fixture','local-selected-v1','{}','{}','ready',1,'2026-01-01T00:00:00Z','','2026-01-01T00:00:00Z',0,'','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','fixture','{"fictional":"owned expired raw fixture"}'))
 start()
 for _ in range(100):
  with sqlite3.connect(db) as c:state,raw=c.execute("SELECT state,result_json FROM intelligence_jobs WHERE id='owned-expiry'").fetchone()
  if state=='expired' and raw=='':break
  time.sleep(.05)
 else:raise RuntimeError('provider-disabled raw retirement failed')
 result['checks'].append('Actual compiled provider-disabled restart immediately expires and scrubs preexisting owned raw row');stop();result['checks'].append('Both actual signal stops return0 and join worker lifecycle');result['status']='passed'
finally:
 stop()
 for suffix in ['', '-wal', '-shm', '-journal']:
  Path(str(db)+suffix).unlink(missing_ok=True)
 result['ownedDatabaseRemoved']=not db.exists()
 (out/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
