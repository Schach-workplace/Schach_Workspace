// Screenshot web views of a DISPOSABLE fictional QA instance via headless Chromium (raw CDP).
// Usage: WIDTHS=1440,390 node verification/runtime/ui_screenshots.mjs <baseUrl> <outDir> <demoEmail> [view|view!cssSelectorToClick ...]
// Refuses port 8080 (retained workspace). Demo password is the public fictional one from README.
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, rm, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const [base, out, email, ...rest] = process.argv.slice(2);
if (!base || new URL(base).port === '8080') throw new Error('Refusing: need disposable non-8080 base URL');
const views = rest.length ? rest : ['overview','connect','my-work','tasks','projects','calendar','workload','goals','finance','reports','people','inbox','settings'];
const widths = (process.env.WIDTHS || '1440,390').split(',').map(Number);
await mkdir(out, {recursive: true});
const profile = await mkdtemp(join(tmpdir(), 'schach-shots-'));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn('chromium', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], {stdio: 'ignore', detached: true});
const chromeExited = new Promise(r => chrome.once('exit', r));
const cleanup = async () => {
  // The launcher may fork the real browser; kill the whole process group, then remove the profile.
  const killGroup = sig => { try { process.kill(-chrome.pid, sig); } catch {} };
  killGroup('SIGTERM'); await Promise.race([chromeExited, sleep(3000)]); await sleep(500);
  killGroup('SIGKILL'); await sleep(300);
  for (let i = 0; i < 5; i++) { await rm(profile, {recursive: true, force: true, maxRetries: 3}).catch(() => {}); try { await access(profile); await sleep(300); } catch { return; } }
};
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });
process.on('uncaughtException', async e => { console.error(e); await cleanup(); process.exit(1); });
process.on('unhandledRejection', async e => { console.error(e); await cleanup(); process.exit(1); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 100 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({id: i, method, params})); });
const evaluate = async expr => (await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true})).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', {url: base}); await sleep(2500);
const login = await evaluate(`(async()=>{const set=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};set(document.querySelector('input[type=email],input[autocomplete=username],input[name=email]'),${JSON.stringify(email)});set(document.querySelector('input[type=password]'),'SchachDemo!2026');document.querySelector('form button[type=submit],form button').click();await new Promise(r=>setTimeout(r,3500));return document.querySelector('input[type=password]')?'still-login':'signed-in'})()`);
console.log('login', login);
const report = [];
for (const w of widths) {
  const mobile = w < 700;
  await send('Emulation.setDeviceMetricsOverride', {width: w, height: mobile ? 844 : 900, deviceScaleFactor: 1, mobile});
  for (const v of views) {
    // A view may be "route!css-selector[!selector...]" to click elements (e.g. open a dialog) before the shot.
    const [route, ...clicks] = v.split('!');
    await send('Page.navigate', {url: `${base}/#${route}`}); await sleep(3000);
    for (const sel of clicks) { await evaluate(`document.querySelector(${JSON.stringify(sel)})?.click()`); await sleep(1200); }
    const h = await evaluate('Math.min(document.documentElement.scrollHeight, 6000)');
    const overflow = await evaluate(`(()=>{const W=${w};const doc=Math.max(document.documentElement.scrollWidth,document.body.scrollWidth);const scrolls=el=>{for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p);if(/(auto|scroll|hidden|clip)/.test(s.overflowX))return true;}return false};const off=[];for(const el of document.body.querySelectorAll('*')){const r=el.getBoundingClientRect();if(r.width===0||r.height===0)continue;if(r.right>W+1&&!scrolls(el)){off.push((el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(typeof el.className==='string'&&el.className?'.'+el.className.trim().split(/\\s+/).slice(0,2).join('.'):''))+'@'+Math.round(r.right));if(off.length>=8)break;}}return doc>W+1||off.length?{scrollWidth:doc,offenders:off}:false})()`);
    await send('Emulation.setDeviceMetricsOverride', {width: w, height: h || 900, deviceScaleFactor: 1, mobile});
    await sleep(400);
    const shot = await send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false});
    const file = join(out, `${v.replace(/[^\w-]+/g, '_')}-${w}.png`);
    await writeFile(file, Buffer.from(shot.result.data, 'base64'));
    report.push({view: v, width: w, height: h, horizontalOverflow: overflow});
    await send('Emulation.setDeviceMetricsOverride', {width: w, height: mobile ? 844 : 900, deviceScaleFactor: 1, mobile});
  }
}
await writeFile(join(out, 'report.json'), JSON.stringify({report, errors}, null, 2));
console.log(JSON.stringify({report: report.filter(r => r.horizontalOverflow), errors}, null, 1));
ws.close(); await cleanup();
