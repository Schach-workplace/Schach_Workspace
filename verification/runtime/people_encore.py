#!/usr/bin/env python3
"""M9 actual exported Encore against an owned PostgreSQL container and network."""
import argparse,json,os,secrets,socket,subprocess,tempfile,time,shutil,base64,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--allow-demo-mutations',action='store_true');a=p.parse_args();assert a.allow_demo_mutations;out=a.output.resolve();out.mkdir(parents=True,exist_ok=True);suffix=secrets.token_hex(6);pg='schach-m9-pg-'+suffix;name='schach-m9-encore-'+suffix;network=name;tag='schach-m9-encore:'+suffix;made=[];daemon=None;cache=Path(tempfile.mkdtemp(prefix='schach-m9-cache-'));result={'status':'failed','checks':[]}
def cmd(args,cwd=ROOT,env=None,log='commands.log'):
 with(out/log).open('ab')as f:return subprocess.run(args,cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT,check=True,timeout=900)
def free_port():
 with socket.socket()as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
try:
 encore_env=dict(os.environ,XDG_CACHE_HOME=str(cache),ENCORE_CONFIG_DIR=str(cache/'config'),ENCORE_DAEMON_LOG_PATH=str(out/'owned-daemon.log'),ENCORE_DEVDASH_LISTEN_ADDR='127.0.0.1:'+str(free_port()),ENCORE_MCPSSE_LISTEN_ADDR='127.0.0.1:'+str(free_port()),ENCORE_OBJECTSTORAGE_LISTEN_ADDR='127.0.0.1:'+str(free_port()))
 daemon_log=(out/'owned-daemon.log').open('wb');daemon=subprocess.Popen(['encore','daemon','--foreground'],env=encore_env,stdout=daemon_log,stderr=subprocess.STDOUT);daemon_log.close();time.sleep(1)
 if not (cache/'encore/encored.sock').exists():raise RuntimeError('owned Encore daemon socket was not isolated')
 cmd(['docker','network','create',network]);made.append('network');cmd(['docker','run','-d','--name',pg,'--network',network,'-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_USER=schach','-e','POSTGRES_DB=workspace','encoredotdev/postgres:18']);made.append('pg')
 for _ in range(100):
  if subprocess.run(['docker','exec',pg,'pg_isready','-U','schach','-d','workspace'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:break
  time.sleep(.1)
 else:raise RuntimeError('owned PostgreSQL startup failed')
 with tempfile.TemporaryDirectory(prefix='owned-export-',dir=out)as tmp:
  root=Path(tmp);cmd(['git','init','--quiet',str(root)]);ignore=shutil.ignore_patterns('.encore','.superpowers','.secrets.local.cue','encore.gen.*','node_modules','bin','*.db*')
  for directory in ('backend','encore'):shutil.copytree(ROOT/directory,root/directory,ignore=ignore)
  cfg=root/'encore/api/config.cue';cfg.write_text(cfg.read_text().replace('SeedDemo: false','SeedDemo: true'))
  with socket.socket()as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
  base=f'http://127.0.0.1:{port}';config={'metadata':{'app_id':'schach-m9-owned','env_name':'disposable-local','env_type':'development','cloud':'local','base_url':base},'auth':[{'type':'key','id':1,'key':{'$env':'SERVICE_API_KEY'}}],'sql_servers':[{'host':pg+':5432','tls_config':{'disabled':True},'databases':{'workspace':{'name':'workspace','username':'schach','password':'disposable-trust','min_connections':1,'max_connections':20}}}],'secrets':{'BootstrapPassword':{'$env':'BOOTSTRAP_PASSWORD'}},'log_config':'warn'}
  infra=root/'infra.json';infra.write_text(json.dumps(config));cmd(['encore','-vv','build','docker',tag,'--config',str(infra),'--base','alpine:3'],root/'encore',env=encore_env,log='build.log');made.append('image');result['imageID']=subprocess.check_output(['docker','image','inspect',tag,'--format','{{.Id}}'],text=True).strip();result['checks'].append('Actual current Encore exporter builds current platform')
  # Apply numbered SQL using the declared single standalone migration owner to
  # the dedicated physical database before booting the exported gateway.
  files=sorted((ROOT/'backend/migrations').glob('*.up.sql'),key=lambda p:int(p.name.split('_')[0]));sql='\n'.join(p.read_text()for p in files);r=subprocess.run(['docker','exec','-i',pg,'psql','-U','schach','-d','workspace','-v','ON_ERROR_STOP=1','--single-transaction'],input=sql.encode(),capture_output=True,check=True);(out/'migrations.log').write_bytes(r.stdout+r.stderr)
  ef=root/'runtime.env';ef.write_text('SERVICE_API_KEY='+base64.b64encode(secrets.token_bytes(32)).decode()+'\nBOOTSTRAP_PASSWORD='+secrets.token_urlsafe(32)+'\nPEOPLE_CREDENTIAL_RETRY_ACTIVE_KEY_ID=owned-v1\nPEOPLE_CREDENTIAL_RETRY_KEYS_JSON='+json.dumps({'owned-v1':secrets.token_hex(32)})+'\nDISABLE_SCHEDULER=true\nSEED_DEMO=true\nFINANCE_INTAKE_ROOT=/tmp/owned-m9-finance\nFINANCE_OCR_ENABLED=false\nFINANCE_PDF_ENABLED=false\nSESSION_HOURS=72\n');ef.chmod(0o600)
  cmd(['docker','run','-d','--name',name,'--network',network,'--env-file',str(ef),'-p',f'127.0.0.1:{port}:8080',tag]);made.append('app')
  for _ in range(200):
   try:
    if urllib.request.urlopen(base+'/api/health',timeout=1).status==200:break
   except OSError:pass
   time.sleep(.1)
  else:raise RuntimeError('actual exported Encore startup failed')
  cmd(['python3',str(ROOT/'verification/runtime/people_fixture.py'),'--url',base,'--output',str(out/'api.json'),'--allow-demo-mutations'],log='api.log');result['checks'].append('Actual exported gateway M9 People TCP flows on nativePG56');result['status']='passed'
finally:
 if daemon is not None and daemon.poll() is None:daemon.terminate();daemon.wait(10)
 if 'app'in made:subprocess.run(['docker','logs',name],stdout=(out/'runtime.log').open('wb'),stderr=subprocess.STDOUT);subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL)
 if 'pg'in made:subprocess.run(['docker','rm','-f',pg],stdout=subprocess.DEVNULL)
 if 'network'in made:subprocess.run(['docker','network','rm',network],stdout=subprocess.DEVNULL)
 if 'image'in made:subprocess.run(['docker','image','rm',tag],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 shutil.rmtree(cache,ignore_errors=True)
 (out/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
