import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const manifest = process.argv[process.argv.indexOf("--manifest") + 1];
assert(manifest, "Owned lifecycle manifest required");
const f = JSON.parse(await readFile(manifest, "utf8"));
assert(
  f.owned && f.pid > 0 && new URL(f.backend).hostname === "127.0.0.1",
  "Owned fixture required",
);
process.kill(f.pid, 0);
let offline = false;
const transports = new Set();
const backend = new URL(f.backend);
const proxy = http.createServer((req, res) => {
  if (offline) {
    res.writeHead(503);
    res.end("Owned transport offline");
    return;
  }
  const target = http.request(
    {
      hostname: backend.hostname,
      port: backend.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: backend.host },
    },
    (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    },
  );
  target.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(target);
});
proxy.on("connection", (s) => {
  transports.add(s);
  s.on("close", () => transports.delete(s));
});
proxy.on("upgrade", (req, down, head) => {
  if (offline) {
    down.destroy();
    return;
  }
  const target = http.request({
    hostname: backend.hostname,
    port: backend.port,
    path: req.url,
    headers: { ...req.headers, host: backend.host },
  });
  target.on("upgrade", (up, socket, upHead) => {
    down.write(
      `HTTP/1.1 ${up.statusCode} Switching Protocols\r\n` +
        Object.entries(up.headers)
          .map(([k, v]) => `${k}: ${v}\r\n`)
          .join("") +
        "\r\n",
    );
    if (head.length) socket.write(head);
    if (upHead.length) down.write(upHead);
    down.pipe(socket);
    socket.pipe(down);
    down.on("close", () => socket.destroy());
    socket.on("error", () => down.destroy());
  });
  target.on("error", () => down.destroy());
  target.end();
});
await new Promise((r) =>
  proxy.listen(Number(new URL(f.proxy).port), "127.0.0.1", r),
);
const profile = await mkdtemp(join(tmpdir(), "schach-history-chrome-"));
const browser = spawn(
  "chromium",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let endpoint = "";
browser.stderr.on("data", (b) => {
  const m = String(b).match(/DevTools listening on (ws:\/\/\S+)/);
  if (m) endpoint = m[1];
});
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(fn, timeout = 120000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await delay(50);
  }
  throw Error("History scenario timed out");
}
let socket, evaluate, call;
const result = { status: "failed", widths: [], physicalGates: "unchecked" };
const network = [];
const requests = new Map();
let ackHandler;
let socketClosed = 0;
async function api(
  path,
  body,
  method = body === undefined ? "GET" : "POST",
  cookie = f.ownerCookie,
) {
  const r = await fetch(f.backend + path, {
    method,
    headers: {
      Origin: f.backend,
      Cookie: cookie,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  assert.equal(r.status, 200, `HTTP ${method} ${path}: ${r.status}`);
  return { value: JSON.parse(text), bytes: Buffer.byteLength(text) };
}
try {
  await wait(() => endpoint);
  const targets = await (
    await fetch(`http://127.0.0.1:${new URL(endpoint).port}/json/list`)
  ).json();
  socket = new WebSocket(
    targets.find((t) => t.type === "page").webSocketDebuggerUrl,
  );
  await new Promise((r, j) => {
    socket.onopen = r;
    socket.onerror = j;
  });
  let next = 0;
  const pending = new Map();
  socket.onmessage = async ({ data }) => {
    const v = JSON.parse(data);
    if (v.id) {
      const p = pending.get(v.id);
      pending.delete(v.id);
      v.error ? p.reject(Error(v.error.message)) : p.resolve(v.result);
    }
    if (v.method === "Network.requestWillBeSent")
      requests.set(v.params.requestId, v.params.request);
    if (v.method === "Network.responseReceived") {
      network.push({
        requestId: v.params.requestId,
        url: v.params.response.url,
        status: v.params.response.status,
      });
    }
    if (v.method === "Network.loadingFinished") {
      const row = network.findLast((r) => r.requestId === v.params.requestId);
      if (row) row.bytes = v.params.encodedDataLength;
    }
    if (v.method === "Network.webSocketClosed") socketClosed++;
    if (v.method === "Fetch.requestPaused")
      void ackHandler?.(v.params).catch((e) => {
        result.interceptionError = e.message;
      });
  };
  call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  evaluate = async (expression) => {
    const r = await call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails)
      throw Error(
        r.exceptionDetails.exception?.description || r.exceptionDetails.text,
      );
    return r.result.value;
  };
  const click = async (name) => {
    if (name.startsWith("History "))
      await wait(() =>
        evaluate(
          `[...document.querySelectorAll('.connect-conversation strong')].some(s=>s.textContent===${JSON.stringify(name)})`,
        ),
      );
    return evaluate(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(name)}||b.textContent.trim()===${JSON.stringify(name)}||(b.classList.contains('connect-conversation')&&b.querySelector('strong')?.textContent===${JSON.stringify(name)}));if(!b)throw Error('Missing '+${JSON.stringify(name)});b.click()})()`,
    );
  };
  const fill = async (selector, value) =>
    evaluate(
      `(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    );
  const stable = () =>
    evaluate(
      "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
    );
  const ids = () =>
    evaluate(
      `[...document.querySelectorAll('[data-message-id]')].map(r=>({id:r.dataset.messageId,sequence:+r.dataset.sequence,revision:+r.dataset.revision}))`,
    );
  const anchor = () =>
    evaluate(
      `(()=>{const h=document.querySelector('.connect-history');const top=h.getBoundingClientRect().top+h.clientTop;const r=[...h.querySelectorAll('[data-message-id]')].find(r=>r.getBoundingClientRect().bottom>top);return {id:r.dataset.messageId,sequence:+r.dataset.sequence,offset:r.getBoundingClientRect().top-top,scrollTop:h.scrollTop,scrollHeight:h.scrollHeight,clientHeight:h.clientHeight}})()`,
    );
  const position = async (sequence) => {
    await evaluate(
      `(()=>{const h=document.querySelector('.connect-history'),r=h.querySelector('[data-sequence="${sequence}"]');h.scrollTop+=r.getBoundingClientRect().top-h.getBoundingClientRect().top-h.clientTop+11;h.dispatchEvent(new Event('scroll',{bubbles:true}))})()`,
    );
    await stable();
    return anchor();
  };
  const checkAnchor = async (before) => {
    await stable();
    const after = await anchor();
    assert.equal(after.id, before.id, "Canonical anchor ID");
    const delta = Math.abs(after.offset - before.offset);
    assert(delta <= 1, `Anchor offset ${delta}px`);
    await stable();
    const second = await anchor();
    assert(Math.abs(second.offset - before.offset) <= 1);
    return { before, after, delta };
  };
  await call("Runtime.enable");
  await call("Network.enable");
  await call("Page.navigate", { url: f.proxy });
  await wait(() =>
    evaluate('!!document.querySelector("input[type=password]")'),
  );
  await fill("input[type=email]", f.email);
  await fill("input[type=password]", f.password);
  await evaluate('document.querySelector("form").requestSubmit()');
  await wait(() =>
    evaluate(
      '[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Connect")',
    ),
  );
  await click("Connect");
  await wait(() => evaluate('!!document.querySelector(".connect-layout")'));
  for (const fixture of f.fixtures) {
    const width = fixture.width;
    const metric = { width, status: "failed", anchors: [] };
    result.widths.push(metric);
    const root = `/api/companies/${f.company}/conversations/${fixture.a.id}`;
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await click(fixture.a.title);
    await wait(() =>
      evaluate('document.querySelectorAll("[data-message-id]").length===100'),
    );
    for (let page = 0; page < 2; page++) {
      const before = await position(page === 0 ? 170 : 70);
      await click("Load older messages");
      await wait(async () => (await ids()).length === (page === 0 ? 200 : 250));
      metric.anchors.push(await checkAnchor(before));
    }
    assert.deepEqual(
      (await ids()).map((r) => r.id),
      fixture.rows.map((r) => r.id),
    );
    metric.loadedRows = 250;
    let before = await position(20);
    const started = Date.now();
    const created = await api(root + "/messages", {
      clientMessageId: `${f.run}-${width}-live`,
      body: "Live incoming new message",
      replyToId: "",
      mentionIds: [],
      mentionAll: false,
    });
    await wait(async () => (await ids()).length === 251);
    metric.liveLagMs = Date.now() - started;
    metric.anchors.push(await checkAnchor(before));
    await wait(() =>
      evaluate('document.body.innerText.includes("1 new messages")'),
    );
    await click("1 new messages");
    await stable();
    assert(
      await evaluate(
        `(()=>{const h=document.querySelector('.connect-history');return h.scrollHeight-h.scrollTop-h.clientHeight<70})()`,
      ),
    );
    before = await position(20);
    await api(
      root + "/messages/" + fixture.rows[4].id,
      { expectedRevision: 1, body: "Updated old row five" },
      "PATCH",
    );
    await api(
      root + "/messages/" + fixture.rows[5].id,
      { expectedRevision: 1, removed: true },
      "PATCH",
    );
    await wait(() =>
      evaluate(
        `document.querySelector('[data-message-id="${fixture.rows[4].id}"]')?.dataset.revision==='2'&&document.querySelector('[data-message-id="${fixture.rows[5].id}"]')?.innerText.includes('Message removed')`,
      ),
    );
    metric.anchors.push(await checkAnchor(before));
    assert.equal((await ids()).length, 251);
    const watermark = network.length;
    await wait(
      () =>
        network
          .slice(watermark)
          .some(
            (r) =>
              r.url.endsWith("/conversations/" + fixture.a.id) &&
              r.status === 200,
          ),
      30000,
    );
    assert.equal((await ids()).length, 251);
    metric.realHeartbeatRetained = true;
    let cursor = "",
      page;
    do {
      page = (
        await api(
          root +
            "/sync" +
            (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
          undefined,
          "GET",
          f.readerCookie,
        )
      ).value;
      cursor = page.cursor;
    } while (page.hasMore);
    const baseline = cursor;
    const closedBefore = socketClosed;
    offline = true;
    for (const transport of transports) transport.destroy();
    await wait(() => socketClosed > closedBefore);
    metric.actualSocketClosed = true;
    const newRows = [];
    for (let i = 1; i <= 125; i++)
      newRows.push(
        (
          await api(root + "/messages", {
            clientMessageId: `${f.run}-${width}-missed-${i}`,
            body: "Missed event " + i,
            replyToId: "",
            mentionIds: [],
            mentionAll: false,
          })
        ).value.message,
      );
    await api(
      root + "/messages/" + fixture.rows[6].id,
      { expectedRevision: 1, body: "Edited through disconnect" },
      "PATCH",
    );
    await api(
      root + "/messages/" + fixture.rows[7].id,
      { expectedRevision: 1, removed: true },
      "PATCH",
    );
    const replay = [];
    const eventIds = [];
    let bytes = 0;
    cursor = baseline;
    do {
      const response = await api(
        root + "/sync?cursor=" + encodeURIComponent(cursor),
        undefined,
        "GET",
        f.readerCookie,
      );
      page = response.value;
      bytes += response.bytes;
      replay.push(page.events.length);
      eventIds.push(...page.events.map((e) => e.id));
      cursor = page.cursor;
    } while (page.hasMore);
    assert.deepEqual(replay, [100, 27]);
    assert.equal(new Set(eventIds).size, 127);
    metric.oracleReplayPages = replay;
    metric.oracleReplayBytes = bytes;
    const networkStart = network.length;
    const resume = Date.now();
    offline = false;
    await wait(async () => (await ids()).length === 376);
    await wait(() =>
      evaluate(
        `document.querySelector('[data-message-id="${fixture.rows[6].id}"]')?.dataset.revision==='2'&&document.querySelector('[data-message-id="${fixture.rows[7].id}"]')?.innerText.includes('Message removed')`,
      ),
    );
    metric.catchUpMs = Date.now() - resume;
    metric.anchors.push(await checkAnchor(before));
    const loaded = await ids();
    assert.equal(new Set(loaded.map((r) => r.id)).size, 376);
    assert.deepEqual(
      loaded.map((r) => r.sequence),
      Array.from({ length: 376 }, (_, i) => i + 1),
    );
    metric.catchUpRequests = network
      .slice(networkStart)
      .filter((r) => r.url.includes("/conversations/" + fixture.a.id)).length;
    metric.catchUpWireBytes = network
      .slice(networkStart)
      .reduce((n, r) => n + (r.bytes || 0), 0);
    const marker = `Authored retry ${width}`;
    let accepted = null,
      originalBody = null;
    let failed = false;
    const protocol = await (
      await fetch(`http://127.0.0.1:${new URL(endpoint).port}/json/protocol`)
    ).json();
    assert(
      protocol.domains
        .find((d) => d.domain === "Fetch")
        .commands.some((c) => c.name === "getResponseBody"),
    );
    ackHandler = async (p) => {
      if (
        !failed &&
        p.request.method === "POST" &&
        p.request.postData?.includes(marker) &&
        p.responseStatusCode === 200
      ) {
        const raw = await call("Fetch.getResponseBody", {
          requestId: p.requestId,
        });
        accepted = JSON.parse(
          raw.base64Encoded
            ? Buffer.from(raw.body, "base64").toString()
            : raw.body,
        ).message;
        originalBody = JSON.parse(p.request.postData);
        failed = true;
        await call("Fetch.failRequest", {
          requestId: p.requestId,
          errorReason: "Failed",
        });
      } else await call("Fetch.continueRequest", { requestId: p.requestId });
    };
    await call("Fetch.enable", {
      patterns: [
        { urlPattern: f.proxy + root + "/messages", requestStage: "Response" },
      ],
    });
    await fill(".connect-composer textarea", marker);
    await evaluate(
      'document.querySelector(".connect-composer").requestSubmit()',
    );
    await wait(() => failed);
    await wait(() =>
      evaluate('document.body.innerText.includes("Retry same message")'),
    );
    assert(accepted?.id);
    await call("Fetch.disable");
    ackHandler = null;
    await click("Back to conversations");
    await click(fixture.b.title);
    await wait(() =>
      evaluate('!!document.querySelector(".connect-composer textarea")'),
    );
    assert.equal(
      await evaluate(
        'document.querySelector(".connect-composer textarea").value',
      ),
      "",
    );
    await fill(".connect-composer textarea", "Isolated B draft");
    await click("Back to conversations");
    await click(fixture.a.title);
    await wait(() =>
      evaluate(
        '!!document.querySelector(".connect-composer textarea")&&document.body.innerText.includes("Retry same message")',
      ),
    );
    assert.equal(
      await evaluate(
        'document.querySelector(".connect-composer textarea").value',
      ),
      marker,
    );
    const beforeRetry = new Set(requests.keys());
    await click("Retry same message");
    await wait(() =>
      evaluate('!document.querySelector(".connect-composer textarea").value'),
    );
    const retry = [...requests].find(
      ([id, r]) =>
        !beforeRetry.has(id) &&
        r.method === "POST" &&
        r.url.endsWith(root + "/messages") &&
        r.postData?.includes(marker),
    );
    assert(retry);
    assert.deepEqual(JSON.parse(retry[1].postData), originalBody);
    const canonical = (
      await api(root + "/messages", undefined, "GET", f.readerCookie)
    ).value.messages.filter(
      (m) => m.clientMessageId === originalBody.clientMessageId,
    );
    assert.equal(canonical.length, 1);
    assert.equal(canonical[0].id, accepted.id);
    metric.lostAckCanonical = true;
    await wait(async () => (await ids()).length === 377);
    before = await position(20);
    await click("Tasks");
    await wait(() => evaluate('!document.querySelector(".connect-history")'));
    await click("Connect");
    await wait(async () => (await ids()).length === 377);
    metric.anchors.push(await checkAnchor(before));
    metric.moduleReturnRetained = true;
    // Foreground thread GET never replaces the loaded range.
    await evaluate(
      `document.querySelector('[data-message-id="${fixture.rows[19].id}"] button:nth-of-type(2)')?.click()`,
    );
    await wait(() => evaluate('!!document.querySelector("[role=dialog]")'));
    assert.equal((await ids()).length, 377);
    await evaluate(
      `document.querySelector('[role="dialog"] button[aria-label="Close dialog"]')?.click()`,
    );

    await stable();
    metric.geometry = await evaluate(
      `(()=>{const h=document.querySelector('.connect-history'),c=document.querySelector('.connect-compose-area'),nav=document.querySelector('.mobile-bottom-nav');return {pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,historyHeight:h.clientHeight,composerBottom:c.getBoundingClientRect().bottom,navTop:nav?.getBoundingClientRect().top??innerHeight}})()`,
    );
    assert(metric.geometry.pageWidth <= width);
    assert(metric.geometry.historyHeight > 0);
    assert(metric.geometry.composerBottom <= metric.geometry.navTop + 1);
    await writeFile(
      join(f.output, `history-${width}.png`),
      Buffer.from(
        (await call("Page.captureScreenshot", { format: "png" })).data,
        "base64",
      ),
    );
    const authored = `Retain authored input ${width}`;
    await fill(".connect-composer textarea", authored);
    const quoteId = fixture.rows[9].id;
    await evaluate(
      `document.querySelector('[data-message-id="${quoteId}"] .connect-message-actions button')?.click()`,
    );
    await wait(() =>
      evaluate(
        'document.querySelector(".connect-composer").innerText.includes("Reply to")',
      ),
    );
    await api(
      root + "/messages/" + quoteId,
      { expectedRevision: 1, body: "Current precise target " + width },
      "PATCH",
    );
    await wait(() =>
      evaluate(
        '!document.querySelector(".connect-composer").innerText.includes("Reply to")',
      ),
    );
    assert.equal(
      await evaluate(
        'document.querySelector(".connect-composer textarea").value',
      ),
      authored,
    );
    metric.sourceQuoteClearedDraftRetained = true;
    await evaluate(
      `(()=>{const summary=[...document.querySelectorAll('summary')].find(s=>s.textContent==='Mentions in loaded history');summary?.click()})()`,
    );
    await click("Current precise target " + width);
    await stable();
    assert(
      await evaluate(
        `(()=>{const row=document.querySelector('[data-message-id="${quoteId}"]'),h=document.querySelector('.connect-history');const r=row.getBoundingClientRect(),v=h.getBoundingClientRect();return r.bottom>v.top&&r.top<v.bottom})()`,
      ),
    );
    metric.loadedMentionPreciseTarget = true;
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height: 520,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await stable();
    metric.resizedViewportGeometry = await evaluate(
      `(()=>{const h=document.querySelector('.connect-history'),c=document.querySelector('.connect-compose-area'),nav=document.querySelector('.mobile-bottom-nav');return {historyHeight:h.clientHeight,composerBottom:c.getBoundingClientRect().bottom,navTop:nav?.getBoundingClientRect().top??innerHeight}})()`,
    );
    assert(metric.resizedViewportGeometry.historyHeight > 0);
    assert(
      metric.resizedViewportGeometry.composerBottom <=
        metric.resizedViewportGeometry.navTop + 1,
    );
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await api(root + "/members", {
      expectedVersion: 1,
      userId: f.readerId,
      role: "member",
      active: false,
    });
    await wait(async () => (await ids()).length === 0);
    assert.equal(
      await evaluate(
        'document.querySelector(".connect-composer textarea")?.value??""',
      ),
      "",
    );
    const denied = await fetch(
      f.backend + root + "/messages/" + fixture.rows[19].id + "/thread",
      { headers: { Cookie: f.readerCookie, Origin: f.backend } },
    );
    assert.equal(denied.status, 404);
    await wait(() =>
      evaluate(
        `![...document.querySelectorAll('strong')].some(s=>s.textContent===${JSON.stringify(fixture.a.title)})`,
      ),
    );
    metric.revokedPrivateTitleCleared = true;
    await api(root + "/members", {
      expectedVersion: 2,
      userId: f.readerId,
      role: "member",
      active: true,
    });
    await click("Tasks");
    await click("Connect");
    await wait(() =>
      evaluate(
        `[...document.querySelectorAll('strong')].some(s=>s.textContent===${JSON.stringify(fixture.a.title)})`,
      ),
    );
    await click(fixture.a.title);
    await wait(() =>
      evaluate('!!document.querySelector(".connect-composer textarea")'),
    );
    assert.equal((await ids()).length, 0);
    assert.equal(
      await evaluate(
        'document.querySelector(".connect-composer textarea").value',
      ),
      "",
    );
    metric.revokedDraftAndHistoryCleared = true;
    metric.status = "passed";
    await click("Back to conversations");
  }
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await click(f.fixtures[0].b.title);
  await wait(() =>
    evaluate('!!document.querySelector(".connect-composer textarea")'),
  );
  await stable();
  result.desktopGeometry = await evaluate(
    `(()=>{const h=document.querySelector('.connect-history'),c=document.querySelector('.connect-compose-area');return {pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,historyHeight:h.clientHeight,composerBottom:c.getBoundingClientRect().bottom,viewportBottom:innerHeight}})()`,
  );
  assert(result.desktopGeometry.pageWidth <= 1280);
  assert(result.desktopGeometry.historyHeight > 0);
  assert(result.desktopGeometry.composerBottom <= 900);
  await writeFile(
    join(f.output, "history-desktop.png"),
    Buffer.from(
      (await call("Page.captureScreenshot", { format: "png" })).data,
      "base64",
    ),
  );
  result.status = "passed";
  result.browser = (await call("Browser.getVersion")).product;
  result.maxAnchorDeltaPx = Math.max(
    ...result.widths.flatMap((w) => w.anchors.map((a) => a.delta)),
  );
  result.scope =
    "Actual owned HTTP/WebSocket/Chromium; separate deterministic backend overflow required. Physical gates unchecked.";
} catch (e) {
  result.error = e.message;
  console.error(e);
  process.exitCode = 1;
  if (evaluate)
    result.visibleButtons = await evaluate(
      `[...document.querySelectorAll('button')].map(b=>b.textContent.trim())`,
    ).catch(() => []);
  if (evaluate)
    result.alerts = await evaluate(
      `[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent)`,
    ).catch(() => []);
} finally {
  await writeFile(
    join(f.output, "browser-result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  socket?.close();
  browser.kill("SIGTERM");
  for (const transport of transports) transport.destroy();
  proxy.close();
  await delay(200);
  await rm(profile, { recursive: true, force: true });
  console.log(
    JSON.stringify({
      status: result.status,
      widths: result.widths.map((w) => ({ width: w.width, status: w.status })),
      error: result.error,
    }),
  );
}
