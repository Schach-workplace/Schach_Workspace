#!/usr/bin/env python3
"""M8 actual exported Encore against an owned PostgreSQL container and network."""
import argparse,json,os,secrets,socket,subprocess,tempfile,time,shutil,base64,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--allow-demo-mutations',action='store_true');p.add_argument('--calendar-civil-only',action='store_true');a=p.parse_args();assert a.allow_demo_mutations;out=a.output.resolve();out.mkdir(parents=True,exist_ok=True);suffix=secrets.token_hex(6);pg='schach-m8-pg-'+suffix;name='schach-m8-encore-'+suffix;network=name;tag='schach-m8-encore:'+suffix;made=[];result={'status':'failed','checks':[]}
def cmd(args,cwd=ROOT,env=None,log='commands.log'):
 with(out/log).open('ab')as f:return subprocess.run(args,cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT,check=True,timeout=300)
try:
 cmd(['docker','network','create',network]);made.append('network');cmd(['docker','run','-d','--name',pg,'--network',network,'-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_USER=schach','-e','POSTGRES_DB=workspace','encoredotdev/postgres:18']);made.append('pg')
 for _ in range(100):
  if subprocess.run(['docker','exec',pg,'pg_isready','-U','schach','-d','workspace'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:break
  time.sleep(.1)
 else:raise RuntimeError('owned PostgreSQL startup failed')
 with tempfile.TemporaryDirectory(prefix='schach-m8-export-')as tmp:
  root=Path(tmp);ignore=shutil.ignore_patterns('.encore','.superpowers','.secrets.local.cue','encore.gen.*','node_modules','bin','*.db*')
  for directory in ('backend','encore'):shutil.copytree(ROOT/directory,root/directory,ignore=ignore)
  cfg=root/'encore/api/config.cue';cfg.write_text(cfg.read_text().replace('SeedDemo: false','SeedDemo: true'))
  with socket.socket()as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
  base=f'http://127.0.0.1:{port}';config={'metadata':{'app_id':'schach-m8-owned','env_name':'disposable-local','env_type':'development','cloud':'local','base_url':base},'auth':[{'type':'key','id':1,'key':{'$env':'SERVICE_API_KEY'}}],'sql_servers':[{'host':pg+':5432','tls_config':{'disabled':True},'databases':{'workspace':{'name':'workspace','username':'schach','password':'disposable-trust','min_connections':1,'max_connections':20}}}],'secrets':{'BootstrapPassword':{'$env':'BOOTSTRAP_PASSWORD'}},'log_config':'warn'}
  infra=root/'infra.json';infra.write_text(json.dumps(config));cmd(['encore','build','docker',tag,'--config',str(infra),'--base','alpine:3'],root/'encore',log='build.log');made.append('image');result['checks'].append('Actual current Encore exporter builds current platform')
  # Apply numbered SQL using the declared single standalone migration owner to
  # the dedicated physical database before booting the exported gateway.
  files=sorted((ROOT/'backend/migrations').glob('*.up.sql'),key=lambda p:int(p.name.split('_')[0]));sql='\n'.join(p.read_text()for p in files);r=subprocess.run(['docker','exec','-i',pg,'psql','-U','schach','-d','workspace','-v','ON_ERROR_STOP=1','--single-transaction'],input=sql.encode(),capture_output=True,check=True);(out/'migrations.log').write_bytes(r.stdout+r.stderr)
  ef=root/'runtime.env';ef.write_text('SERVICE_API_KEY='+base64.b64encode(secrets.token_bytes(32)).decode()+'\nBOOTSTRAP_PASSWORD='+secrets.token_urlsafe(32)+'\nSEED_DEMO=true\nFINANCE_INTAKE_ROOT=/tmp/owned-m8-finance\nFINANCE_OCR_ENABLED=false\nFINANCE_PDF_ENABLED=false\nSESSION_HOURS=72\n');ef.chmod(0o600)
  cmd(['docker','run','-d','--name',name,'--network',network,'--env-file',str(ef),'-p',f'127.0.0.1:{port}:8080',tag]);made.append('app')
  for _ in range(200):
   try:
    if urllib.request.urlopen(base+'/api/health',timeout=1).status==200:break
   except OSError:pass
   time.sleep(.1)
  else:raise RuntimeError('actual exported Encore startup failed')
  cmd(['python3',str(ROOT/('verification/runtime/planning_calendar_civil_fixture.py' if a.calendar_civil_only else 'verification/runtime/planning_goals_fixture.py')),'--url',base,'--output',str(out/'api.json'),'--allow-demo-mutations'],log='api.log');result['checks'].append('Actual exported gateway targeted Calendar civil-date TCP flow on nativePG49' if a.calendar_civil_only else 'Actual exported gateway TCP planning/M5 apply/goal measurement+concurrent retry/report evidence/correction/reminder endpoints pass on nativePG49');result['status']='passed'
finally:
 if 'app'in made:subprocess.run(['docker','logs',name],stdout=(out/'runtime.log').open('wb'),stderr=subprocess.STDOUT);subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL)
 if 'pg'in made:subprocess.run(['docker','rm','-f',pg],stdout=subprocess.DEVNULL)
 if 'network'in made:subprocess.run(['docker','network','rm',network],stdout=subprocess.DEVNULL)
 if 'image'in made:subprocess.run(['docker','image','rm',tag],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 (out/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
