// Actual rendered report acceptance on owned disposable fictional loopback data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const base=process.env.SCHACH_SMOKE_URL||'http://127.0.0.1:8083';
assert(process.argv.includes('--allow-demo-mutations'),'Explicit --allow-demo-mutations required');
assert(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname));
const output=process.env.SCHACH_SMOKE_RESULT;assert(output,'Set SCHACH_SMOKE_RESULT');
const fixture=JSON.parse(await readFile(process.env.SCHACH_FINANCE_FIXTURE,'utf8'));assert.equal(fixture.status,'passed');
const profile=await mkdtemp(join(tmpdir(),'schach-report-browser-'));
const browser=spawn('chromium',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
let endpoint='',socket,run;browser.stderr.on('data',b=>{const m=String(b).match(/DevTools listening on (ws:\/\/\S+)/);if(m)endpoint=m[1]});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn){const end=Date.now()+20000;while(Date.now()<end){if(await fn())return;await delay(100)}throw Error('Rendered report check timed out')}
const result={status:'failed',checks:[],uiButtonActions:0};const errors=[];
try{
 await wait(()=>endpoint);const targets=await(await fetch(`http://127.0.0.1:${new URL(endpoint).port}/json/list`)).json();socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j});
 let next=0;const pending=new Map();socket.onmessage=({data})=>{const v=JSON.parse(data);if(v.id){const p=pending.get(v.id);pending.delete(v.id);v.error?p.reject(Error(v.error.message)):p.resolve(v.result)}if(v.method==='Runtime.exceptionThrown')errors.push(v.params.exceptionDetails.text)};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))});
 run=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
 const click=async title=>{result.uiButtonActions++;await wait(()=>run(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(title)}&&!b.disabled);if(!b)return false;b.click();return true})()`))};
 await call('Runtime.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await call('Page.navigate',{url:base});
 await wait(()=>run('!!document.querySelector("input[type=password]")'));
 await run(`(()=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [selector,value] of [['input[type=email]','founder@schach.demo'],['input[type=password]','SchachDemo!2026']]){const el=document.querySelector(selector);set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))}document.querySelector('form').requestSubmit()})()`);
 await wait(()=>run('!document.querySelector("input[type=password]")&&document.body.innerText.includes("Reports")'));
 result.checks.push('Sign-in succeeds against the current API build');

 const set=async(label,value,tag='input')=>run(`(()=>{const label=Array.from(document.querySelectorAll('label')).find(l=>l.textContent.trim().startsWith(${JSON.stringify(label)}));if(!label)throw Error('Missing label '+${JSON.stringify(label)});const el=label.querySelector(${JSON.stringify(tag)});Object.getOwnPropertyDescriptor(${tag==='select'?'HTMLSelectElement':'HTMLInputElement'}.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(${JSON.stringify(tag==='select'?'change':'input')},{bubbles:true}))})()`);
 const check=async(label)=>run(`(()=>{const el=Array.from(document.querySelectorAll('label')).find(l=>l.textContent.includes(${JSON.stringify(label)})).querySelector('input[type=checkbox]');if(!el.checked)el.click()})()`);
 if(fixture.rejectedIntake){
  await call('Page.navigate',{url:base+'/#finance?intake='+encodeURIComponent(fixture.rejectedIntake)});
  await wait(()=>run('document.body.innerText.includes("Scanner rejected this file")'));
  assert(await run('!Array.from(document.querySelectorAll("button")).some(b=>/Retry unavailable clean assessment|Extract receipt candidates|Check clean assessment/.test(b.textContent))'));
  await click('Cancel private intake');
  assert.equal(await run(`(async()=>{const r=await fetch('/api/companies/'+${JSON.stringify(fixture.company)}+'/finance/intakes/'+${JSON.stringify(fixture.rejectedIntake)},{credentials:'include'});return r.status})()`),404);
  result.checks.push('Actual rendered authorized rejected intake has truthful quarantine/cancel UI, no retry/extraction/check loop; cancel revokes GET');
 }
 await call('Page.navigate',{url:base+'/?owned-flow=receipt#finance?extraction='+encodeURIComponent(fixture.job)});
 await wait(()=>run('document.body.innerText.includes("Review receipt candidates")&&document.body.innerText.includes("Demo Stationery")'));
 for(const [label,value] of [['Reviewed title','Human reviewed fictional stationery'],['Reviewed vendor','Demo Stationery'],['Reviewed invoiceNumber','TEST-2026-001'],['Reviewed expenseDate','2026-10-10'],['Reviewed amount','1300.50']])await set(label,value);
 // These are explicit human choices; candidate/default values do not count.
 await set('Reviewed category',fixture.category,'select');
 await run(`(()=>{const el=document.querySelector('section[aria-label="Review extracted receipt"] select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(fixture.department)});el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await run(`Array.from(document.querySelectorAll('label')).filter(l=>l.textContent.includes('I resolved')).forEach(l=>l.querySelector('input').click())`);
 await check('Publish a separately retained copy');await click('Review exact draft and evidence audience');
 await wait(()=>run('document.body.innerText.includes("Current finance audience:")'));
 await check('I confirm this reviewed draft and evidence audience');
 // Commit at the real API then deliberately lose the acknowledgement once.
 await run(`window.financePosts=[];window.loseFinanceAck=true;window.originalFinanceFetch=window.fetch;window.fetch=async(...args)=>{const r=await window.originalFinanceFetch(...args);if(String(args[0]).endsWith('/accept')&&args[1]?.method==='POST'){window.financePosts.push(JSON.parse(args[1].body));if(window.loseFinanceAck&&r.ok){window.loseFinanceAck=false;throw new TypeError('Fictional dropped acknowledgement after actual commit')}}return r}`);
 await click('Create reviewed draft');await wait(()=>run('window.financePosts.length===1&&!window.loseFinanceAck&&Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="Retry same reviewed draft"&&!b.disabled)'));
 assert(await run(`document.querySelector('section[aria-label="Review extracted receipt"] fieldset').disabled`));
 await click('Retry same reviewed draft');await wait(()=>run('document.body.innerText.includes("Expense details")||!!document.querySelector(".finance-detail")'));
 const evidence=await run(`(async()=>{const root='/api/companies/'+${JSON.stringify(fixture.company)};const get=async path=>(await fetch(root+path,{credentials:'include'})).json();const w=await get('/workspace');const rows=w.expenses.filter(e=>e.invoiceNumber==='TEST-2026-001');if(rows.length!==1||rows[0].amountMinor!==130050||rows[0].status!=='draft')throw Error('Human acceptance not one exact draft');const e=(await get('/expenses/'+rows[0].id)).expense;if(!e.receipts?.length)throw Error('No retained evidence');return {id:e.id,amount:e.amountMinor,status:e.status,evidence:e.receipts.length,posts:window.financePosts}})()`);
 assert.equal(evidence.posts.length,2);assert.deepEqual(evidence.posts[0],evidence.posts[1]);assert.equal(evidence.posts[0].fields.amountMinor,130050);
 result.acceptance={id:evidence.id,minor:evidence.amount,status:evidence.status,retainedEvidence:evidence.evidence,sameKeySamePayload:true};
 result.canonicalRetry={path:'/companies/'+fixture.company+'/finance/receipt-extractions/'+fixture.job+'/accept',body:evidence.posts[0]};
 result.checks.push('Rendered human fields/category/destination/uncertainty/evidence/audience review creates one draft130050; actual post-commit lost ACK retries identical payload/key');
 // Close detail then open the real clean staged CSV using the current private list.
 await run(`Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')?.startsWith('Close')||b.textContent.trim()==='Close')?.click()`);
 await click('Import bank CSV');await wait(()=>run('document.body.innerText.includes("fictional-bank.csv")'));
 await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('fictional-bank.csv')).click()`);
 await wait(()=>run('document.body.innerText.includes("Map and review bank CSV")'));
 for(const [label,value] of [['headerRow','yes'],['delimiter','comma'],['dateFormat','YYYY-MM-DD'],['amountMode','signed'],['decimalSeparator','dot'],['groupingSeparator','none']])await set(label,value,'select');
 for(const [label,value] of [['dateColumn','1'],['signedAmountColumn','2'],['referenceColumn','3'],['descriptionColumn','4']])await set(label,value);
 await click('Preview exact statement rows');await wait(()=>run('document.body.innerText.includes("4 distinct records")'));
 assert(await run('document.body.innerText.includes("Record 3")&&document.body.innerText.includes("Record 4")'));
 await check('I reviewed the complete mapping and all normalized rows');
 await run(`window.statementPosts=[];window.loseImportAck=true;window.previewPosts=0;window.refreshFault=false;window.refreshFaultConsumed=false;window.beforeStatementFetch=window.fetch;window.fetch=async(...args)=>{const path=String(args[0]);if(path.endsWith('/preview')&&args[1]?.method==='POST')window.previewPosts++;const r=await window.beforeStatementFetch(...args);if(path.endsWith('/import')&&args[1]?.method==='POST'&&r.ok){window.statementPosts.push(JSON.parse(args[1].body));if(window.loseImportAck){window.loseImportAck=false;throw new TypeError('Fictional import ACK lost after real commit')}window.refreshFault=true}if(window.refreshFault&&(!args[1]?.method||args[1]?.method==='GET')&&path.includes('/expenses?')){window.refreshFault=false;window.refreshFaultConsumed=true;throw new TypeError('Fictional refresh read acknowledgement lost after real import')}return r}`);
 await click('Import reviewed statement');
 await wait(()=>run('window.statementPosts.length===1&&Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="Retry same statement import"&&!b.disabled)'));
 assert(await run('Array.from(document.querySelectorAll("fieldset")).some(f=>f.disabled)&&Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Preview exact statement rows").disabled'));
 await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Preview exact statement rows').click()`);
 await set('dateColumn','2');assert.equal(await run('window.previewPosts'),0);
 await click('Retry same statement import');
 await wait(()=>run('window.refreshFaultConsumed'));
 await run(`document.querySelector('button[aria-label="Refresh workspace"]').click()`);

 await wait(()=>run('document.body.innerText.includes("Statement reconciliation")&&document.body.innerText.includes("Record 2")'));
 const statementProof=await run(`(async()=>{const r=await fetch('/api/companies/'+${JSON.stringify(fixture.company)}+'/finance/statement-imports',{credentials:'include'});return {items:(await r.json()).items,posts:window.statementPosts}})()`);assert.equal(statementProof.items.length,1);assert.equal(statementProof.items[0].rowCount,4);result.statementRetry={importId:statementProof.items[0].id,rows:4,requests:statementProof.posts,sameKeySamePayload:true};
 assert.equal(await run('window.statementPosts.length'),2);assert(await run('JSON.stringify(window.statementPosts[0])===JSON.stringify(window.statementPosts[1])'));result.checks.push('Rendered CSV lost postcommit import ACK freezes mapping/re-preview; identical key/body retry yields one canonical four-occurrence import, then actual refresh-loss recovers it');
 if(fixture.paidExpense){
  const paidBefore=await run(`(async()=>{const r=await fetch('/api/companies/'+${JSON.stringify(fixture.company)}+'/expenses/'+${JSON.stringify(fixture.paidExpense)},{credentials:'include'});return (await r.json()).expense})()`);
  // Select a real full paid expense deliberately for the exact matching row.
  await run(`(()=>{const sections=Array.from(document.querySelectorAll('section'));const s=sections.find(s=>s.querySelector('select')&&s.querySelector('p')?.textContent.startsWith('Record 2'));if(!s)throw Error('First imported row missing');window.financeRowSection=s;const el=s.querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(fixture.paidExpense)});el.dispatchEvent(new Event('change',{bubbles:true}));const input=s.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Fictional full paid accounting review');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await run(`window.associationPosts=[];window.loseMatchAck=true;window.loseUnmatchAck=true;window.beforeAssociationFetch=window.fetch;window.fetch=async(...args)=>{const r=await window.beforeAssociationFetch(...args);const p=String(args[0]);if(args[1]?.method==='POST'&&(p.endsWith('/matches')||p.endsWith('/unmatch'))&&r.ok){const action=p.endsWith('/unmatch')?'unmatch':'match';window.associationPosts.push({action,body:JSON.parse(args[1].body)});const flag=action==='match'?'loseMatchAck':'loseUnmatchAck';if(window[flag]){window[flag]=false;throw new TypeError('Fictional association ACK lost after actual commit')}}return r}`);
  await run(`Array.from(window.financeRowSection.querySelectorAll('button')).find(b=>b.textContent==='Match full recorded payment').click()`);
  await wait(()=>run('!window.loseMatchAck&&document.body.innerText.includes("Retry same full payment match")'));
  await run(`document.querySelector('button[aria-label="Refresh workspace"]').click()`);
  await wait(()=>run('document.body.innerText.includes("Active full association")'));
  await click('Retry same full payment match');
  await set('Reversal reason','Fictional reversal preserves payment history');await click('Unmatch reviewed association');
  await wait(()=>run('!window.loseUnmatchAck&&document.body.innerText.includes("Retry same association unmatch")'));
  await run(`document.querySelector('button[aria-label="Refresh workspace"]').click()`);
  await wait(()=>run('document.body.innerText.includes("Reversed association")'));
  await click('Retry same association unmatch');
  await wait(()=>run('window.associationPosts.length===4'));
  const posts=await run('window.associationPosts');assert.equal(posts.length,4);assert.deepEqual(posts[0],posts[1]);assert.deepEqual(posts[2],posts[3]);
  const allocations=await run(`(async()=>{const r=await fetch('/api/companies/'+${JSON.stringify(fixture.company)}+'/finance/reconciliation?state=all',{credentials:'include'});return (await r.json()).allocations})()`);
  assert.equal(allocations.length,1);assert.equal(allocations[0].active,false);
  result.associationRetries={requests:posts,allocations:allocations.length,active:allocations[0].active,sameKeySamePayload:true};
  const paidAfter=await run(`(async()=>{const r=await fetch('/api/companies/'+${JSON.stringify(fixture.company)}+'/expenses/'+${JSON.stringify(fixture.paidExpense)},{credentials:'include'});return (await r.json()).expense})()`);for(const key of ['status','version','amountMinor','currency','paidDate','paymentReference','paymentMethod'])assert.equal(paidAfter[key],paidBefore[key]);
  result.checks.push('Actual committed match/unmatch ACK loss plus current refetch retains identical retry despite missing candidate/inactive allocation; one association/reversal and unchanged paid expense economics');
 }
 await click('Duplicate review');await wait(()=>run('document.body.innerText.includes("Expense to compare")'));
 await set('Expense to compare',fixture.duplicateSource,'select');await click('Review duplicate suggestions');
 await wait(()=>run('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.includes("same vendor amount date"))'));
 await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('same vendor amount date')).click()`);
 await wait(()=>run('document.body.innerText.includes("Reason to dismiss")'));
 await set('Reason to dismiss','Fictional equal-value purchases are separate occurrences');await click('Dismiss reviewed suggestion');
 const decision=await run(`(async()=>{const r=await fetch('/api/companies/'+${JSON.stringify(fixture.company)}+'/finance/duplicate-candidates?state=dismissed',{credentials:'include'});const d=await r.json();if(!r.ok||d.items.length!==1)throw Error('No single audited duplicate dismissal');return d.items[0].state})()`);assert.equal(decision,'dismissed');
 result.checks.push('Rendered false-positive duplicate review and meaningful reason create one current audited dismissal without economic mutation');
 result.completed={receiptReviews:'1/1',statementImports:'1/1',paidAssociationAndReversal:'1/1',duplicateDismissals:'1/1',method:'One scripted human-choice fictional cohort per owned database; not user-study or accuracy/capacity certification'};
 for(const width of [320,375,430,1440]){
  await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});await delay(200);
  assert(await run('document.documentElement.scrollWidth<=innerWidth'),`Finance overflow at ${width}`);
 }
 await run(`document.documentElement.style.fontSize='24px'`);await call('Emulation.setDeviceMetricsOverride',{width:375,height:1000,deviceScaleFactor:1,mobile:true});await delay(200);assert(await run('document.documentElement.scrollWidth<=innerWidth'),'Large-text finance overflow');
 result.checks.push('Actual rendered 320/375/430/1440px and 150% text finance layout has no horizontal overflow');
 result.measurements=await run(`(async()=>{const root='/api/companies/'+${JSON.stringify(fixture.company)};const out={};for(const path of ['/finance/intakes','/finance/receipt-extractions/'+${JSON.stringify(fixture.job)},'/finance/reconciliation?state=all']){const samples=[];for(let n=0;n<5;n++){const start=performance.now();const r=await fetch(root+path,{credentials:'include'});const bytes=new TextEncoder().encode(await r.text()).length;if(!r.ok)throw Error('Measurement read failed');samples.push({milliseconds:performance.now()-start,bytes})}const sorted=samples.map(s=>s.milliseconds).sort((a,b)=>a-b);out[path]={requests:5,bytes:samples[0].bytes,p50:sorted[2],p95:sorted[4]}}return out})()`);
 assert.deepEqual(errors,[]);result.status='passed';result.browser=(await call('Browser.getVersion')).product;result.scope='Owned fictional actual HTTP and Chromium UI; single-user local measurements are not production capacity, native or physical certification.';
 console.log(JSON.stringify({status:result.status,checks:result.checks.length}));
}catch(e){result.error=e.message;try{result.rendered=await run('document.body.innerText');result.lastResources=await run('performance.getEntriesByType(\"resource\").slice(-15).map(e=>e.name)')}catch{}process.exitCode=1;console.error(e.stack)}finally{await writeFile(output,JSON.stringify(result,null,2)+'\n');socket?.close();browser.kill('SIGTERM');await delay(200);await rm(profile,{recursive:true,force:true})}
