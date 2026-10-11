#!/usr/bin/env python3
"""Own fictional authenticated gateway fixture; never provisions providers."""
import argparse,hashlib,json,secrets,time,urllib.request,urllib.error,urllib.parse
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--allow-demo-mutations',action='store_true');p.add_argument('--provider-expected',action='store_true');a=p.parse_args();assert a.allow_demo_mutations and urllib.parse.urlsplit(a.url).hostname in ('127.0.0.1','localhost');cookie='';checks=[]
def call(method,path,body=None,raw=None,expected=200):
 headers={'Cookie':cookie};data=raw
 if body is not None:data=json.dumps(body).encode();headers['Content-Type']='application/json'
 try:r=urllib.request.urlopen(urllib.request.Request(a.url+'/api'+path,data=data,headers=headers,method=method),timeout=20)
 except urllib.error.HTTPError as e:r=e
 with r:payload=r.read();status=r.status;h=r.headers
 assert status==expected,(method,path,status,payload[:250]);return json.loads(payload) if payload else {},h
result={'status':'failed','checks':checks,'providerExpected':a.provider_expected}
try:
 session,h=call('POST','/auth/login',{'email':'founder@schach.demo','password':'SchachDemo!2026'});cookie=h['Set-Cookie'].split(';')[0];cid=session['companies'][0]['id'];root='/companies/'+cid
 w,_=call('GET',root+'/workspace');uid=w['me']['id'];reviewer=next(x['id'] for x in w['people'] if x['id']!=uid and x.get('active',True))
 caps,h=call('GET',root+'/intelligence/capabilities');assert h['Cache-Control']=='no-store';assert all(caps['operations'].values())==a.provider_expected
 task={'retryKey':'m10-fixture-'+secrets.token_hex(4),'title':'Fictional delivery review','description':'Prepare the fictional delivery checklist. Ask an independent reviewer to confirm the checklist. The owner and deadline require human selection.','ownerId':uid,'reviewerId':'','departmentId':'','projectId':'','parentId':'','priority':'medium','status':'todo','dueDate':'2026-11-15','startDate':'','estimatedHours':1,'tags':[],'checklist':[],'dependencies':[],'collaborators':[],'recurrence':'none','requiresApproval':False}
 created,_=call('POST',root+'/tasks',task);tid=created['id'];detail,_=call('GET',root+'/tasks/'+tid)
 source={'kind':'task_fields','id':tid,'expectedVersion':detail['task']['version'],'selectedFieldSet':'narrative'}
 preview,h=call('POST',root+'/intelligence/selection-preview',{'operation':'action_draft','sources':[source]});assert len(preview['sources'])==1 and h['Cache-Control']=='no-store'
 call('POST',root+'/intelligence/jobs',{'operation':'action_draft','sources':[source],'selectionHash':preview['selectionHash'],'retryKey':'no-consent','optIn':{'accepted':False,'policyVersion':caps['policyVersion']}},expected=422)
 checks.append('Current gateway selection preview, explicit consent denial, no-store and ordinary canonical task creation')
 if not a.provider_expected:
  call('POST',root+'/intelligence/jobs',{'operation':'action_draft','sources':[source],'selectionHash':preview['selectionHash'],'retryKey':'missing-provider','optIn':{'accepted':True,'policyVersion':caps['policyVersion']}},expected=503)
  history,_=call('GET',root+'/intelligence/jobs');assert not history['jobs'];checks.append('Missing optional providers preserve manual task workflow and create zero jobs')
 else:
  conv,_=call('POST',root+'/conversations',{'title':'Public speech local exercise','kind':'group','participantIds':[uid,reviewer]});cv=conv['id'];cp=root+'/conversations/'+cv
  call('PATCH',cp,{'expectedVersion':1,'forwarding':'selected'})
  wave=Path('/tmp/schach-roadmap-native-runtime-20261011/m10-fixtures/public-speech-fixture.wav').read_bytes();sha=hashlib.sha256(wave).hexdigest();assert sha=='40caa4d41e4f0458f9ccaaaa1a16dff9fe47c14f5bc5d40713bde536325f967a'
  media,_=call('POST',cp+'/media',{'fileName':'Public speech.wav','size':len(wave),'sha256':sha});mid=media['id'];call('POST',cp+'/media/'+mid+'/upload',raw=wave);call('POST',cp+'/media/'+mid+'/finalize',{})
  message,_=call('POST',cp+'/messages',{'clientMessageId':'m10-public-'+secrets.token_hex(4),'body':'Public speech for explicit local transcription.','mediaIds':[mid]})
  result.update(conversation=cv,message=message['message']['id'],media=mid,publicWaveSHA256=sha,provider=caps['provider']);checks.append('Real public WAV reserve/upload/ClamAV clean/finalize/message attachment via current gateway')
 result.update(status='passed',company=cid,owner=uid,reviewer=reviewer,task=tid,source=source)
finally:
 a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':result['status'],'checks':len(checks)}))
