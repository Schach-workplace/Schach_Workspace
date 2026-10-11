#!/usr/bin/env python3
"""Actual owned-fictional finance gateway fixture/probe; no provider provisioning."""
import argparse,hashlib,json,secrets,time,urllib.request,urllib.error,urllib.parse
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--url',required=True);p.add_argument('--output',type=Path,required=True)
p.add_argument('--provider-expected',action='store_true');p.add_argument('--allow-demo-mutations',action='store_true')
a=p.parse_args();assert a.allow_demo_mutations and urllib.parse.urlsplit(a.url).hostname in ('localhost','127.0.0.1','::1')
a.output.mkdir(parents=True,exist_ok=True);cookie='';checks=[];samples=[]
def call(method,path,body=None,raw=None,expected=200):
 headers={'Cookie':cookie};data=raw
 if body is not None:data=json.dumps(body).encode();headers['Content-Type']='application/json'
 elif raw is not None:headers['Content-Type']='application/octet-stream'
 started=time.perf_counter()
 try:r=urllib.request.urlopen(urllib.request.Request(a.url+'/api'+path,data=data,headers=headers,method=method),timeout=15)
 except urllib.error.HTTPError as e:r=e
 with r:payload=r.read();status=r.status;h=r.headers
 samples.append({'operation':method+' '+path.split('/finance/')[-1].split('/')[0],'milliseconds':round((time.perf_counter()-started)*1000,3),'bytes':len(payload)})
 assert status==expected,(method,path,status,payload.decode()[:250]);return json.loads(payload) if payload else {},h
def poll(path,key,want):
 for _ in range(100):
  value,_=call('GET',path)
  if value.get(key)==want:return value
  time.sleep(.2)
 raise RuntimeError('Owned real worker did not reach '+want)
result={'status':'failed','checks':checks,'samples':samples,'providerExpected':a.provider_expected}
try:
 session,h=call('POST','/auth/login',{'email':'founder@schach.demo','password':'SchachDemo!2026'});cookie=h['Set-Cookie'].split(';')[0]
 cid=session['companies'][0]['id'];root='/companies/'+cid
 workspace,_=call('GET',root+'/workspace');department=workspace['departments'][0]['id'];category=next(c['id'] for c in workspace['expenseCategories'] if c['active'])
 suffix=secrets.token_hex(4)
 # A real capture reservation contains no fabricated file identity or bytes.
 capture={'retryKey':'tcp-capture-'+suffix,'purpose':'receipt','capture':True,'destinationDepartmentId':department}
 intake,_=call('POST',root+'/finance/intakes',capture);again,_=call('POST',root+'/finance/intakes',capture);assert intake['id']==again['id'] and intake['state']=='capture_reserved' and intake['size']==0
 ip=root+'/finance/intakes/'+intake['id'];call('POST',ip+'/upload',raw=b'no unbound storage',expected=409)
 fictional=b'\x89PNG\r\n\x1a\nfictional bound gateway bytes'
 bind={'retryKey':'tcp-bind-'+suffix,'expectedVersion':intake['version'],'fileName':'fictional.png','size':len(fictional),'sha256':hashlib.sha256(fictional).hexdigest()}
 bound,_=call('POST',ip+'/bind-content',bind);replay,_=call('POST',ip+'/bind-content',bind);assert bound['version']==replay['version'] and bound['expiresAt']==intake['expiresAt'],(bound['version'],replay['version'],intake['expiresAt'],bound['expiresAt'])
 call('POST',ip+'/upload',raw=fictional);uploaded,_=call('GET',ip)
 call('POST',ip+'/cancel',{'retryKey':'tcp-cancel-'+suffix,'expectedVersion':uploaded['version']});call('GET',ip,expected=404)
 checks.append('Actual TCP receipt capture reservation, unbound denial, immutable keyed binding/staging, cancellation and private-source denial')
 result.update(company=cid,department=department,category=category,captureIntake=intake['id'])
 if not a.provider_expected:
  result.update(status='passed',capability='Exported default: OCR disabled; no host Tesseract or scanner capability claimed')
 else:
  source=Path('/tmp/schach-improvements-ai-fixtures/receipt.png');data=source.read_bytes();sha=hashlib.sha256(data).hexdigest();assert sha=='b03b6de24de6a5fd63ddf84b7a41c998776057ddbe7c368bae6edc1f24254589'
  def stage(data,purpose,name):
   body={'retryKey':'tcp-'+purpose+'-'+secrets.token_hex(4),'purpose':purpose,'fileName':name,'size':len(data),'sha256':hashlib.sha256(data).hexdigest()}
   if purpose=='receipt':body['destinationDepartmentId']=department
   i,_=call('POST',root+'/finance/intakes',body);path=root+'/finance/intakes/'+i['id'];call('POST',path+'/upload',raw=data);u,_=call('GET',path)
   before=time.perf_counter();call('POST',path+'/finalize',{'retryKey':'finalize-'+i['id'],'expectedVersion':u['version']});clean=poll(path,'state','clean');return clean,round((time.perf_counter()-before)*1000,3)
  # Standard fictional antivirus test string, confined to this owned intake.
  rejected_bytes=b'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
  rejected,_=call('POST',root+'/finance/intakes',{'retryKey':'reject-'+suffix,'purpose':'statement','fileName':'fictional-rejected.csv','size':len(rejected_bytes),'sha256':hashlib.sha256(rejected_bytes).hexdigest()})
  rejected_path=root+'/finance/intakes/'+rejected['id'];call('POST',rejected_path+'/upload',raw=rejected_bytes)
  uploaded,_=call('GET',rejected_path);call('POST',rejected_path+'/finalize',{'retryKey':'reject-scan-'+suffix,'expectedVersion':uploaded['version']})
  for _ in range(100):
   verdict,_=call('GET',rejected_path)
   if verdict.get('assessment',{}).get('status')=='rejected':break
   time.sleep(.2)
  else:raise RuntimeError('Actual rejected scanner verdict not observable')
  assert verdict['assessment']['retryable'] is False and verdict['state']=='scanning'
  call('GET',rejected_path+'/download',expected=404)
  call('POST',rejected_path+'/finalize',{'retryKey':'reject-no-retry-'+suffix,'expectedVersion':verdict['version'],'retryAssessment':True},expected=422)
  call('POST',root+'/finance/receipt-extractions',{'retryKey':'reject-no-provider-'+suffix,'optIn':True,'source':{'kind':'intake','id':rejected['id'],'expectedVersion':verdict['version']},'destinationDepartmentId':department},expected=422)
  call('POST',rejected_path+'/upload',raw=rejected_bytes,expected=409)
  result['rejectedIntake']=rejected['id'];checks.append('Actual ClamAV rejection is visible on authorized intake GET; retry/provider/download remain quarantined')
  clean,scan_ms=stage(data,'receipt','fictional-receipt.png')
  before=time.perf_counter();job,_=call('POST',root+'/finance/receipt-extractions',{'retryKey':'extract-'+suffix,'optIn':True,'source':{'kind':'intake','id':clean['id'],'expectedVersion':clean['version']},'destinationDepartmentId':department})
  jp=root+'/finance/receipt-extractions/'+job['id']
  for _ in range(100):
   extraction,_=call('GET',jp)
   if extraction.get('result'):break
   assert extraction['job']['status'] not in ('failed','cancelled'),extraction['job'];time.sleep(.2)
  else:raise RuntimeError('Actual extraction queue did not complete')
  fields=extraction['result']['candidates']['fields']
  for key,want in {'vendor':'Demo Stationery','invoiceNumber':'TEST-2026-001','amountText':'1300.50','expenseDate':'2026-10-10'}.items():assert want in fields[key],(key,fields)
  checks.append('Actual TCP private stage→ClamAV clean→durable extraction queue→Tesseract receipt candidate result')
  extraction_ms=round((time.perf_counter()-before)*1000,3)
  duplicate_fields={'departmentId':department,'categoryId':category,'title':'Fictional separate purchases','vendor':'Fictional independent supplier','invoiceNumber':'','expenseDate':'2026-10-10','amountMinor':23500}
  duplicate_ids=[]
  for n in range(2):
   created,_=call('POST',root+'/expenses',{**duplicate_fields,'retryKey':f'fictional-pair-{suffix}-{n}'});duplicate_ids.append(created['id'])
  result['duplicateSource']=duplicate_ids[0]
  paid=next((e for e in workspace['expenses'] if e['status']=='paid'),None)
  amount=paid['amountMinor'] if paid else 130050;date=paid['paidDate'] if paid else '2026-10-10';reference=paid['paymentReference'] if paid else 'FICTIONAL'
  csv=('Date,Amount,Reference,Description\n'+f'{date},-{amount//100}.{amount%100:02d},{reference},Full recorded payment\n'+f'{date},-1300.50,SAME,Occurrence A\n{date},-1300.50,SAME,Occurrence A\n{date},5.00,CREDIT,Fictional credit\n').encode();(a.output/'fictional-bank.csv').write_bytes(csv)
  statement,_=stage(csv,'statement','fictional-bank.csv')
  result.update(status='passed',receiptIntake=clean['id'],job=job['id'],statementIntake=statement['id'],paidExpense=paid['id'] if paid else '',fixtureSHA256=sha,fixtureBytes=len(data),scanQueueMilliseconds=scan_ms,extractionQueueMilliseconds=extraction_ms,engine=extraction['result']['engine'],engineVersion=extraction['result']['engineVersion'],language=extraction['result']['language'],currency=workspace['company']['currency'])
finally:
 (a.output/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':result['status'],'checks':len(checks),'providerExpected':a.provider_expected}))
