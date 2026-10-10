// Real WebRTC test. Credentials enter through stdin and never appear in output.
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
let input='';for await(const chunk of process.stdin)input+=chunk;
const cfg=JSON.parse(input),profile=await mkdtemp(join(tmpdir(),'schach-call-'));
const browser=spawn('chromium',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','about:blank'],{stdio:['ignore','ignore','pipe']});
let debuggerURL='';browser.stderr.on('data',b=>{const m=String(b).match(/DevTools listening on (ws:\/\/\S+)/);if(m)debuggerURL=m[1]});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){const end=Date.now()+30000;while(Date.now()<end){if(await fn())return;await delay(100)}throw new Error('Runtime condition timed out')}
const sockets=[];
async function cdp(url){const socket=new WebSocket(url);sockets.push(socket);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j});let next=0;const pending=new Map();socket.onmessage=e=>{const v=JSON.parse(e.data);if(v.id){const p=pending.get(v.id);pending.delete(v.id);v.error?p.reject(new Error(v.error.message)):p.resolve(v.result)}};return(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))})}
try{
 await until(()=>debuggerURL);const root=await cdp(debuggerURL),port=new URL(debuggerURL).port;
 async function page(cookie){const {browserContextId}=await root('Target.createBrowserContext');const {targetId}=await root('Target.createTarget',{url:'about:blank',browserContextId});let target;await until(async()=>{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.id===targetId);return target});const call=await cdp(target.webSocketDebuggerUrl);await call('Network.setCookie',{name:cookie.name,value:cookie.value,url:cfg.base});await call('Page.navigate',{url:cfg.base+'/call-harness'});const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error('Browser operation failed');return r.result.value};await until(()=>evaluate('!!window.LivekitClient'));return evaluate}
 const a=await page(cfg.ownerCookie),b=await page(cfg.memberCookie);
 async function connect(evaluate){return evaluate(`(async()=>{const post=async(p,v)=>{const r=await fetch('/api'+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(v)});if(!r.ok)throw Error('API failed');return r.json()};const d=await post('/devices',{platform:'web',name:'Runtime test'});const t=await post(${JSON.stringify(`/companies/${cfg.company}/calls/${cfg.call}/token`)},{deviceId:d.id});window.joinToken=t.token;window.gateway=t.url;window.room=new LivekitClient.Room();window.room.on(LivekitClient.RoomEvent.TrackSubscribed,()=>window.received=true);window.room.on(LivekitClient.RoomEvent.Disconnected,()=>window.disconnected=true);await room.connect(t.url,t.token);return room.state==='connected'})()`)}
 assert.equal(await connect(a),true);assert.equal(await connect(b),true);
 assert.equal(await a('(async()=>{await room.localParticipant.setMicrophoneEnabled(true);return room.localParticipant.audioTrackPublications.size>0})()'),true);
 await until(()=>b('!!window.received'));console.log('PASS two isolated browsers join and subscribe to real audio');
 await a(`(async()=>{const r=await fetch(${JSON.stringify(`/api/companies/${cfg.company}/conversations/${cfg.conversation}/members`)},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedVersion:1,userId:${JSON.stringify(cfg.member)},role:'member',active:false})});return r.status===200})()`).then(v=>assert.equal(v,true));
 await until(()=>b('!!window.disconnected'));console.log('PASS removed participant is disconnected from real provider');
 assert.equal(await b(`(async()=>{const r=await fetch(window.gateway.replace('ws:','http:')+'/rtc/validate?access_token='+encodeURIComponent(window.joinToken));return r.status===404||r.status===403})()`),true);console.log('PASS cached provider token denied by current authorization gateway');
 assert.equal(await b(`(async()=>{const r=await fetch(${JSON.stringify(`/api/companies/${cfg.company}/calls/${cfg.call}/token`)},{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return r.status===404})()`),true);console.log('PASS refreshed token denied after removal');
 await a(`(async()=>{const r=await fetch(${JSON.stringify(`/api/companies/${cfg.company}/calls/${cfg.call}/end`)},{method:'POST',headers:{'Content-Type':'application/json'},body:'{"expectedVersion":1}'});return r.status===200})()`).then(v=>assert.equal(v,true));await until(()=>a('!!window.disconnected'));console.log('PASS end-call provider room deletion completes');
}catch(e){console.error('FAIL real LiveKit browser scenario:',e instanceof assert.AssertionError?'assertion failed':e.message);process.exitCode=1}
finally{for(const s of sockets)s.close();browser.kill('SIGTERM');await new Promise(r=>browser.once('exit',r));await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200})}
