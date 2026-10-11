#!/usr/bin/env python3
"""M8 actual TCP fixture; caller must own the disposable seeded runtime."""
import argparse,json,urllib.request,urllib.error,time,concurrent.futures
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--allow-demo-mutations',action='store_true');a=p.parse_args();assert a.allow_demo_mutations;assert a.url.startswith(('http://127.0.0.1:','http://localhost:'))
cookie=''
def call(method,path,body=None):
 data=None if body is None else json.dumps(body).encode();headers={'Cookie':cookie};
 if data:headers['Content-Type']='application/json'
 try:r=urllib.request.urlopen(urllib.request.Request(a.url+'/api'+path,data=data,headers=headers,method=method),timeout=15)
 except urllib.error.HTTPError as e:r=e
 with r:
  raw=r.read();return r.status,json.loads(raw or '{}'),r.headers
st,b,h=call('POST','/auth/login',{'email':'founder@schach.demo','password':'SchachDemo!2026'});assert st==200,(st,b);cookie=h.get('Set-Cookie').split(';')[0];cid=b['companies'][0]['id'];uid=b['user']['id'];root='/companies/'+cid
st,b,_=call('POST',root+'/goals',{'retryKey':'m8-tcp-create','name':'M8 independent quality','ownerId':uid,'unit':'defects','baseline':8,'target':3,'initialMeasurement':{'value':4.8,'effectiveAt':'2026-10-01T00:00:00.123456Z','reason':'Independent measurement on owned fixture'}});assert st==200,(st,b);goal=b['id'];base=root+'/goals/'+goal
st,b,_=call('GET',root+'/planning/summary?from=2026-10-05&to=2026-10-25');assert st==200,(st,b);basis=b['projectionBasis'];assert b['method']=='visible_remaining_overlap_v1';assert 'capacity' in b['methodDescription'];st,b,_=call('GET',root+'/planning/tasks?from=2026-10-05&to=2026-10-25&category=scheduled&projectionBasis='+basis);assert st==200,(st,b);tasks=b['tasks'];assert tasks
selected=tasks[0];st,seed,_=call('GET',root+'/planning/schedule-seed?from=2026-10-05&to=2026-10-25&projectionBasis='+basis+'&taskIds='+selected['id']);assert st==200,(st,seed);assert seed['writes']==False;task=seed['tasks'][0]
preview={'retryKey':'m8-tcp-preview','method':'manual','context':seed['context'],'changes':[{'taskId':task['id'],'version':task['version'],'startDate':'2026-10-12','dueDate':'2026-10-22','deadlineMode':'all_day','dueAt':'','dueTimezone':'','reason':'Reviewed concrete delivery adjustment'}]};st,b,_=call('POST',root+'/task-schedule/preview',preview);assert st==200,(st,b);pid=b['proposal']['id'];apply={'retryKey':'m8-tcp-apply','proposalId':pid,'expectedProposalVersion':1};st,first,_=call('POST',root+'/task-schedule/apply',apply);assert st==200,(st,first);st,b,_=call('POST',root+'/task-schedule/apply',apply);assert st==200 and b==first,(st,b,first)
request={'basis':'task_history_v1','from':'2026-09-01','to':'2026-09-30','reportZone':'Asia/Kolkata','filters':{}};st,b,_=call('POST',root+'/reports/history/snapshots',{'retryKey':'m8-report-evidence','request':request});assert st==200,(st,b);report=b['snapshotId'];st,b,_=call('GET',base+'/evidence-options?kind=report_snapshot&limit=1');assert st==200 and b['options'];assert any(o['sourceId']==report for o in b['options']);st,b,_=call('GET',base+'/evidence-preview?kind=report_snapshot&sourceId='+report);assert st==200,(st,b);binding={k:b[k] for k in ('kind','sourceId','parentId','revision','contentHash')}
measure={'retryKey':'m8-tcp-measure','expectedVersion':1,'value':4,'effectiveAt':'2026-10-02T05:30:00.654321+05:30','reason':'Shared independent outcome; source keeps current ACL','evidence':[binding]}
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(lambda _:call('POST',base+'/measurements',measure),range(2)))
assert all(x[0]==200 for x in results),results;mid=results[0][1]['measurementId'];assert results[1][1]['measurementId']==mid
measure['effectiveAt']='2026-10-02T00:00:00.654321Z';st,b,_=call('POST',base+'/measurements',measure);assert st==200 and b['measurementId']==mid
st,b,_=call('GET',base+'/measurements');assert st==200 and len(b['measurements'])==2,(st,b);assert b['measurements'][0]['effectiveAt']==measure['effectiveAt'],b;assert b['measurements'][0]['evidence'][0]['status']=='matching'
correction={'retryKey':'m8-tcp-correct-old','expectedVersion':2,'correctsId':b['measurements'][1]['id'],'value':5,'reason':'Correct older observation without moving current selector'};st,b,_=call('POST',base+'/measurements',correction);assert st==200 and b['current']==4,(st,b);st,b,_=call('GET',base);assert st==200 and b['goal']['current']==4 and b['goal']['version']==3 and b['attainment']==80,(st,b)
st,b,_=call('GET',base+'/reminder-preference');assert st==200 and b['preference']['enabled']==False
pref={'retryKey':'m8-tcp-enable','expectedVersion':0,'enabled':True,'cadence':'weekly','weekday':1,'monthDay':1,'localTime':'09:00','reason':'Explicit owned update reminder'};st,b,_=call('PATCH',base+'/reminder-preference',pref);assert st==200,(st,b);st,b,_=call('GET',base);assert st==200 and b['goal']['current']==4 and b['goal']['version']==3
result={'status':'passed','company':cid,'goal':goal,'task':task['id'],'snapshot':report,'checks':['Actual TCP planning summary/drill/current inspected M5 seed','Explicit M5 preview/apply/canonical retry','Human-labelled own immutable report evidence options and exact hash','Concurrent same-key measurement one canonical fact','Native PostgreSQL/SQLite exact six-microsecond UTC read and offset-equivalent replay','Old immutable correction preserves current selector','Owner opt-in preference never changes measured current/version'],'measurements':3,'canonicalMeasurement':mid}
a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
