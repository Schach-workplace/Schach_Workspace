#!/usr/bin/env python3
"""M10 actual exported Encore against an owned PostgreSQL container and network."""
import argparse,json,os,secrets,socket,subprocess,tempfile,time,shutil,base64,urllib.request,select
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--allow-demo-mutations',action='store_true');a=p.parse_args();assert a.allow_demo_mutations;out=a.output.resolve();out.mkdir(parents=True,exist_ok=True);suffix=secrets.token_hex(6);pg='schach-m10-pg-'+suffix;name='schach-m10-encore-'+suffix;network=name;tag='schach-m10-encore:'+suffix;made=[];daemon=None;slirp=None;cache=Path(tempfile.mkdtemp(prefix='schach-m10-cache-'));result={'status':'failed','checks':[]}
def cmd(args,cwd=ROOT,env=None,log='commands.log'):
 with(out/log).open('ab')as f:return subprocess.run(args,cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT,check=True,timeout=900)
def free_port():
 with socket.socket()as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
try:
 # Run all Encore fixed daemon listeners in an owned user/network namespace.
 cmd(['docker','image','inspect','encoredotdev/postgres:18','alpine:3'])
 pg_port=free_port()
 cmd(['docker','network','create',network]);made.append('network');cmd(['docker','run','--pull=never','-d','--name',pg,'--network',network,'-p',f'127.0.0.1:{pg_port}:5432','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_USER=schach','-e','POSTGRES_DB=workspace','encoredotdev/postgres:18']);made.append('pg')
 for _ in range(100):
  if subprocess.run(['psql',f'postgres://schach@127.0.0.1:{pg_port}/workspace?sslmode=disable','-Atqc','SELECT 1'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:break
  time.sleep(.1)
 else:raise RuntimeError('owned PostgreSQL startup failed')
 encore_env=dict(os.environ,XDG_CACHE_HOME=str(cache),ENCORE_CONFIG_DIR=str(cache/'config'),ENCORE_DAEMON_LOG_PATH=str(out/'owned-daemon.log'),ENCORE_DEVDASH_LISTEN_ADDR='127.0.0.1:'+str(free_port()),ENCORE_MCPSSE_LISTEN_ADDR='127.0.0.1:'+str(free_port()),ENCORE_OBJECTSTORAGE_LISTEN_ADDR='127.0.0.1:'+str(free_port()),ENCORE_SQLDB_HOST='10.0.2.2:'+str(pg_port),ENCORE_SQLDB_DATABASE='workspace',ENCORE_SQLDB_USER='schach',ENCORE_SQLDB_PASSWORD='')
 pidfile=cache/'namespace.pid';readyfile=cache/'network.ready';resolver=cache/'resolv.conf';resolver.write_text('nameserver 10.0.2.3\n')
 bootstrap="import os,time,subprocess;from pathlib import Path;Path("+repr(str(pidfile))+").write_text(str(os.getpid()));ready=Path("+repr(str(readyfile))+");\nwhile not ready.exists():time.sleep(.05)\nsubprocess.run(['mount','--bind',"+repr(str(resolver))+",'/etc/resolv.conf'],check=True)\nos.execvp('encore',['encore','daemon','--foreground'])"
 daemon_log=(out/'owned-daemon.log').open('wb');daemon=subprocess.Popen(['unshare','-Urnm','--','python3','-c',bootstrap],env=encore_env,stdout=daemon_log,stderr=subprocess.STDOUT);daemon_log.close()
 for _ in range(100):
  if pidfile.exists():break
  if daemon.poll() is not None:raise RuntimeError('namespace bootstrap failed')
  time.sleep(.05)
 else:raise RuntimeError('namespace bootstrap timeout')
 ns_pid=int(pidfile.read_text());assert os.readlink(f'/proc/{ns_pid}/ns/net')!=os.readlink('/proc/self/ns/net')
 rfd,wfd=os.pipe();slirp_log=(out/'slirp.log').open('wb');slirp=subprocess.Popen(['slirp4netns','--configure','--mtu=65520','--ready-fd='+str(wfd),str(ns_pid),'tap0'],pass_fds=(wfd,),stdout=slirp_log,stderr=subprocess.STDOUT);slirp_log.close();os.close(wfd)
 if not select.select([rfd],[],[],10)[0]:raise RuntimeError('slirp network setup timeout')
 assert os.read(rfd,1)==b'1';os.close(rfd);readyfile.write_text('ready')
 (out/'namespace.json').write_text(json.dumps({'namespacePid':ns_pid,'hostNetNamespace':os.readlink('/proc/self/ns/net'),'ownedNetNamespace':os.readlink(f'/proc/{ns_pid}/ns/net'),'postgresContainer':pg,'postgresPublishedPort':pg_port,'sourceHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()},indent=2)+'\n')
 for _ in range(100):
  if (cache/'encore/encored.sock').exists():break
  if daemon.poll() is not None:raise RuntimeError('owned namespace daemon failed')
  time.sleep(.05)
 else:raise RuntimeError('owned Encore daemon socket was not isolated')
 with tempfile.TemporaryDirectory(prefix='owned-export-',dir=out)as tmp:
  root=Path(tmp);cmd(['git','init','--quiet',str(root)]);ignore=shutil.ignore_patterns('.encore','.superpowers','.secrets.local.cue','encore.gen.*','node_modules','bin','*.db*')
  for directory in ('backend','encore'):shutil.copytree(ROOT/directory,root/directory,ignore=ignore)
  cfg=root/'encore/api/config.cue';cfg.write_text(cfg.read_text().replace('SeedDemo: false','SeedDemo: true'))
  with socket.socket()as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
  base=f'http://127.0.0.1:{port}';config={'metadata':{'app_id':'schach-m10-owned','env_name':'disposable-local','env_type':'development','cloud':'local','base_url':base},'auth':[{'type':'key','id':1,'key':{'$env':'SERVICE_API_KEY'}}],'sql_servers':[{'host':pg+':5432','tls_config':{'disabled':True},'databases':{'workspace':{'name':'workspace','username':'schach','password':'disposable-trust','min_connections':1,'max_connections':20}}}],'secrets':{'BootstrapPassword':{'$env':'BOOTSTRAP_PASSWORD'}},'log_config':'warn'}
  infra=root/'infra.json';infra.write_text(json.dumps(config));cmd(['encore','check'],root/'encore',env=encore_env,log='check.log');cmd(['encore','-vv','build','docker',tag,'--config',str(infra),'--base','alpine:3'],root/'encore',env=encore_env,log='build.log');made.append('image');result['imageID']=subprocess.check_output(['docker','image','inspect',tag,'--format','{{.Id}}'],text=True).strip();result['checks'].append('Actual current Encore exporter builds current platform')
  # Apply numbered SQL using the declared single standalone migration owner to
  # the dedicated physical database before booting the exported gateway.
  files=sorted((ROOT/'backend/migrations').glob('*.up.sql'),key=lambda p:int(p.name.split('_')[0]));sql='\n'.join(p.read_text()for p in files);r=subprocess.run(['docker','exec','-i',pg,'psql','-U','schach','-d','workspace','-v','ON_ERROR_STOP=1','--single-transaction'],input=sql.encode(),capture_output=True,check=True);(out/'migrations.log').write_bytes(r.stdout+r.stderr)
  ef=root/'runtime.env';ef.write_text('SERVICE_API_KEY='+base64.b64encode(secrets.token_bytes(32)).decode()+'\nBOOTSTRAP_PASSWORD='+secrets.token_urlsafe(32)+'\nPEOPLE_CREDENTIAL_RETRY_ACTIVE_KEY_ID=owned-v1\nPEOPLE_CREDENTIAL_RETRY_KEYS_JSON='+json.dumps({'owned-v1':secrets.token_hex(32)})+'\nDISABLE_SCHEDULER=true\nSEED_DEMO=true\nFINANCE_INTAKE_ROOT=/tmp/owned-m10-finance\nFINANCE_OCR_ENABLED=false\nFINANCE_PDF_ENABLED=false\nSESSION_HOURS=72\n');ef.chmod(0o600)
  cmd(['docker','run','--pull=never','-d','--name',name,'--network',network,'--env-file',str(ef),'-p',f'127.0.0.1:{port}:8080',tag]);made.append('app')
  for _ in range(200):
   try:
    if urllib.request.urlopen(base+'/api/health',timeout=1).status==200:break
   except OSError:pass
   time.sleep(.1)
  else:raise RuntimeError('actual exported Encore startup failed')
  cmd(['python3',str(ROOT/'verification/runtime/intelligence_fixture.py'),'--url',base,'--output',str(out/'api.json'),'--allow-demo-mutations'],log='api.log');result['checks'].append('Actual exported gateway M10 selected-source TCP flows and optional-provider manual fallback on nativePG57');result['status']='passed'
finally:
 if daemon is not None and daemon.poll() is None:daemon.terminate();daemon.wait(10)
 if slirp is not None and slirp.poll() is None:slirp.terminate();slirp.wait(10)
 if 'app'in made:subprocess.run(['docker','logs',name],stdout=(out/'runtime.log').open('wb'),stderr=subprocess.STDOUT);subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL)
 if 'pg'in made:subprocess.run(['docker','logs',pg],stdout=(out/'postgres.log').open('wb'),stderr=subprocess.STDOUT);subprocess.run(['docker','rm','-f',pg],stdout=subprocess.DEVNULL)
 if 'network'in made:subprocess.run(['docker','network','rm',network],stdout=subprocess.DEVNULL)
 if 'image'in made:subprocess.run(['docker','image','rm',tag],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 shutil.rmtree(cache,ignore_errors=True)
 (out/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
