#!/usr/bin/env python3
"""Owned M8 startup/migration/HTTP/optional browser probe. Never selects controller ports."""
import argparse,json,os,secrets,socket,subprocess,tempfile,time,urllib.request,urllib.parse,signal,hashlib,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--postgres-container',default='schach-m0-native-20261010');p.add_argument('--allow-demo-mutations',action='store_true');p.add_argument('--browser',action='store_true');a=p.parse_args();assert a.allow_demo_mutations;a.output.mkdir(parents=True,exist_ok=True);out=a.output.resolve();parsed=urllib.parse.urlsplit(os.environ['TEST_DATABASE_URL']);source_db=parsed.path.strip('/');schemas=[];processes=[];checks=[];result={'status':'failed','checks':checks}
def cmd(args,cwd=ROOT,env=None,stdin=None,log='commands.log'):
 with(out/log).open('ab')as f:return subprocess.run(args,cwd=cwd,env=env,input=stdin,stdout=f,stderr=subprocess.STDOUT,check=True,timeout=300)
def sql(query):
 r=subprocess.run(['docker','exec','-i',a.postgres_container,'psql','-U','schach','-d',source_db,'-v','ON_ERROR_STOP=1','-qAt'],input=query.encode(),capture_output=True,check=True);return r.stdout.decode().strip()
def env_for(schema=None):
 env=dict(os.environ)
 for k in list(env):
  if k.startswith(('COMMUNICATION_','LIVEKIT_','APNS_','FCM_','MFA_','BOOTSTRAP_','FINANCE_','REPORT_','INTELLIGENCE_','PEOPLE_'))or k in ('DATABASE_URL','MEDIA_ROOT','CLAMAV_ADDRESS','SEED_DEMO','SECURE_COOKIES','ENVIRONMENT','ALLOWED_ORIGINS','SESSION_HOURS'):env.pop(k)
 if schema:
  q=urllib.parse.parse_qs(parsed.query);q['search_path']=[schema];env['DATABASE_URL']=urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(q,doseq=True)))
 env['MEDIA_ROOT']=str(out/'owned-media');env['FINANCE_INTAKE_ROOT']=str(out/'owned-finance');env['SESSION_HOURS']='72';return env
def owned_schema():
 schema='schach_m8_runtime_'+secrets.token_hex(8);sql('CREATE SCHEMA '+schema);schemas.append(schema);return schema
def start(binary,env,db):
 with socket.socket()as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 f=(out/f'server-{len(processes)}.log').open('wb');proc=subprocess.Popen([str(binary),'--addr',f'127.0.0.1:{port}','--db',str(db),'--frontend',str(ROOT/'frontend/dist'),'--demo'],env=env,stdout=f,stderr=subprocess.STDOUT,start_new_session=True);f.close();processes.append(proc);base=f'http://127.0.0.1:{port}'
 for _ in range(200):
  try:
   if urllib.request.urlopen(base+'/api/health',timeout=1).status==200:return proc,base
  except OSError:pass
  if proc.poll()is not None:raise RuntimeError('owned server exited; see log')
  time.sleep(.05)
 raise RuntimeError('startup timeout')
def stop(proc):
 if proc.poll()is None:os.killpg(proc.pid,signal.SIGTERM);proc.wait(10)
try:
 with tempfile.TemporaryDirectory(prefix='schach-m8-runtime-')as tmp:
  temp=Path(tmp);binary=temp/'server';cmd(['go','build','-o',str(binary),'./cmd/server'],ROOT/'backend',log='build.log')
  migrations=sorted((ROOT/'backend/migrations').glob('*.up.sql'),key=lambda p:int(p.name.split('_')[0]));assert len(migrations)==49
  for file in migrations:assert file.read_bytes()==(ROOT/'encore/api/migrations'/file.name).read_bytes()
  checks.append('All SQL1–49 up files mirror exactly; predecessor1–47 unchanged checked separately against BASE')
  fresh=owned_schema();env=env_for(fresh);cmd(['go','run','./cmd/migrate'],ROOT/'backend',env,log='pg-fresh-migrate.log');cmd(['go','run','./cmd/migrate'],ROOT/'backend',env,log='pg-fresh-idempotent.log');assert sql('SET search_path TO '+fresh+';SELECT count(*) FROM schach_schema_migrations')=='49';checks.append('Actual numbered runner fresh schema + checksum-verified idempotent repeat')
  upgrade=owned_schema();parts=['SET search_path TO '+upgrade+';','CREATE TABLE schach_schema_migrations(version integer PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());']
  for file in migrations[:47]:parts.extend([file.read_text(),"INSERT INTO schach_schema_migrations(version,sha256)VALUES(%d,'%s');"%(int(file.name.split('_')[0]),hashlib.sha256(file.read_bytes()).hexdigest())])
  parts+= ["INSERT INTO companies(id,name,slug,created_at)VALUES('legacy-c','Legacy fixture','m8-legacy','2026-01-01');", "INSERT INTO users(id,name,email,password_hash)VALUES('legacy-u','Legacy owner','m8-legacy@example.invalid','not-an-authenticated-account');", "INSERT INTO memberships(id,company_id,user_id,role)VALUES('legacy-m','legacy-c','legacy-u','member');", "INSERT INTO goals(id,company_id,name,owner_id,unit,baseline,target,current)VALUES('legacy-g','legacy-c','Legacy quality','legacy-u','defects',8,3,4.8);" ]
  sql('\n'.join(parts));upenv=env_for(upgrade);cmd(['go','run','./cmd/migrate'],ROOT/'backend',upenv,log='pg-upgrade-migrate.log');cmd(['go','run','./cmd/migrate'],ROOT/'backend',upenv,log='pg-upgrade-idempotent.log');legacy=sql('SET search_path TO '+upgrade+";SELECT current,version,current_measurement_id,legacy_observed_current,legacy_observed_unit,measurement_coverage_from IS NOT NULL,(SELECT count(*)FROM goal_measurements) FROM goals WHERE id='legacy-g';");assert legacy=='4.8|1||4.8|defects|t|0',legacy;result['legacyUpgrade']=legacy;checks.append('Real47→49 numbered upgrade preserves legacy4.8/version1/exact unit/coverage with zero fabricated facts, idempotent repeat')
  for name,environment in [('pg',env),('sqlite',env_for())]:
   proc,base=start(binary,environment,temp/(name+'.db'));cmd(['python3',str(ROOT/'verification/runtime/planning_goals_fixture.py'),'--url',base,'--output',str(out/(name+'-api.json')),'--allow-demo-mutations'],log=name+'-api.log');checks.append(name+' actual compiled normal startup and M8 TCP flow')
   if a.browser and name=='pg':
    browserenv={**environment,'SCHACH_SMOKE_URL':base,'SCHACH_SMOKE_RESULT':str(out/'browser.json'),'SCHACH_M8_FIXTURE':str(out/'pg-api.json')};cmd(['node',str(ROOT/'verification/runtime/planning_goals_smoke.mjs'),'--allow-demo-mutations'],env=browserenv,log='browser.log');checks.append('Actual current web browser320/375/430px human workflow/ACK retry/source refresh')
   stop(proc)
  result['status']='passed'
finally:
 for proc in processes:stop(proc)
 for schema in schemas:sql('DROP SCHEMA '+schema+' CASCADE')
 (out/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
