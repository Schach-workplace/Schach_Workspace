// Real browser/API integration on a NEW disposable fictional loopback fixture only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const base = process.env.SCHACH_SMOKE_URL;
assert(
  process.argv.includes("--allow-demo-mutations"),
  "Explicit fictional mutation authorization required",
);
const url = new URL(base);
assert(
  ["127.0.0.1", "localhost"].includes(url.hostname) &&
    url.protocol === "http:" &&
    url.port !== "8080",
);
const guideTitle = "Fictional pump pressure guide " + Date.now();
const out = new URL("./browser/", import.meta.url);
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "workspace-premium-api-"));
const browser = spawn(
  "chromium",
  [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-background-networking",
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"], detached: true },
);
let endpoint = "",
  ws,
  debugRun,
  debugCall,
  stage = "startup";
browser.stderr.on("data", (b) => {
  const m = String(b).match(/DevTools listening on (ws:\/\/\S+)/);
  if (m) endpoint = m[1];
});
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const result = {
  status: "failed",
  scope:
    "Actual current compiled web and standalone API on fictional disposable data; no physical/native/provider claim",
  checks: [],
  errors: [],
  external: [],
};
const wait = async (fn) => {
  for (let i = 0; i < 200; i++) {
    if (await fn()) return;
    await pause(100);
  }
  throw Error("Timed out waiting for rendered workflow: " + stage);
};
try {
  await wait(() => endpoint);
  const target = (
    await (
      await fetch(`http://127.0.0.1:${new URL(endpoint).port}/json/list`)
    ).json()
  ).find((x) => x.type === "page");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let seq = 0;
  const pending = new Map();
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
    }
    if (m.method === "Runtime.exceptionThrown")
      result.errors.push(
        m.params.exceptionDetails.exception?.description ||
          m.params.exceptionDetails.text,
      );
    if (m.method === "Fetch.requestPaused") {
      const p = m.params,
        allowed =
          p.request.url.startsWith(base + "/") ||
          p.request.url.startsWith("data:") ||
          p.request.url.startsWith("blob:");
      if (!allowed) result.external.push(p.request.url);
      void call(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", {
        requestId: p.requestId,
        ...(allowed ? {} : { errorReason: "BlockedByClient" }),
      }).catch((e) => {
        if (!e.message.includes("Invalid InterceptionId"))
          result.errors.push(e.message);
      });
    }
  };
  const run = async (expression) => {
    const r = await call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails)
      throw Error(
        r.exceptionDetails.exception?.description || r.exceptionDetails.text,
      );
    return r.result.value;
  };
  debugRun = run;
  debugCall = call;
  const click = async (text) => {
    stage = "click " + text;
    await run(
      `(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('Missing button '+${JSON.stringify(text)});e.click()})()`,
    );
    await pause(200);
  };
  const fill = async (label, value) =>
    run(
      `(()=>{const e=[...document.querySelectorAll('label')].find(e=>e.textContent.trim().startsWith(${JSON.stringify(label)}))?.querySelector('input,textarea,select');if(!e)throw Error('Missing field '+${JSON.stringify(label)});const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`,
    );
  const reload = async () => {
    stage = "reload";
    await run("window.fixtureReloadMarker=true");
    await call("Page.reload");
    await wait(() =>
      run('!window.fixtureReloadMarker && document.readyState==="complete"'),
    );
  };
  const shot = async (name) => {
    await writeFile(
      new URL(name + ".png", out),
      Buffer.from(
        (await call("Page.captureScreenshot", { format: "png" })).data,
        "base64",
      ),
    );
  };
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await call("Page.navigate", { url: base });
  await wait(() => run('!!document.querySelector("input[type=password]")'));
  await run(
    `(()=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [selector,value] of [['input[type=email]','founder@schach.demo'],['input[type=password]','SchachDemo!2026']]){const e=document.querySelector(selector);set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}))}document.querySelector('form').requestSubmit()})()`,
  );
  await wait(() =>
    run(
      '!document.querySelector("input[type=password]")&&document.body.innerText.includes("Goals")',
    ),
  );
  const fixture = await run(
    `(async()=>{const api=async(path,method='GET',body)=>{const r=await fetch('/api'+path,{method,credentials:'include',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error('Fixture request '+method+' '+path+' returned '+r.status+' '+await r.text());return r.json()};window.fixtureApi=api;const s=await api('/auth/session'),cid=s.companies[0].id,root='/companies/'+cid;window.fixtureRoot=root;const work=await api(root+'/workspace'),mentor=work.people.find(p=>p.email==='ceo@schach.demo');if(!mentor)throw Error('Missing fictional reviewer');const catalog=await api(root+'/growth/catalog');const plans=[];for(const p of catalog.pilots){plans.push(await api(root+'/growth/plans','POST',{retryKey:crypto.randomUUID(),pilot:p.id,title:'Fictional '+p.id+' learning',careerRole:p.careerRoles[0],careerLevel:p.levels[0],competencyIds:[p.competencies[0].id],objective:'Practice a documented handover',learningActions:['Read guidance','Practice handover'],evidenceNote:'Fictional employee reflection',mentorId:mentor.id}))}const article=await api(root+'/knowledge','POST',{retryKey:crypto.randomUUID(),title:${JSON.stringify(guideTitle)},body:'Pump pressure handover requires checking the pressure gauge and recording observations.',pilot:'field',reviewerId:mentor.id,audience:'company',readerIds:[],reviewDueDate:'2099-01-01'});return {cid,plans,article,mentor:mentor.id}})()`,
  );
  result.checks.push(
    "Actual API creates engineering, office and field plans plus independently reviewable Knowledge draft",
  );
  await reload();
  await wait(() =>
    run(
      'document.body.innerText.includes("Goals")&&!document.querySelector("input[type=password]")',
    ),
  );
  await click("Goals");
  await click("Development plans");
  await wait(() =>
    run(
      'document.body.innerText.includes("Fictional engineering learning")&&document.body.innerText.includes("Fictional office learning")&&document.body.innerText.includes("Fictional field learning")',
    ),
  );
  await shot("growth-desktop-1440");
  result.checks.push(
    "Compiled Growth UI renders all three real API pilot plans",
  );
  await click("Knowledge");
  await wait(() =>
    run(`document.body.innerText.includes(${JSON.stringify(guideTitle)})`),
  );
  await click(guideTitle);
  await wait(() =>
    run(
      'document.body.innerText.includes("Draft access is limited to owner and reviewer")',
    ),
  );
  assert.equal(
    await run(
      '!![...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Review publication")',
    ),
    false,
  );
  result.checks.push("Author cannot access independent publication action");
  await run(
    `(async()=>{const api=async(path,body)=>{const r=await fetch('/api'+path,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('Account switch '+r.status)};await api('/auth/logout',{});await api('/auth/login',{email:'ceo@schach.demo',password:'SchachDemo!2026'})})()`,
  );
  await reload();
  await wait(() =>
    run(
      'document.body.innerText.includes("Goals")&&!document.querySelector("input[type=password]")',
    ),
  );
  await click("Goals");
  await wait(() =>
    run(
      '!![...document.querySelectorAll("h2")].find(e=>e.textContent==="Measured outcomes")',
    ),
  );
  await click("Knowledge");
  await wait(() =>
    run(`document.body.innerText.includes(${JSON.stringify(guideTitle)})`),
  );
  await click(guideTitle);
  await wait(() =>
    run('document.body.innerText.includes("Review publication")'),
  );
  await click("Review publication");
  await fill("Decision", "publish");
  await fill(
    "Review reason",
    "Checked the fictional pressure handover procedure.",
  );
  await run(
    `document.querySelector('[role="dialog"] input[type="checkbox"]').click()`,
  );
  await click("Submit independent review");
  await wait(() =>
    run(
      `(async()=>{const r=await fetch('/api/companies/'+${JSON.stringify(fixture.cid)}+'/knowledge/'+${JSON.stringify(fixture.article.id)},{credentials:'include'});return r.ok&&(await r.json()).article.state==='published'})()`,
    ),
  );
  // Publication changes the permission epoch; existing workspace reauthorization
  // remounts module state. Reopen the current authorized Knowledge view deliberately.
  await wait(() =>
    run(
      '!document.querySelector("[role=dialog]")&&document.body.innerText.includes("Development plans")',
    ),
  );
  await click("Knowledge");
  await wait(() =>
    run(`document.body.innerText.includes(${JSON.stringify(guideTitle)})`),
  );
  await click(guideTitle);
  await wait(() => run('document.body.innerText.includes("published")'));
  result.notes = [
    "Publication permission-epoch refresh returns Goals to Measured outcomes; the flow deliberately reopens Knowledge after checking the committed current source.",
  ];
  result.checks.push(
    "Actual compiled independent reviewer publishes through singular canonical /review route",
  );
  await shot("knowledge-desktop-1440");
  await click("← Knowledge library");
  const sourceSelector =
    "input[aria-label=" +
    JSON.stringify("Use " + guideTitle + " as a source") +
    "]";
  await wait(() =>
    run(`!!document.querySelector(${JSON.stringify(sourceSelector)})`),
  );
  await run(
    `document.querySelector(${JSON.stringify(sourceSelector)}).click()`,
  );
  await fill("Question", "pressure gauge");
  await click("Find cited passages");
  await wait(() => run('!!document.querySelector("blockquote cite")'));
  assert(
    await run(
      'document.querySelector("blockquote").innerText.includes("pressure gauge")&&document.querySelector("cite").innerText.includes("version 2")',
    ),
  );
  result.checks.push(
    "Real current published source produces the correct versioned literal citation",
  );
  await call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await pause(200);
  assert(
    await run("document.documentElement.scrollWidth<=innerWidth"),
    "390px Knowledge overflows",
  );
  await shot("knowledge-phone-390");
  await click("Development plans");
  await wait(() =>
    run('document.body.innerText.includes("Fictional field learning")'),
  );
  assert(
    await run("document.documentElement.scrollWidth<=innerWidth"),
    "390px Development overflows",
  );
  await shot("growth-phone-390");
  result.checks.push(
    "Compiled new web journeys fit390px without document overflow",
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.external, []);
  result.status = "passed";
  console.log(
    JSON.stringify({ status: result.status, checks: result.checks.length }),
  );
} catch (e) {
  result.error = e.message;
  try {
    result.failureText = await debugRun(
      "document.body.innerText.slice(0,6000)",
    );
    result.failureHeadings = await debugRun(
      '[...document.querySelectorAll("h2")].map(e=>e.textContent)',
    );
    result.failureTabs = await debugRun(
      '[...document.querySelectorAll("[aria-pressed]")].map(e=>({text:e.textContent,pressed:e.getAttribute("aria-pressed")}))',
    );
    await writeFile(
      new URL("failure.png", out),
      Buffer.from(
        (await debugCall("Page.captureScreenshot", { format: "png" })).data,
        "base64",
      ),
    );
  } catch {}
  process.exitCode = 1;
  console.error(e.message);
} finally {
  await writeFile(
    new URL("result.json", out),
    JSON.stringify(result, null, 2) + "\n",
  );
  ws?.close();
  try {
    process.kill(-browser.pid, "SIGTERM");
  } catch {}
  await pause(500);
  try {
    process.kill(-browser.pid, "SIGKILL");
  } catch {}
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
