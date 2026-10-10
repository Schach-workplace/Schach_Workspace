// Native Chromium smoke against an explicitly disposable demo server.
// Start Chromium with --remote-debugging-port=19222 and a separate profile.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = process.env.SCHACH_SMOKE_URL || 'http://127.0.0.1:18081';
const targets = await (await fetch('http://127.0.0.1:19222/json/list')).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let next = 0;
const pending = new Map();
const errors = [];
ws.onmessage = ({ data }) => {
  const value = JSON.parse(data);
  if (value.id) {
    const promise = pending.get(value.id);
    pending.delete(value.id);
    if (value.error) promise.reject(new Error(value.error.message));
    else promise.resolve(value.result);
  }
  if (value.method === 'Runtime.exceptionThrown') errors.push(value.params.exceptionDetails.text);
};
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const value = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.text);
  return value.result.value;
}
async function until(expression) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${expression}`);
}
const checks = [];
try {
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Page.navigate', { url: base });
  await until('!!document.querySelector("input[type=password]")');
  checks.push('API build renders sign-in in native Chromium');
  await evaluate(`(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const [selector, value] of [['input[type=email]', 'founder@schach.demo'], ['input[type=password]', 'SchachDemo!2026']]) {
      const input = document.querySelector(selector);
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  await evaluate('document.querySelector("form").requestSubmit()');
  await until('document.body.innerText.includes("Finance") && !document.querySelector("input[type=password]")');
  checks.push('Founder signs in through the rendered form against native PostgreSQL');
  await evaluate(`Array.from(document.querySelectorAll('button,a')).find(e => e.textContent.trim() === 'Finance').click()`);
  await until('document.body.innerText.includes("Department budgets") || document.body.innerText.includes("Budget availability")');
  checks.push('Finance navigation renders server-backed department budgets');
  assert.equal(errors.length, 0, errors.join('; '));
  checks.push('No uncaught JavaScript exceptions during sign-in and finance navigation');
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(new URL('./browser-postgres.png', import.meta.url), Buffer.from(shot.data, 'base64'));
  const result = { status: 'passed', base, checks, browser: await call('Browser.getVersion') };
  await fs.writeFile(new URL('./browser-result.json', import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, checks: checks.length }));
} finally {
  ws.close();
}
