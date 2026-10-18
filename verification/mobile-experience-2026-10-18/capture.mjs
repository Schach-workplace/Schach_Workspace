// Fictional React Native Web layout evidence only, never native-device proof.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const base = "http://127.0.0.1:5186";
const out = new URL("./screenshots/", import.meta.url);
await mkdir(out, { recursive: true });
const port = 19386;
// Refuse an occupied debug port before launching or selecting a target.
await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(port, "127.0.0.1", () => probe.close(resolve));
});
const profile = await mkdtemp(join(tmpdir(), "workspace-mobile-layout-"));
const browser = spawn(
  "chromium",
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--hide-scrollbars",
    "about:blank",
  ],
  { stdio: "ignore", detached: true },
);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const external = [];
let ws;
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await pause(200);
    try {
      target = (
        await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      ).find((p) => p.type === "page");
    } catch {}
  }
  if (!target) throw Error("Owned headless browser did not start");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pending = new Map();
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const key = ++id;
      pending.set(key, { resolve, reject });
      ws.send(JSON.stringify({ id: key, method, params }));
    });
  }
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
    if (m.method === "Runtime.exceptionThrown")
      errors.push(
        m.params.exceptionDetails.exception?.description ||
          m.params.exceptionDetails.text,
      );
    if (m.method === "Fetch.requestPaused") {
      const p = m.params;
      const allowed =
        p.request.url.startsWith(base + "/") ||
        p.request.url.startsWith("data:");
      if (!allowed) external.push(p.request.url);
      void send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", {
        requestId: p.requestId,
        ...(allowed ? {} : { errorReason: "BlockedByClient" }),
      });
    }
  });
  const evaluate = async (expression) =>
    (
      await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })
    ).result?.value;
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  const results = [];
  const cases = [
    ["login", 320, "?view=login"],
    ["login", 390, "?view=login"],
    ["login", 430, "?view=login"],
    ["login-error", 390, "?view=login&error"],
    ["login-verification", 320, "?view=login"],
    ["modules", 320, "?view=modules"],
    ["modules", 390, "?view=modules"],
    ["modules", 430, "?view=modules"],
    ["modules-long", 320, "?view=modules&long"],
    ["modules-large", 320, "?view=modules&long"],
    ["modules-empty", 390, "?view=modules"],
    ["frame", 390, "?view=frame"],
  ];
  for (const [name, width, query] of cases) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await send("Page.navigate", { url: base + "/" + query });
    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) {
      await pause(150);
      ready = await evaluate(
        'document.body.innerText.includes("Workspace") || document.body.innerText.includes("Explore your workspace")',
      );
    }
    if (!ready)
      throw Error(
        "Component did not render: " + name + " " + JSON.stringify(errors),
      );
    if (name === "login-verification") {
      await evaluate(
        `Array.from(document.querySelectorAll('[role=button]')).find(e=>e.textContent==='Use authenticator or recovery code')?.click()`,
      );
      await pause(200);
    }
    if (name === "modules-empty") {
      await evaluate(
        `(()=>{const input=document.querySelector('input[aria-label="Search modules"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'no-such-fictional-module');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await pause(200);
    }
    if (name === "modules-large") {
      await evaluate(
        `for(const e of document.querySelectorAll('[dir="auto"],input')){const s=getComputedStyle(e);e.style.fontSize=(parseFloat(s.fontSize)*1.6)+'px';e.style.lineHeight=(parseFloat(s.lineHeight||s.fontSize)*1.6)+'px';}`,
      );
      await pause(200);
    }
    const layout = await evaluate(
      `(()=>{const width=${width};return {documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,search:document.querySelector('input[aria-label="Search modules"]')?.value,visibleText:document.body.innerText.slice(0,250),overflow:[...document.querySelectorAll('[dir="auto"],input,button,[role="button"]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>width+1||r.left< -1)&&!(()=>{for(let p=e.parentElement;p;p=p.parentElement)if(/auto|scroll/.test(getComputedStyle(p).overflowX))return true;return false;})()}).map(e=>({label:e.getAttribute('aria-label')||e.textContent.slice(0,50),right:Math.round(e.getBoundingClientRect().right)})).slice(0,10)};})()`,
    );
    const screenshot = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    await writeFile(
      new URL(`${name}-${width}.png`, out),
      Buffer.from(screenshot.data, "base64"),
    );
    // Capture the bottom of every native scroll container, where primary actions live.
    if (
      name === "login" ||
      name === "login-verification" ||
      name === "modules"
    ) {
      await evaluate(
        `for(const e of document.querySelectorAll('div'))if(e.scrollHeight>e.clientHeight+20&&/(auto|scroll)/.test(getComputedStyle(e).overflowY))e.scrollTop=e.scrollHeight;`,
      );
      await pause(100);
      const bottom = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      });
      await writeFile(
        new URL(`${name}-bottom-${width}.png`, out),
        Buffer.from(bottom.data, "base64"),
      );
    }
    results.push({ name, width, layout });
  }
  const result = {
    qualification:
      "Actual RN Web components with explicit fictional fixture; CSS enlarged-text proxy, not physical iOS/Android acceptance",
    results,
    errors,
    blockedExternalRequests: external,
  };
  await writeFile(
    new URL("./layout-result.json", import.meta.url),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      cases: results.length,
      errors,
      blockedExternalRequests: external,
      overflow: results.filter(
        (r) => r.layout.documentWidth > r.width + 1 || r.layout.overflow.length,
      ),
    }),
  );
  if (
    errors.length ||
    external.length ||
    results.some(
      (r) => r.layout.documentWidth > r.width + 1 || r.layout.overflow.length,
    )
  )
    process.exitCode = 1;
} finally {
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
