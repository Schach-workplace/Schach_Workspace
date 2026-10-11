#!/usr/bin/env python3
"""Bounded current-source report adapter checks in unique owned schemas on55433.

No provider, inference, native fixture, existing schema, or user runtime is used.
Only aggregate predicates and resource/source identities are safe outputs.
"""
import argparse,base64,csv,hashlib,io,json,os,secrets,select,shutil,socket,subprocess,tempfile,time,urllib.error,urllib.request
from pathlib import Path
from runtime_contract import migration_inventory,scrub_runtime_env
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--adapter',choices=['standalone','encore'],required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--allow-demo-mutations',action='store_true');a=p.parse_args()
if not a.allow_demo_mutations:p.error('owned fictional mutations require explicit opt-in')
out=a.output.resolve();out.mkdir(parents=True,exist_ok=True);out.chmod(0o700)
suffix=secrets.token_hex(8);schema='schach_final_report_'+suffix;container='schach-final-report-'+suffix;tag='schach-final-report:'+suffix
made=[];processes=[];daemon=None;slirp=None;cache=None;result={'status':'failed','adapter':a.adapter,'schema':schema,'checks':[],'resources':[]}
def cmd(args,cwd=ROOT,env=None,log='commands.log'):
 with(out/log).open('ab')as f:return subprocess.run(args,cwd=cwd,env=env or scrub_runtime_env(os.environ),stdout=f,stderr=subprocess.STDOUT,check=True,timeout=900)
def sql(query):
 r=subprocess.run(['docker','exec','-i','schach-m0-native-20261010','psql','-U','schach','-d','schach_m0','-qAt','-v','ON_ERROR_STOP=1'],input=query.encode(),capture_output=True,check=True);return r.stdout.decode().strip()
def free_port():
 with socket.socket()as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def call(method,path,body=None,cookie=None):
 data=None if body is None else json.dumps(body).encode();headers={'Content-Type':'application/json'}
 if cookie:headers['Cookie']=cookie
 try:r=urllib.request.urlopen(urllib.request.Request(base+path,data=data,headers=headers,method=method),timeout=10)
 except urllib.error.HTTPError as e:r=e
 with r:return r.status,r.read(),r.headers
# Never serialize cookies, bodies, credentials, DB environment or their hashes.
def ok(method,path,body=None,cookie=None):
 status,raw,headers=call(method,path,body,cookie)
 if status!=200:raise AssertionError(f'{method} {path.split("?")[0]} status={status}')
 return json.loads(raw),headers
def login(email):
 b,h=ok('POST','/api/auth/login',{'email':email,'password':'SchachDemo!2026'});return b,h['Set-Cookie'].split(';')[0]
def stop():
 if a.adapter=='standalone':
  proc=processes[-1]
  if proc.poll()is None:proc.terminate();proc.wait(15)
 else:cmd(['docker','stop','--time','15',container],log='lifecycle.log')
def start():
 if a.adapter=='standalone':
  f=(out/'runtime-private.log').open('ab');proc=subprocess.Popen([str(binary),'--addr',f'127.0.0.1:{port}','--demo','--frontend',str(out/'absent-static')],env=env,stdout=f,stderr=subprocess.STDOUT);f.close();processes.append(proc);result['resources'].append({'pid':proc.pid,'port':port,'binarySHA256':result['binarySHA256']})
 else:cmd(['docker','start',container],log='lifecycle.log')
 deadline=time.monotonic()+30
 while time.monotonic()<deadline:
  try:
   if call('GET','/api/health')[0]==200:return
  except OSError:pass
  time.sleep(.05)
 raise RuntimeError('owned runtime health unavailable')
def poll_ready(ids):
 deadline=time.monotonic()+20
 while time.monotonic()<deadline:
  count=sql("SET search_path TO "+schema+"; SELECT count(*) FROM report_export_jobs WHERE id IN ("+','.join("'"+id+"'"for id in ids)+") AND state='ready';")
  if count==str(len(ids)):return
  time.sleep(.1)
 raise AssertionError('owned report generation did not become ready')
try:
 inventory=migration_inventory(ROOT);result['sqlMaximum']=inventory['maximum'];result['sqlHashes']=inventory['sha256'];assert inventory['maximum']==58
 sql('CREATE SCHEMA '+schema);made.append('schema')
 env=scrub_runtime_env(os.environ);env.update(DISABLE_SCHEDULER='true',INTELLIGENCE_ENABLED='false',FINANCE_OCR_ENABLED='false',FINANCE_PDF_ENABLED='false',SESSION_HOURS='72',REPORT_ARTIFACT_ROOT=str(out/'private-reports'),MEDIA_ROOT=str(out/'private-media'),FINANCE_INTAKE_ROOT=str(out/'private-finance'))
 env['DATABASE_URL']='postgres://schach@127.0.0.1:55433/schach_m0?sslmode=disable&search_path='+schema
 cmd(['go','run','./cmd/migrate'],ROOT/'backend',env,log='migrations.log')
 assert sql('SET search_path TO '+schema+'; SELECT count(*) FROM schach_schema_migrations;')=='58'
 result['checks'].append('fresh numberedSQL58 schema; no AutoMigrate')
 port=free_port();base=f'http://127.0.0.1:{port}'
 if a.adapter=='standalone':
  binary=out/'server';cmd(['go','build','-o',str(binary),'./cmd/server'],ROOT/'backend',log='build.log');result['binarySHA256']=hashlib.sha256(binary.read_bytes()).hexdigest();start()
 else:
  # Private daemon socket AND isolated fixed network listeners; host daemons
  # and other projects are never stopped or addressed.
  cache=Path(tempfile.mkdtemp(prefix='sfr-',dir='/home/brahma/.cache'));cache.chmod(0o700);pidfile=cache/'namespace.pid';ready=cache/'network.ready';resolver=cache/'resolv.conf';resolver.write_text('nameserver 10.0.2.3\n')
  eenv=dict(scrub_runtime_env(os.environ),XDG_CACHE_HOME=str(cache),ENCORE_CONFIG_DIR=str(cache/'config'),ENCORE_SQLDB_HOST='10.0.2.2:55433',ENCORE_SQLDB_DATABASE='schach_m0',ENCORE_SQLDB_USER='schach',ENCORE_SQLDB_PASSWORD='')
  bootstrap="import os,time,subprocess;from pathlib import Path;Path("+repr(str(pidfile))+").write_text(str(os.getpid()));ready=Path("+repr(str(ready))+ ");\nwhile not ready.exists():time.sleep(.05)\nsubprocess.run(['mount','--bind',"+repr(str(resolver))+",'/etc/resolv.conf'],check=True)\nos.execvp('encore',['encore','daemon','--foreground'])"
  f=(out/'daemon-private.log').open('wb');daemon=subprocess.Popen(['unshare','-Urnm','--','python3','-c',bootstrap],env=eenv,stdout=f,stderr=subprocess.STDOUT);f.close()
  deadline=time.monotonic()+10
  while not pidfile.exists():
   if daemon.poll()is not None or time.monotonic()>deadline:raise RuntimeError('owned Encore namespace unavailable')
   time.sleep(.05)
  npid=int(pidfile.read_text());assert os.readlink(f'/proc/{npid}/ns/net')!=os.readlink('/proc/self/ns/net')
  rfd,wfd=os.pipe();f=(out/'slirp-private.log').open('wb');slirp=subprocess.Popen(['slirp4netns','--configure','--mtu=65520','--ready-fd='+str(wfd),str(npid),'tap0'],pass_fds=(wfd,),stdout=f,stderr=subprocess.STDOUT);f.close();os.close(wfd)
  if not select.select([rfd],[],[],10)[0]:raise RuntimeError('owned slirp readiness unavailable')
  assert os.read(rfd,1)==b'1';os.close(rfd);ready.write_text('ready')
  deadline=time.monotonic()+15
  while not(cache/'encore/encored.sock').exists():
   if daemon.poll()is not None or time.monotonic()>deadline:raise RuntimeError('owned Encore socket unavailable')
   time.sleep(.05)
  copied=out/'source';copied.mkdir();cmd(['git','init','--quiet',str(copied)])
  ignore=shutil.ignore_patterns('.encore','.superpowers','.secrets.local.cue','encore.gen.*','node_modules','bin','*.db*')
  for name in ('backend','encore'):shutil.copytree(ROOT/name,copied/name,ignore=ignore)
  cfg=copied/'encore/api/config.cue';cfg.write_text(cfg.read_text().replace('SeedDemo: false','SeedDemo: true'))
  config={'metadata':{'app_id':'schach-final-report-owned','env_name':'disposable-local','env_type':'development','cloud':'local','base_url':base},'auth':[{'type':'key','id':1,'key':{'$env':'SERVICE_API_KEY'}}],'sql_servers':[{'host':'127.0.0.1:55433','tls_config':{'disabled':True},'databases':{'workspace':{'name':'workspace','username':'schach','password':'disposable-trust','min_connections':1,'max_connections':8}}}],'secrets':{'BootstrapPassword':{'$env':'BOOTSTRAP_PASSWORD'}},'log_config':'warn'}
  infra=out/'export-infra-private.json';infra.write_text(json.dumps(config));infra.chmod(0o600)
  cmd(['encore','check'],copied/'encore',eenv,log='encore-check.log');cmd(['encore','build','docker',tag,'--config',str(infra),'--base','alpine:3'],copied/'encore',eenv,log='encore-export.log');made.append('image')
  result['imageID']=subprocess.check_output(['docker','image','inspect',tag,'--format','{{.Id}}'],text=True).strip()
  # Export-time resource validation expects workspace. Runtime infra maps the
  # same EncoreName to the existing physical fixture DB, with PGOPTIONS pinning
  # every pgx connection to ONLY this new owned schema. Never create workspace DB.
  databases=config['sql_servers'][0]['databases'];databases['schach_m0']=databases.pop('workspace')
  runtime_infra=out/'runtime-infra-private.json';runtime_infra.write_text(json.dumps(config));runtime_infra.chmod(0o600)
  runtimeenv=out/'runtime-private.env';runtimeenv.write_text('SERVICE_API_KEY='+base64.b64encode(secrets.token_bytes(32)).decode()+'\nBOOTSTRAP_PASSWORD='+secrets.token_urlsafe(32)+'\nSEED_DEMO=true\nDISABLE_SCHEDULER=true\nINTELLIGENCE_ENABLED=false\nFINANCE_OCR_ENABLED=false\nFINANCE_PDF_ENABLED=false\nSESSION_HOURS=72\nREPORT_ARTIFACT_ROOT=/owned/private-reports\nMEDIA_ROOT=/owned/private-media\nFINANCE_INTAKE_ROOT=/owned/private-finance\nPGOPTIONS=-c search_path='+schema+'\nENCORE_INFRA_CONFIG_PATH=/owned/runtime-infra-private.json\nENCORE_LISTEN_ADDR=127.0.0.1:'+str(port)+'\n');runtimeenv.chmod(0o600)
  cmd(['docker','create','--name',container,'--network','host','--env-file',str(runtimeenv),'-v',str(out)+':/owned',tag],log='lifecycle.log');made.append('container');result['resources'].append({'container':container,'port':port,'imageID':result['imageID']});start()
 result['checks'].append('current compiled adapter authenticated HTTP health/login on owned schema')
 session,c=login('founder@schach.demo');cid=session['companies'][0]['id'];owner=session['user']['id'];root='/api/companies/'+cid
 people=[]
 for label in ('healthy','departing'):
  user,_=ok('POST',root+'/people',{'name':label+' report','email':label+'-report@example.invalid','password':'SchachDemo!2026','role':'member','capacityHours':40},c);people.append(user['id'])
 _,ac=login('healthy-report@example.invalid');_,bc=login('departing-report@example.invalid');uid,bid=people
 # Current CSV crosses several byte chunks and retains full selected row count.
 task={'title':'=formula','description':'x'*1024,'ownerId':uid,'reviewerId':owner,'priority':'medium','startDate':'2026-09-01','dueDate':'2026-09-20','estimatedHours':1,'collaborators':[bid]}
 for i in range(130):task['title']='=formula'if i==0 else 'row '+str(i);ok('POST',root+'/tasks',task,c)
 reportroot=root+'/reports';filters='?from=2026-09-01&to=2026-09-30'
 b,_=ok('GET',reportroot+'/tasks/summary'+filters,cookie=ac);token=b['snapshot']
 status,data,headers=call('GET',reportroot+'/tasks/export'+filters+'&snapshot='+token,cookie=ac)
 assert status==200 and int(headers['Content-Length'])==len(data) and len(data)>65536 and len(list(csv.reader(io.StringIO(data.decode()))))==131 and b"'=formula"in data
 result['checks'].append('actual TCP current CSV full frozen rows/formula/Content-Length across64KiB')
 # Saved scheduling uses real public configuration routes and the actual worker.
 cfg={'name':'Runtime recipient isolation','basis':'task_history_v1','filters':{},'periodRule':'fixed','from':'2026-09-01','to':'2026-09-30','timezonePolicy':'explicit','reportZone':'Asia/Kolkata','recipientIds':[bid,uid]}
 definition,_=ok('POST',reportroot+'/definitions',{'retryKey':'runtime-def','configuration':cfg},c);did=definition['definition']['id']
 ok('PATCH',reportroot+'/definitions/'+did+'/schedule',{'retryKey':'runtime-schedule','expectedDefinitionVersion':1,'expectedScheduleVersion':0,'weekdays':[0,1,2,3,4,5,6],'localMinute':'00:00','scheduleZone':'UTC','state':'active'},c)
 stop();sql("SET search_path TO "+schema+"; UPDATE report_schedules SET next_occurrence_utc=now()-interval '48 hours' WHERE definition_id='"+did+"';");start()
 deadline=time.monotonic()+20;ids=[]
 while time.monotonic()<deadline:
  raw=sql("SET search_path TO "+schema+"; SELECT id FROM report_export_jobs WHERE definition_id='"+did+"' ORDER BY id;");ids=raw.splitlines()if raw else[]
  if len(ids)==2:break
  time.sleep(.1)
 assert len(ids)==2;poll_ready(ids)
 stop();start() # Owned process restart triggers short delivery maintenance.
 def ready_items(cookie):
  b,_=ok('GET',root+'/attention?state=all',cookie=cookie);return[x for x in b['items']if x['sourceKind']=='report_export']
 ai=ready_items(ac);bi=ready_items(bc);assert len(ai)==len(bi)==1 and not ai[0]['canRoute'] and not ai[0]['canDecide']
 ok('PATCH',root+'/people/'+bid,{'active':False},c)
 aj,_=ok('GET',reportroot+'/exports/'+ai[0]['sourceId'],cookie=ac);job=aj['job'];assert call('GET',reportroot+'/artifacts/'+job['artifactId'],cookie=ac)[0]==200
 assert call('GET',reportroot+'/exports/'+bi[0]['sourceId'],cookie=bc)[0]in(401,403)
 assert len(ready_items(ac))==1
 result['checks'].append('worker schedule/generation/restart delivery reaches public Inbox; departed B denied while ready A reads/delivery remain eligible')
 result['status']='passed'
finally:
 for proc in processes:
  if proc.poll()is None:proc.terminate();proc.wait(15)
 if 'container'in made:
  subprocess.run(['docker','logs',container],stdout=(out/'encore-runtime-private.log').open('wb'),stderr=subprocess.STDOUT);subprocess.run(['docker','rm','-f',container],stdout=subprocess.DEVNULL,check=True)
 if daemon is not None and daemon.poll()is None:daemon.terminate();daemon.wait(10)
 if slirp is not None and slirp.poll()is None:slirp.terminate();slirp.wait(10)
 if cache is not None:shutil.rmtree(cache)
 if 'image'in made:subprocess.run(['docker','image','rm',tag],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
 if 'schema'in made:sql('DROP SCHEMA '+schema+' CASCADE')
 result['cleanup']={'ownedProcessesStopped':all(proc.poll()is not None for proc in processes),'schemaDropped':'schema'in made,'containerRemoved':'container'in made,'daemonStopped':daemon is None or daemon.poll()is not None,'slirpStopped':slirp is None or slirp.poll()is not None}
 (out/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='sqlHashes'}))
