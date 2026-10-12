// Documentation-only Chromium checks. No application or provider endpoints.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';

const qa=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const parent=path.join(os.homedir(),'.local/state/schach-qa-validation');
await fs.mkdir(parent,{recursive:true,mode:0o700});
const run=await fs.mkdtemp(path.join(parent,'offline-guide-'));
await fs.chmod(run,0o700);
const profile=path.join(run,'profile');
const chrome=spawn('chromium',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','ignore']});
let ws;const requests=[],exceptions=[];let serial=0;const pending=new Map();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(probe){for(let i=0;i<100;i++){try{const v=await probe();if(v)return v}catch{}await sleep(100)}throw Error('Documentation check timed out')}
try{
 const port=await until(async()=>{const raw=await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8');return Number(raw.split('\n')[0])});
 const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 const target=targets.find(t=>t.type==='page');assert(target);
 ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 ws.onmessage=({data})=>{const v=JSON.parse(data);if(v.id){const p=pending.get(v.id);if(p){pending.delete(v.id);v.error?p.reject(v.error):p.resolve(v.result)}}else if(v.method==='Network.requestWillBeSent')requests.push(v.params.request.url);else if(v.method==='Runtime.exceptionThrown')exceptions.push(v.params.exceptionDetails)};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
 const evaluate=async(expression)=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
 await call('Page.navigate',{url:pathToFileURL(path.join(qa,'index.html')).href});
 await until(()=>evaluate('document.querySelectorAll(".case").length===224'));
 assert.equal(await evaluate('document.querySelectorAll("article").length'),21);
 assert.equal(await evaluate('document.querySelector("#module").options.length'),22);
 await evaluate('document.querySelector("#query").value="CONNECT-001";document.querySelector("#query").dispatchEvent(new Event("input"));');
 assert.equal(await evaluate('document.querySelectorAll(".case").length'),1);
 await evaluate('document.querySelector("#clear").click();document.querySelector("#module").value="REPORTS";document.querySelector("#module").dispatchEvent(new Event("change"));');
 assert.equal(await evaluate('document.querySelectorAll(".case").length'),18);
 await evaluate('document.querySelector("#clear").click();document.querySelector("#gate").value="DEVICE";document.querySelector("#gate").dispatchEvent(new Event("change"));');
 assert.equal(await evaluate('document.querySelectorAll(".case").length'),16);
 await evaluate('document.querySelector("#clear").click();document.querySelector("#priority").value="P0";document.querySelector("#priority").dispatchEvent(new Event("change"));');
 assert.equal(await evaluate('document.querySelectorAll(".case").length'),147);
 await evaluate('document.querySelector("#clear").click();document.querySelector("#query").value="no-such-case-zzzz";document.querySelector("#query").dispatchEvent(new Event("input"));');
 assert.equal(await evaluate('document.querySelectorAll(".empty").length'),1);
 await evaluate('document.querySelector("#clear").click();document.querySelector("#query").value="CONNECT-001";document.querySelector("#query").dispatchEvent(new Event("input"));document.querySelectorAll(".case details").forEach(d=>d.open=true);');
 await evaluate('document.querySelectorAll(".case img").forEach(i=>{i.loading="eager";i.scrollIntoView()});');
 await until(()=>evaluate('Array.from(document.querySelectorAll(".case img")).every(i=>i.complete&&i.naturalWidth>0)'));
 const catalog=JSON.parse(await fs.readFile(path.join(qa,'catalog/catalog.json'),'utf8'));
 const selected=catalog.modules.flatMap(m=>m.cases).find(c=>c.id==='CONNECT-001');
 assert.equal(await evaluate('document.querySelectorAll(".case tbody tr").length'),selected.steps.length);
 await evaluate('scrollTo(0,0)');
 const widths=[];
 for(const width of [320,375,430]){
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:true});
  const bounds=await evaluate('({viewport:innerWidth,content:document.documentElement.scrollWidth,controls:Array.from(document.querySelectorAll(".bar input,.bar select,.bar button")).map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}))})');
  if(bounds.content>width+1)console.log(JSON.stringify(await evaluate('Array.from(document.querySelectorAll("body *")).filter(e=>e.getBoundingClientRect().right>'+width+').slice(-12).map(e=>({tag:e.tagName,text:e.textContent.slice(0,120),right:e.getBoundingClientRect().right}))')));
  assert(bounds.content<=width+1,JSON.stringify(bounds));assert(bounds.controls.every(c=>c.left>=0&&c.right<=width+1));
  widths.push({width,overflow:false});
  const shot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(run,'guide-'+width+'.png'),Buffer.from(shot.data,'base64'));
 }
 for(const id of ['AUTH','FINANCE','JOURNEYS-009']){
  const source=await fs.readFile(path.join(qa,'diagrams',id+'.svg'),'utf8');const height=Number(source.match(/height="([0-9.]+)"/)[1]);
  await call('Emulation.setDeviceMetricsOverride',{width:1160,height:Math.ceil(height),deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:pathToFileURL(path.join(qa,'diagrams',id+'.svg')).href});
  await until(()=>evaluate('document.documentElement.tagName.toLowerCase()==="svg"'));
  const shot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(run,id+'.png'),Buffer.from(shot.data,'base64'));
 }
 assert.equal(exceptions.length,0);
 const external=requests.filter(u=>!u.startsWith('file:')&&!u.startsWith('data:')&&!u.startsWith('about:'));
 assert.equal(external.length,0,JSON.stringify(external));
 const result={status:'PASS',scope:'Offline QA documentation only; no application cases executed',cases:224,guides:21,checks:['Search by case ID','Module REPORTS filter:18','DEVICE gate filter:16','P0 filter:147','Empty results and clear','Scenario SVG loads','Paired action/result table','No renderer exceptions','No external page requests'],phoneWidths:widths,diagramScreenshots:['AUTH','FINANCE','JOURNEYS-009'],privateArtifacts:run};
 await fs.writeFile(path.join(run,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{if(ws)ws.close();chrome.kill('SIGTERM')}
