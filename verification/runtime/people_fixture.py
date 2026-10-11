#!/usr/bin/env python3
"""Fictional M9 TCP checks. Credentials remain in process and are never reported."""
import argparse,json,urllib.request,urllib.error,http.cookiejar,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--allow-demo-mutations',action='store_true');a=p.parse_args();assert a.allow_demo_mutations
checks=[];result={'status':'failed','checks':checks};suffix=uuid.uuid4().hex[:10]
def client():return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def request(c,path,body=None,method=None,status=200):
 data=None if body is None else json.dumps(body).encode();r=urllib.request.Request(a.url+'/api'+path,data=data,method=method or ('POST' if body is not None else 'GET'),headers={'Content-Type':'application/json'})
 try:
  with c.open(r,timeout=30) as response:actual=response.status;raw=response.read()
 except urllib.error.HTTPError as e:actual=e.code;raw=e.read()
 assert actual==status,f'{method or ("POST" if body is not None else "GET")} {path}: expected{status} got{actual}'
 return json.loads(raw) if raw else {}
def key():return str(uuid.uuid4())
try:
 admin=client();session=request(admin,'/auth/login',{'email':'founder@schach.demo','password':'SchachDemo!2026'})
 # Login response/session shape is the authoritative API, never guessed IDs.
 session=request(admin,'/auth/session');company=session['companies'][0]['id'];actor=session['user']['id'];base='/companies/'+company
 w=request(admin,base+'/workspace');assert w['me']['memberAccessEpoch']>0 and w['me']['membershipVersion']>0 and w['company']['companyPermissionEpoch']>0
 checks.append('Actual bootstrap publishes positive membership/access/company epochs; no account session epoch')
 assert 'sessionEpoch' not in json.dumps(w)
 context=request(admin,base+'/people/context');reviewer=next(x for x in context['people'] if x['id']!=actor and x['active'] and x['role']!='viewer')
 preset=request(admin,base+'/people/presets',{'retryKey':key(),'name':'Fictional runtime starter','description':'Reviewed local fixture','membership':{'role':'member','departmentId':'','managerId':'','title':'Fictional colleague','capacityHours':32},'templateIds':[]})
 preset=request(admin,base+'/people/presets/'+preset['id'])
 checklist=['Read the complete starting handbook','Confirm the independent review requirements']
 template=request(admin,base+'/task-templates',{'retryKey':key(),'kind':'task','name':'Fictional checklist starting template','scopeOwnerId':actor,'defaults':{'title':'Reviewed runtime starting task','description':'Complete the reviewed starting work','ownerPolicy':'actor','reviewerId':reviewer['id'],'requiresApproval':True,'status':'todo','priority':'high','estimatedHours':2.5,'relativeDueDays':3,'tags':['starting','reviewed'],'checklist':checklist}})
 starting={'templateId':template['id'],'expectedTemplateVersion':1,'anchorDate':'2026-10-11','fields':{'startDate':'2026-10-11'}}
 before=request(admin,base+'/workspace');before_people=len(before['people']);before_tasks=len(before['tasks'])
 email='m9-'+suffix+'@example.invalid';preview=request(admin,base+'/people/onboarding/preview',{'retryKey':key(),'name':'Fictional Runtime Person','email':email,'presetId':preset['id'],'expectedPresetVersion':preset['version'],'membership':preset['membership'],'tasks':[starting]})
 assert preview['accountMode']=='new_account' and preview['sessionEffect']['reauthenticate'] and len(preview['grants'])==4
 after_preview=request(admin,base+'/workspace');assert len(after_preview['people'])==before_people and len(after_preview['tasks'])==before_tasks
 task_preview=preview['taskPreviews'][0];assert task_preview['checklist']==checklist and 'checklist' not in task_preview['fields'];assert task_preview['fields']['dueDate']=='2026-10-14' and task_preview['fields']['reviewerId']==reviewer['id'] and task_preview['fields']['requiresApproval']
 (a.output.parent/(a.output.stem+'-onboarding-preview.json')).write_text(json.dumps(preview,indent=2)+'\n')
 checks.append('Real onboarding preview discloses full ordered checklist text without checklist IDs/state or user/task creation')
 password='FictionalLocal-'+uuid.uuid4().hex;body={'retryKey':key(),'previewId':preview['id'],'expectedPreviewVersion':preview['version'],'password':password};joined=request(admin,base+'/people/onboarding/apply',body);assert request(admin,base+'/people/onboarding/apply',body)==joined
 created=request(admin,base+'/tasks/'+joined['taskIds'][0]);created=created.get('task',created);assert [x['text'] for x in created['checklist']]==checklist and len({x['id'] for x in created['checklist']})==2 and all(x['id'] and not x['done'] for x in created['checklist']);assert created['dueDate']==created['originalDueDate']=='2026-10-14' and created['startDate']=='2026-10-11' and created['reviewerId']==reviewer['id'] and created['requiresApproval']
 after_apply=request(admin,base+'/workspace');assert len(after_apply['people'])==before_people+1 and len(after_apply['tasks'])==before_tasks+1
 checks.append('Real apply and canonical replay create exactly one task with fresh unchecked ordered checklist and original dates/independent reviewer')
 changed=dict(body,password='FictionalDifferent-'+uuid.uuid4().hex);request(admin,base+'/people/onboarding/apply',changed,status=409)
 assert password not in json.dumps([preview,joined]);uid=joined['userId'];checks.append('Preset/current preview/new-account apply and same-key canonical replay; changed credential conflicts without echoed password')
 person=client();request(person,'/auth/login',{'email':email,'password':password});request(admin,base+'/people/'+uid,{'role':'manager','expectedVersion':1},'PATCH');request(person,'/auth/session',status=401)
 request(person,'/auth/login',{'email':email,'password':password});checks.append('Real target session is rejected after consequential membership change and fresh login succeeds')
 task=request(admin,base+'/tasks',{'title':'Fictional responsibility '+suffix,'ownerId':uid,'priority':'medium','status':'todo','dueDate':'2026-12-01'})
 context=request(admin,base+'/people/context');ds=[{'userId':x['id'],'expectedMembershipVersion':x['membershipVersion'],'action':'departure_required' if x['id']==uid else 'keep'} for x in context['people']]
 review=request(admin,base+'/people/access-reviews/preview',{'retryKey':key(),'reason':'Fictional complete access attestation','decisions':ds});completed=request(admin,base+'/people/access-reviews/'+review['id']+'/complete',{'retryKey':key(),'previewId':review['previewId'],'expectedReviewVersion':review['version']});assert next(x for x in completed['decisions'] if x['userId']==uid)['handoverStatus']=='pending';assert not completed['sessionEffect']['reauthenticate']
 checks.append('Complete access review records pending departure independently, without changing membership/session')
 inspected=request(admin,base+'/people/'+uid+'/departure/preview',{'retryKey':key(),'reason':'Fictional reviewed departure','replacements':[]});assert not inspected['readyToApply'];assert len(inspected['liveItems'])==1
 replacement={'kind':'task_owner','sourceId':task['id'],'expectedVersion':1,'action':'transfer','newUserId':actor};planned=request(admin,base+'/people/'+uid+'/departure/preview',{'retryKey':key(),'reason':'Fictional reviewed departure','replacements':[replacement]});assert planned['readyToApply'];apply={'retryKey':key(),'previewId':planned['id'],'expectedPreviewVersion':1,'confirmCompanyDeparture':True};departed=request(admin,base+'/people/'+uid+'/departure/apply',apply);request(person,'/auth/session',status=401)
 taskAfter=request(admin,base+'/tasks/'+task['id']);taskAfter=taskAfter.get('task',taskAfter);assert taskAfter['ownerId']==actor and taskAfter['version']==2 and taskAfter['dueDate']=='2026-12-01' and taskAfter['status']=='todo'
 request(admin,base+'/people/'+uid,{'active':True},'PATCH');assert request(admin,base+'/people/'+uid+'/departure/apply',apply)['id']==departed['id'];assert next(x for x in request(admin,base+'/people/context')['people'] if x['id']==uid)['active']
 checks.append('Guided complete handover preserves original work and revokes sessions; old canonical departure after rejoin does not reapply')
 result.update(status='passed',companyId=company,actorId=actor,targetId=uid,presetId=preset['id'],taskId=task['id'],reviewId=review['id'],departureId=departed['id'],runtimeURL=a.url)
finally:
 a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':result['status'],'checks':checks}))
