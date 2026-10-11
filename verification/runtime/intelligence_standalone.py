#!/usr/bin/env python3
"""Compiled current standalone fixture; owned schema, stores and graceful stop."""
import argparse,json,os,secrets,socket,subprocess,time,urllib.request,hashlib
from runtime_contract import migration_inventory, scrub_runtime_env
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);parser.add_argument('--allow-demo-mutations',action='store_true');args=parser.parse_args();assert args.allow_demo_mutations;out=args.output.resolve();out.mkdir(parents=True,exist_ok=True);os.chmod(out,0o700);schema='schach_m10_'+secrets.token_hex(6);admin='postgres://schach@127.0.0.1:55433/schach_m0?sslmode=disable';dsn=admin+'&search_path='+schema;server=None;result={'status':'failed','schema':schema,'sourceHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'checks':[]}
def command(args,env=None,log='commands.log',data=None):
 if env is None:env=scrub_runtime_env(os.environ)
 with(out/log).open('ab') as f: return subprocess.run(args,cwd=ROOT/'backend',env=env,input=data,stdout=f,stderr=subprocess.STDOUT,check=True)
def sql(text):return subprocess.check_output(['psql',admin,'-v','ON_ERROR_STOP=1','-Atqc','SET search_path TO '+schema+'; '+text],text=True).strip()
def start():
 global server
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 log=(out/'runtime.log').open('ab');server=subprocess.Popen([str(out/'server'),'--addr',f'127.0.0.1:{port}','--db',str(out/'unused.db'),'--demo','--frontend',str(ROOT/'frontend/dist')],cwd=ROOT/'backend',env=env,stdout=log,stderr=subprocess.STDOUT);log.close();url=f'http://127.0.0.1:{port}'
 for _ in range(300):
  if server.poll() is not None:raise RuntimeError('owned server exited')
  try:
   if urllib.request.urlopen(url+'/api/health',timeout=1).status==200:return url
  except OSError:pass
  time.sleep(.1)
 raise RuntimeError('owned server startup timeout')
def stop():
 global server
 if server and server.poll() is None:server.terminate();assert server.wait(20)==0
 server=None
try:
 command(['psql',admin,'-v','ON_ERROR_STOP=1','-c','CREATE SCHEMA '+schema]);command(['go','build','-o',str(out/'server'),'./cmd/server']);command(['go','build','-o',str(out/'migrate'),'./cmd/migrate'])
 for name in ['scratch','media','finance']:(out/name).mkdir(exist_ok=True);os.chmod(out/name,0o700)
 env=dict(scrub_runtime_env(os.environ),DATABASE_URL=dsn,DISABLE_SCHEDULER='true',FINANCE_OCR_ENABLED='false',FINANCE_INTAKE_ROOT=str(out/'finance'),MEDIA_ROOT=str(out/'media'),CLAMAV_ADDRESS='127.0.0.1:13310',PEOPLE_CREDENTIAL_RETRY_ACTIVE_KEY_ID='m10-owned',PEOPLE_CREDENTIAL_RETRY_KEYS_JSON=json.dumps({'m10-owned':secrets.token_hex(32)}),INTELLIGENCE_ENABLED='true',INTELLIGENCE_SCRATCH_ROOT=str(out/'scratch'),INTELLIGENCE_PYTHON='/tmp/schach-improvements-ai-venv/bin/python',INTELLIGENCE_WHISPER_SCRIPT=str(ROOT/'backend/tools/whisper_transcribe.py'),INTELLIGENCE_WHISPER_MODEL='/tmp/schach-improvements-ai-models/whisper-direct',INTELLIGENCE_OLLAMA_URL='http://127.0.0.1:11435')
 inventory=migration_inventory(ROOT);maximum=inventory['maximum'];result['sqlInventory']={'maximum':maximum,'sha256':inventory['sha256']}
 command([str(out/'migrate')],env,'fresh-migrations.log');command([str(out/'migrate')],env,'fresh-idempotent.log');assert sql('SELECT count(*) FROM schach_schema_migrations')==str(maximum);url=start();stop();before=sql('SELECT count(*) FROM tasks')
 sql(inventory['up'][-1].with_name(inventory['up'][-1].name.replace('.up.sql','.down.sql')).read_text()+f"\nDELETE FROM schach_schema_migrations WHERE version={maximum};");command([str(out/'migrate')],env,'populated-upgrade.log');command([str(out/'migrate')],env,'populated-idempotent.log');assert sql('SELECT count(*) FROM tasks')==before;assert sql('SELECT count(*) FROM schach_schema_migrations')==str(maximum);result['checks'].append(f'Compiled versioned runner fresh{maximum} and populated{maximum-1}→{maximum} preserve seeded business rows/checksums')
 url=start();command(['python3',str(ROOT/'verification/runtime/intelligence_fixture.py'),'--url',url,'--output',str(out/'fixture.json'),'--provider-expected','--allow-demo-mutations'],log='fixture.log');(out/'ready.json').write_text(json.dumps({'url':url,'pid':server.pid,'schema':schema})+'\n')
 while not(out/'stop').exists():
  if server.poll() is not None:raise RuntimeError('owned server stopped unexpectedly')
  time.sleep(.25)
 result['status']='passed'
finally:
 stop();result['binarySHA256']=hashlib.sha256((out/'server').read_bytes()).hexdigest() if(out/'server').exists()else None;result['scratchEmpty']=not any((out/'scratch').iterdir()) if(out/'scratch').exists()else True
 command(['psql',admin,'-v','ON_ERROR_STOP=1','-c','DROP SCHEMA IF EXISTS '+schema+' CASCADE'],log='cleanup.log');(out/'result.json').write_text(json.dumps(result,indent=2)+'\n')
