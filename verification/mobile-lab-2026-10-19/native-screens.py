"""Exercise current real native screens on only the newly owned fictional emulator."""
import importlib.util,json,pathlib,time,traceback,sys
from native_results import run_case, finalize
assert '--allow-demo-mutations' in sys.argv
spec=importlib.util.spec_from_file_location('controls',pathlib.Path(__file__).with_name('native-controls.py'));c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
f=json.loads(pathlib.Path(__file__).with_name('native-fixture.json').read_text());result={'qualification':'Actual Android API36 x86_64 emulator running current Expo Go57 app against a new fictional9092 API. Not physical Android or native iOS; calls/push unavailable in Expo Go.','cases':[]}
assert 'workspace-qa-api36-20261019' in c.cmd('emu','avd','name')
try:
 for route,title in [('work','Your commitments and authorized team work'),('more','Explore your workspace'),('overview','Read-only · current role and company scope'),('projects','Projects'),('calendar','Deadline agenda'),('workload','Authorized work in this view.'),('planning','Planning authorized work'),('goals','Measured outcomes'),('finance','Finance'),('reports','Reports'),('people','People'),('growth','Development'),('knowledge','Knowledge'),('account','Account'),('requests','Published work and intake'),('calls','Expo Go'),('task/'+f['task']+'?company='+f['company'],'Mobile lab timed commitment'),('project/'+f['project']+'?company='+f['company'],'Mobile lab project'),('chat/'+f['conversation']+'?company='+f['company'],'Fictional mobile lab handover message')]:
  if '--only' in sys.argv and route.split('/')[0]!=sys.argv[sys.argv.index('--only')+1]:continue
  def check():
   c.openroute(route);c.wait(title,exact=False,timeout=45)
   return {'labels':c.labels()}
  r=run_case(result['cases'],{'route':route,'expected':title},check,lambda failed:c.screenshot('android-'+route.split('/')[0]+('-failure' if failed else '')))
  print(route,r['status'],r.get('error',''),flush=True)
except Exception as e:result['fatalError']=str(e)
finally:
 if '--only' in sys.argv:
  if not result['cases']:result['fatalError']='The requested route filter matched no cases'
  previous=json.loads(pathlib.Path(__file__).with_name('native-result.json').read_text())
  for current in result['cases']:
   old=next((r for r in previous['cases'] if r['route']==current['route']),None)
   if old is not None:current['priorAttempt']={k:v for k,v in old.items() if k!='labels'}
  result['cases']=[r for r in previous['cases'] if r['route'] not in {n['route'] for n in result['cases']}]+result['cases']
 finalize(result,['work','more','overview','projects','calendar','workload','planning','goals','finance','reports','people','growth','knowledge','account','requests','calls','task/'+f['task']+'?company='+f['company'],'project/'+f['project']+'?company='+f['company'],'chat/'+f['conversation']+'?company='+f['company']],identity='route')
 pathlib.Path(__file__).with_name('native-result.json').write_text(json.dumps(result,indent=2)+'\n');print(result['summary'],flush=True)
 if result['status']!='PASS':sys.exit(1)
