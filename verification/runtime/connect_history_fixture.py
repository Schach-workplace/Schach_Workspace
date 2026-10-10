#!/usr/bin/env python3
"""Own a fictional database/server, seed exact HTTP history, run Chromium, then clean up."""
import argparse,json,os,secrets,signal,socket,subprocess,tempfile,time,urllib.request,urllib.error,urllib.parse
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def port():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def call(base,method,path,body=None,cookie=None):
 headers={'Origin':base}
 if body is not None:headers['Content-Type']='application/json'
 if cookie:headers['Cookie']=cookie
 request=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers=headers,method=method)
 try:response=urllib.request.urlopen(request,timeout=30)
 except urllib.error.HTTPError as e:response=e
 with response:
  data=response.read();return response.status,json.loads(data or '{}'),response.headers,len(data)
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--allow-demo-mutations',action='store_true');p.add_argument('--output',type=Path,required=True);p.add_argument('--postgres-container');a=p.parse_args()
 if not a.allow_demo_mutations:p.error('explicit owned fixture mutations required')
 a.output.mkdir(parents=True,exist_ok=True);out=a.output.resolve();os.chmod(out,0o700);schema='schach_connect_'+secrets.token_hex(8);proc=None;pg=False
 result={'status':'failed','database':'postgres' if a.postgres_container else 'sqlite','physicalGates':'unchecked'}
 def cmd(args,cwd=ROOT,env=None,stdin=None):
  with (out/'fixture.log').open('ab') as log:subprocess.run(args,cwd=cwd,env=env,input=stdin,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=600)
 def sql(query):cmd(['docker','exec','-i',a.postgres_container,'psql','-U','schach','-d',urllib.parse.urlsplit(os.environ['TEST_DATABASE_URL']).path.lstrip('/'),'-v','ON_ERROR_STOP=1'],stdin=query.encode())
 try:
  with tempfile.TemporaryDirectory(prefix='schach-connect-owned-') as directory:
   tmp=Path(directory);os.chmod(tmp,0o700);backendPort=port();proxyPort=port();base=f'http://127.0.0.1:{backendPort}';proxy=f'http://127.0.0.1:{proxyPort}';env=dict(os.environ)
   for name in list(env):
    if name=='DATABASE_URL' or name.startswith(('COMMUNICATION_','LIVEKIT_','APNS_','FCM_','MFA_','BOOTSTRAP_')):env.pop(name)
   env.update(ENVIRONMENT='development',SECURE_COOKIES='false',DISABLE_SCHEDULER='true',MEDIA_ROOT=str(tmp/'media'),ALLOWED_ORIGINS=base+','+proxy)
   if a.postgres_container:
    parsed=urllib.parse.urlsplit(os.environ['TEST_DATABASE_URL']);query=urllib.parse.parse_qs(parsed.query);query['search_path']=[schema];env['DATABASE_URL']=urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query,doseq=True)));sql('CREATE SCHEMA '+schema+';');pg=True;cmd(['go','run','./cmd/migrate'],ROOT/'backend',env)
   cmd(['go','build','-o',str(tmp/'server'),'./cmd/server'],ROOT/'backend',env)
   with (out/'server.log').open('wb') as log:proc=subprocess.Popen([str(tmp/'server'),'--addr',f'127.0.0.1:{backendPort}','--db',str(tmp/'owned.db'),'--frontend',str(ROOT/'frontend/dist'),'--demo'],env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
   for _ in range(150):
    try:
     if call(base,'GET','/api/health')[0]==200:break
    except OSError:pass
    if proc.poll() is not None:raise RuntimeError('Owned server failed startup')
    time.sleep(.1)
   status,session,headers,_=call(base,'POST','/api/auth/login',{'email':'founder@schach.demo','password':'SchachDemo!2026'});assert status==200;ownerCookie=headers['Set-Cookie'].split(';')[0];company=session['companies'][0]['id'];owner=session['user']['id'];password=secrets.token_urlsafe(24);run=secrets.token_hex(6);email=f'history-{run}@example.invalid'
   status,person,_,_=call(base,'POST',f'/api/companies/{company}/people',{'name':'History reader '+run,'email':email,'password':password,'role':'member','capacityHours':40},ownerCookie);assert status==200;reader=person['id']
   status,_,headers,_=call(base,'POST','/api/auth/login',{'email':email,'password':password});assert status==200;readerCookie=headers['Set-Cookie'].split(';')[0]
   status,outsider,_,_=call(base,'POST',f'/api/companies/{company}/people',{'name':'Private outsider','email':f'outsider-{run}@example.invalid','password':password,'role':'admin','capacityHours':40},ownerCookie);assert status==200
   status,_,headers,_=call(base,'POST','/api/auth/login',{'email':f'outsider-{run}@example.invalid','password':password});assert status==200;outsiderCookie=headers['Set-Cookie'].split(';')[0]
   fixtures=[];totalBytes=0
   for width in [320,375,430]:
    groups=[]
    for kind in ['A','B']:
     title=f'History {kind} {run} {width}';status,v,_,_=call(base,'POST',f'/api/companies/{company}/conversations',{'title':title,'kind':'group','public':False,'participantIds':[owner,reader],'forwarding':'deny'},ownerCookie);assert status==200;groups.append({'id':v['id'],'title':title})
    root=f"/api/companies/{company}/conversations/{groups[0]['id']}";rows=[]
    for i in range(1,251):
     text=f'fixture {width} row {i:03} '+('short' if i%3==0 else ('Unicode भारत\nWrapped details '+'material delivery '*18) if i%3==1 else 'Team update '*9)
     body={'clientMessageId':f'{run}-{width}-{i}','body':text,'replyToId':'','mentionIds':[reader] if i in [5,10] else [],'mentionAll':False};status,v,_,size=call(base,'POST',root+'/messages',body,ownerCookie);assert status==200;rows.append(v['message']);totalBytes+=size
    for path in ['', '/messages','/sync','/messages/'+rows[4]['id']+'/thread']:assert call(base,'GET',root+path,cookie=outsiderCookie)[0]==404
    assert call(base,'GET',root+'/messages')[0]==401;assert call(base,'GET',root.replace(company,'foreign')+'/messages',cookie=readerCookie)[0]==404
    cursor='';seen=[];pages=[]
    while True:
     status,v,_,size=call(base,'GET',root+'/messages'+('?cursor='+urllib.parse.quote(cursor) if cursor else ''),cookie=readerCookie);assert status==200;seen=v['messages']+seen;pages.append(len(v['messages']));cursor=v['cursor'];totalBytes+=size
     if not v['hasMore']:break
    assert [m['id'] for m in seen]==[m['id'] for m in rows];assert pages==[100,100,50]
    assert call(base,'GET',root+'/messages?cursor='+urllib.parse.quote(cursor),cookie=ownerCookie)[0]==409
    fixtures.append({'width':width,'a':groups[0],'b':groups[1],'rows':rows,'httpPages':pages})
   manifest=tmp/'manifest.json';manifest.write_text(json.dumps({'owned':True,'run':run,'backend':base,'proxy':proxy,'pid':proc.pid,'company':company,'ownerId':owner,'readerId':reader,'ownerCookie':ownerCookie,'readerCookie':readerCookie,'email':email,'password':password,'fixtures':fixtures,'output':str(out)}));manifest.chmod(0o600)
   result['fixtureRows']=750;result['seedAndColdPageResponseBytes']=totalBytes;result['authorizationChecks']='private outsider404, unauth401, foreign404, actor-bound cursor409'
   cmd(['node',str(ROOT/'verification/runtime/connect_history_smoke.mjs'),'--manifest',str(manifest)])
   result['browser']=json.loads((out/'browser-result.json').read_text());result['status']=result['browser']['status']
 except Exception as e:result['error']=str(e);raise
 finally:
  if proc and proc.poll() is None:
   os.killpg(proc.pid,signal.SIGTERM)
   try:proc.wait(10)
   except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(10)
  if pg:sql('DROP SCHEMA IF EXISTS '+schema+' CASCADE;')
  result['cleanup']={'serverStopped':not proc or proc.poll() is not None,'ownedSchemaDropped':pg,'temporaryDatabaseMediaManifestRemoved':True};(out/'result.json').write_text(json.dumps(result,indent=2)+'\n')
if __name__=='__main__':main()
