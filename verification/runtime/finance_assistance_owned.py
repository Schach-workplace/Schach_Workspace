#!/usr/bin/env python3
"""Own one SQLite or random-schema PG process and actual rendered finance acceptance."""
import argparse,os,secrets,signal,socket,subprocess,time,urllib.request,urllib.parse,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);p.add_argument('--postgres-container');p.add_argument('--allow-demo-mutations',action='store_true');a=p.parse_args();assert a.allow_demo_mutations
out=a.output.resolve();out.mkdir(parents=True,exist_ok=True);schema='schach_finance_'+secrets.token_hex(8);created=False;proc=None
result={'status':'failed','database':'PostgreSQL' if a.postgres_container else 'SQLite'}
def cmd(args,cwd=ROOT,env=None,stdin=None,log='commands.log'):
 with (out/log).open('ab') as f:return subprocess.run(args,cwd=cwd,env=env,input=stdin,stdout=f,stderr=subprocess.STDOUT,check=True,timeout=240)
def sql(text):cmd(['docker','exec','-i',a.postgres_container,'psql','-U','schach','-d','schach_m0','-v','ON_ERROR_STOP=1'],stdin=text.encode())
try:
 env=dict(os.environ)
 for key in list(env):
  if key.startswith(('COMMUNICATION_','LIVEKIT_','APNS_','FCM_','MFA_','BOOTSTRAP_','FINANCE_','REPORT_','INTELLIGENCE_','PEOPLE_')) or key in ('DATABASE_URL','MEDIA_ROOT','CLAMAV_ADDRESS','SEED_DEMO','SECURE_COOKIES','ENVIRONMENT','ALLOWED_ORIGINS','SESSION_TTL_DAYS','SESSION_HOURS'):env.pop(key)
 env.update(ENVIRONMENT='development',SECURE_COOKIES='false',SESSION_HOURS='72',DISABLE_SCHEDULER='true',MEDIA_ROOT=str(out/'media'),ALLOWED_ORIGINS='',FINANCE_INTAKE_ROOT=str(out/'finance-intakes'),FINANCE_SCANNER_ADDRESS='127.0.0.1:13310',FINANCE_OCR_ENABLED='true',FINANCE_OCR_EXECUTABLE='/usr/bin/tesseract',FINANCE_OCR_LANGUAGE='eng',FINANCE_PDF_ENABLED='false')
 if a.postgres_container:
  sql('CREATE SCHEMA '+schema+';');created=True;parsed=urllib.parse.urlsplit(os.environ['TEST_DATABASE_URL']);query=urllib.parse.parse_qs(parsed.query);query['search_path']=[schema];env['DATABASE_URL']=urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query,doseq=True)));cmd(['go','run','./cmd/migrate'],ROOT/'backend',env)
 cmd(['go','build','-o',str(out/'server'),'./cmd/server'],ROOT/'backend',env)
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 base=f'http://127.0.0.1:{port}'
 with (out/'server.log').open('wb') as f:proc=subprocess.Popen([str(out/'server'),'--addr',f'127.0.0.1:{port}','--db',str(out/'owned.sqlite'),'--frontend',str(ROOT/'frontend/dist'),'--demo'],env=env,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
 for _ in range(100):
  try:
   if urllib.request.urlopen(base+'/api/health',timeout=1).status==200:break
  except OSError:pass
  time.sleep(.1)
 else:raise RuntimeError('Owned server not healthy')
 cmd(['python3',str(ROOT/'verification/runtime/finance_assistance_fixture.py'),'--url',base,'--output',str(out/'finance'),'--provider-expected','--allow-demo-mutations'],log='finance.log')
 env.update(SCHACH_SMOKE_URL=base,SCHACH_SMOKE_RESULT=str(out/'browser.json'),SCHACH_FINANCE_FIXTURE=str(out/'finance/result.json'))
 cmd(['node',str(ROOT/'verification/runtime/finance_assistance_smoke.mjs'),'--allow-demo-mutations'],env=env,log='browser.log');result['status']='passed'
finally:
 if proc and proc.poll() is None:
  os.killpg(proc.pid,signal.SIGTERM)
  try:proc.wait(10)
  except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(10)
 if created:sql('DROP SCHEMA '+schema+' CASCADE;')
 (out/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
