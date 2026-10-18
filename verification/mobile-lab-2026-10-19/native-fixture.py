"""Seed only the newly owned fictional9092 lab, never production/retained8080."""
import urllib.request,urllib.error,http.cookiejar,json,datetime as dt,uuid,pathlib,sys
from zoneinfo import ZoneInfo
assert '--allow-demo-mutations' in sys.argv
base='http://127.0.0.1:9092';jar=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def api(path,method='GET',body=None):
 req=urllib.request.Request(base+'/api'+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json'},method=method)
 try:
  with client.open(req,timeout=30) as r:return json.load(r)
 except urllib.error.HTTPError as e:raise RuntimeError(method+' '+path+' '+str(e.code)+' '+e.read().decode()) from e
session=api('/auth/login','POST',{'email':'founder@schach.demo','password':'SchachDemo!2026'});cid=session['companies'][0]['id'];root='/companies/'+cid;work=api(root+'/workspace');reviewer=next(p for p in work['people'] if p['email']=='ceo@schach.demo');uid=session['user']['id']
project=api(root+'/projects','POST',{'name':'Mobile lab project','ownerId':uid,'departmentId':'','description':'Fictional emulator acceptance only','color':'#F97316','status':'active','dueDate':''})
due=dt.datetime.now(ZoneInfo('Asia/Kolkata')).replace(microsecond=0)+dt.timedelta(days=3)
task=api(root+'/tasks','POST',{'title':'Mobile lab timed commitment','description':'Inspect the original deadline and independent review controls.','ownerId':uid,'reviewerId':reviewer['id'],'departmentId':'','projectId':project['id'],'parentId':'','priority':'medium','status':'todo','dueDate':due.date().isoformat(),'deadlineMode':'timed','dueAt':due.isoformat(),'dueTimezone':'Asia/Kolkata','startDate':'','estimatedHours':3,'tags':[],'checklist':[],'dependencies':[],'collaborators':[],'recurrence':'none','requiresApproval':True})
conv=api(root+'/conversations','POST',{'kind':'dm','participantIds':[uid,reviewer['id']]})
api(root+'/conversations/'+conv['id']+'/messages','POST',{'clientMessageId':str(uuid.uuid4()),'body':'Fictional mobile lab handover message'})
plans=[]
for p in api(root+'/growth/catalog')['pilots']:
 plans.append(api(root+'/growth/plans','POST',{'retryKey':str(uuid.uuid4()),'pilot':p['id'],'title':'Mobile lab '+p['id']+' growth','careerRole':p['careerRoles'][0],'careerLevel':p['levels'][0],'competencyIds':[p['competencies'][0]['id']],'objective':'Practice a clear handover','learningActions':['Read reviewed guidance','Discuss practice with mentor'],'evidenceNote':'Fictional reflection for emulator tests','mentorId':reviewer['id']}))
article=api(root+'/knowledge','POST',{'retryKey':str(uuid.uuid4()),'title':'Mobile lab handover guidance','body':'Handover requires inspecting the pressure gauge and recording observations.','pilot':'field','reviewerId':reviewer['id'],'audience':'company','readerIds':[],'reviewDueDate':'2099-01-01'})
api('/auth/logout','POST',{});api('/auth/login','POST',{'email':'ceo@schach.demo','password':'SchachDemo!2026'})
api(root+'/knowledge/'+article['id']+'/review','POST',{'retryKey':str(uuid.uuid4()),'expectedVersion':1,'decision':'publish','reason':'Independently checked fictional handover instructions.'})
result={'qualification':'New disposable fictional API only; no credentials/cookies retained','company':cid,'project':project['id'],'task':task['id'],'conversation':conv['id'],'plans':[p['id'] for p in plans],'article':article['id']}
out=pathlib.Path(__file__).with_name('native-fixture.json');out.write_text(json.dumps(result,indent=2)+'\n');print('Fictional native fixture ready')
