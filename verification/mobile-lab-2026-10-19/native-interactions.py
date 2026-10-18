"""Native keyboard/back/font-scale and current-company checks on the owned emulator."""
import importlib.util,pathlib,json,sys,time,datetime as dt,urllib.request,http.cookiejar
from native_results import run_case, finalize
assert '--allow-demo-mutations' in sys.argv
spec=importlib.util.spec_from_file_location('controls',pathlib.Path(__file__).with_name('native-controls.py'));c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
f=json.loads(pathlib.Path(__file__).with_name('native-fixture.json').read_text());result={'qualification':'Actual current Expo Go57 on owned Android36 emulator, fictional9092 API. Not iOS, physical hardware or native call/push qualification.','cases':[]}
def run(name,fn):
 if '--only' in sys.argv and name!=sys.argv[sys.argv.index('--only')+1]:return
 def cleanup():
  if c.find('Close') is not None:c.tap('Close')
 r=run_case(result['cases'],{'name':name},fn,lambda failed:c.screenshot('android-'+name+('-failure' if failed else '')),cleanup)
 print(name,r['status'],r.get('error',''),flush=True)
def ime():
 text=c.cmd('shell','dumpsys','input_method');assert 'mInputShown=true' in text or 'isInputViewShown=true' in text,'Native keyboard not shown'
def scrollto(label):
 for n in range(7):
  found=c.find(label)
  if found is not None:return found
  c.cmd('shell','input','swipe','540','1850','540','650','250');time.sleep(.2)
 raise AssertionError('Control unreachable by native scrolling: '+label)
def task_back():
 c.openroute('work');c.wait('Search work');c.fill('Search work','Mobile lab timed commitment');c.back();c.tap('Open: Mobile lab timed commitment');c.wait('Mobile lab timed commitment',exact=False);c.back();c.wait('Search work');assert c.find('Search work',field=True).attrib.get('text')=='Mobile lab timed commitment'
def task_keyboard():
 c.openroute('work');c.wait('New task');c.tap('New task');scrollto('Task title');c.fill('Task title','Fictional unsaved keyboard check');ime();c.screenshot('android-task-keyboard-visible');c.back();c.tap('Close');c.wait('New task')
def chat_send():
 c.openroute('chat/'+f['conversation']);c.wait('Fictional mobile lab handover message',exact=False);message='Fictional native Android message '+str(int(time.time()));c.fill('Message',message);ime();c.screenshot('android-chat-keyboard-visible');c.tap('Send');time.sleep(.8)
 newest=next((n for n in c.dump()[0].iter('node') if c.text(n).endswith(' new messages')),None)
 if newest is not None:c.tapnode(newest)
 c.wait(message,exact=False)
 field=c.find('Message',field=True);assert field is not None and field.attrib.get('text') in ('','Write a message…'),'Composer was not cleared after ACK';c.back()
 jar=http.cookiejar.CookieJar();api=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
 with api.open(urllib.request.Request('http://127.0.0.1:9092/api/auth/login',data=json.dumps({'email':'founder@schach.demo','password':'SchachDemo!2026'}).encode(),headers={'Content-Type':'application/json'})) as r:json.load(r)
 with api.open('http://127.0.0.1:9092/api/companies/'+f['company']+'/conversations/'+f['conversation']+'/messages') as r:messages=json.load(r)['messages']
 assert sum(m['body']==message for m in messages)==1,'Expected one authorized persisted message'
def growth_form():
 c.openroute('more');c.wait('Search modules');c.fill('Search modules','Development');c.back();c.tap('Development');c.wait('New development plan');c.tap('New development plan');scrollto('Plan title');c.fill('Plan title','Fictional unsaved development');ime();c.screenshot('android-growth-keyboard-visible');c.back();button=scrollto('Save development plan');assert button.attrib.get('enabled')=='false','Unreviewed growth submission enabled';c.tap('Close');c.wait('Development')
def knowledge_form():
 c.openroute('knowledge');c.wait('New guidance');c.tap('New guidance');c.wait('Guidance title');c.fill('Guidance title','Fictional unsaved guidance');ime();c.screenshot('android-knowledge-keyboard-visible');c.back();button=scrollto('Save guidance draft');assert button.attrib.get('enabled')=='false','Unreviewed guidance save enabled';c.tap('Close');c.wait('Knowledge')
def more_route():
 c.openroute('more');c.wait('Search modules');c.fill('Search modules','Workload');c.back();c.tap('Workload');c.wait('Authorized work in this view.',exact=False);c.back();c.wait('Search modules');assert c.find('Search modules',field=True).attrib.get('text')=='Workload'
def company_switch():
 c.openroute('chats');c.wait('Filter conversations');c.tap('Meridian Works')
 try:
  c.wait('✓ Meridian Works');c.wait('Filter conversations');c.openroute('chat/'+f['conversation']+'?company='+f['company']);c.wait('Filter conversations');time.sleep(.6)
  c.wait('✓ Meridian Works');assert c.find('Message',field=True) is None,'Old-company private composer remained available'
  assert not any('Fictional mobile lab handover message' in text for text in c.labels());c.screenshot('android-cross-company-private-route-denied')
 finally:
  c.tap('Schach Engineers');c.wait('✓ Schach Engineers');c.wait('Filter conversations')
def guidance_detail():
 c.openroute('knowledge');c.wait('Mobile lab handover guidance',exact=False);c.tap('Open guidance Mobile lab handover guidance');c.wait('Handover requires inspecting the pressure gauge',exact=False)
try:
 run('task-navigation-back',task_back);run('task-keyboard',task_keyboard);run('private-message-keyboard-send',chat_send);run('growth-form-disclosure',growth_form);run('knowledge-form-disclosure',knowledge_form);run('more-search-navigation-back',more_route)
 if '--only' not in sys.argv or sys.argv[sys.argv.index('--only')+1].startswith('large-font-'):
  original=c.cmd('shell','settings','get','system','font_scale').strip()
  try:
   c.cmd('shell','settings','put','system','font_scale','1.6');time.sleep(.8)
   for route,expected in [('work','Search work'),('workload','Authorized work in this view.'),('more','Explore your workspace'),('chat/'+f['conversation'],'Fictional mobile lab handover message')]:
    def check(route=route,expected=expected):
     c.openroute(route)
     if route=='work':c.tap('Work')
     c.wait(expected,exact=False)
    run('large-font-'+route.split('/')[0],check)
  finally:c.cmd('shell','settings','put','system','font_scale',original if original not in ('null','') else '1.0')
 run('company-qualified-private-route',company_switch)
except Exception as e:result['fatalError']=str(e)
finally:
 if '--only' in sys.argv:
  if not result['cases']:result['fatalError']='The requested case filter matched no cases'
  previous=json.loads(pathlib.Path(__file__).with_name('native-interaction-result.json').read_text())
  for current in result['cases']:
   old=next((r for r in previous['cases'] if r['name']==current['name']),None)
   if old is not None:current['priorAttempt']=old
  result['cases']=[r for r in previous['cases'] if r['name'] not in {n['name'] for n in result['cases']}]+result['cases']
 finalize(result,['task-navigation-back','task-keyboard','private-message-keyboard-send','growth-form-disclosure','knowledge-form-disclosure','more-search-navigation-back','large-font-work','large-font-workload','large-font-more','large-font-chat','company-qualified-private-route'])
 pathlib.Path(__file__).with_name('native-interaction-result.json').write_text(json.dumps(result,indent=2)+'\n');print(result['summary'],flush=True)
 if result['status']!='PASS':sys.exit(1)
