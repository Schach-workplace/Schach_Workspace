// Execute only this project's compiled preview in a simulated DOM. No visual QA claim.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SourceTextModule } from 'node:vm';
import { Window } from 'happy-dom';

const html = await readFile(new URL('../../preview.html', import.meta.url), 'utf8');
const inspection = new Window({ settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
inspection.document.write(html);
const errors = [];
const checks = [];
const externalRequests = [];
function check(name, condition) {
  assert.ok(condition, name);
  checks.push(name);
}
const window = new Window({
  url: 'https://preview.invalid',
  console: { ...console, error: (...args) => errors.push(args.map(String).join(' ')) },
  settings: {
    // This is our freshly compiled application, not external/untrusted JavaScript.
    enableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
    suppressInsecureJavaScriptEnvironmentWarning: true,
  },
});
window.structuredClone = globalThis.structuredClone; // Browser API absent from Happy DOM.
window.fetch = async (...args) => { externalRequests.push({ kind: 'fetch', target: String(args[0]) }); throw new Error('The self-contained preview requested a network resource.'); };
window.addEventListener('error', (event) => errors.push(event.message));
async function until(predicate) {
  for (let i = 0; i < 60; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Compiled preview did not reach its expected DOM state. ${errors.join('; ')}`);
}
try {
  check('No external script or stylesheet is needed', !/<script[^>]*\bsrc=/.test(html) && !/<link[^>]*rel="stylesheet"/.test(html));
  check('CSS assets are embedded', !/url\((?!["']?data:)[^)]*\)/.test(html));
  const script = inspection.document.querySelector('script[type="module"]')?.textContent;
  check('Exactly one compiled application is embedded', !!script && inspection.document.querySelectorAll('script').length === 1);
  window.document.write(html.replace(/<script\b[\s\S]*?<\/script>/gi, ''));
  // Native module parsing handles nested import.meta that the DOM emulator's
  // module transformer cannot parse. All imports remain forbidden in the demo.
  const module = new SourceTextModule(script, {
    context: window,
    identifier: 'https://preview.invalid/preview.html',
    initializeImportMeta(meta) {
      meta.url = 'https://preview.invalid/preview.html';
      meta.resolve = (specifier) => new URL(specifier, meta.url).href;
    },
    importModuleDynamically(specifier) {
      externalRequests.push({ kind: 'dynamic module', target: specifier });
      throw new Error('The self-contained preview requested another module.');
    },
  });
  await module.link((specifier) => { externalRequests.push({ kind: 'static module', target: specifier }); throw new Error('The self-contained preview imports another module.'); });
  await module.evaluate();
  await until(() => window.document.querySelector('h1')?.textContent === 'Your business, in focus.');
  check('Compiled application mounts the leadership overview', true);
  check('Brand images are embedded', [...window.document.querySelectorAll('img')].every((image) => image.src.startsWith('data:image/')));
  const financeNav = [...window.document.querySelectorAll('nav[aria-label="Main navigation"] button')].find(button => button.textContent.trim() === 'Finance');
  assert.ok(financeNav, 'Finance navigation exists');
  financeNav.click();
  await until(() => window.document.querySelector('[aria-label="Financial year totals"]'));
  check('Compiled finance view renders company totals and department budgets', !!window.document.querySelector('[aria-label="Department budgets"]'));
  const engineering = [...window.document.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === 'View Engineering finances');
  assert.ok(engineering, 'Engineering department drilldown exists');
  engineering.click();
  await until(() => window.document.querySelector('.finance-budget-card'));
  check('Department drilldown shows its real allocation and expense records', window.document.body.textContent.includes('Engineering budgets') && window.document.body.textContent.includes('Design software annual renewal'));
  const company = window.document.querySelector('select[aria-label="Switch company"]');
  check('Both demonstration companies are available', company?.options.length === 2);
  company.value = 'c-meridian';
  company.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  const taskNav = [...window.document.querySelectorAll('nav[aria-label="Main navigation"] button')].find((button) => button.textContent.trim().startsWith('All tasks'));
  assert.ok(taskNav, 'Task navigation exists');
  taskNav.click();
  await until(() => window.document.querySelector('table')?.textContent.includes('Confirm mobilisation checklist'));
  check('Company switch and task navigation use the second company data', window.document.querySelectorAll('table tbody tr').length === 4);
  const secondFinanceNav = [...window.document.querySelectorAll('nav[aria-label="Main navigation"] button')].find(button => button.textContent.trim() === 'Finance');
  secondFinanceNav.click();
  await until(() => window.document.body.textContent.includes('Northstar site mobilisation visit'));
  check('Second company financial records stay separate in the compiled preview', !window.document.body.textContent.includes('Design software annual renewal'));
  const connectNav = [...window.document.querySelectorAll('nav[aria-label="Main navigation"] button')].find(button => button.textContent.trim() === 'Connect');
  assert.ok(connectNav, 'Connect navigation exists');
  connectNav.click();
  await until(() => window.document.body.textContent.includes('Connect requires the shared server'));
  check('Offline Connect states its actual shared-server requirement', true);
  const assistance = window.document.querySelector('button[aria-label="Local assistance history"]');
  assert.ok(assistance, 'Manual assistance entry exists');
  assistance.click();
  await until(() => window.document.body.textContent.includes('Local inference is unavailable in demo mode. Continue manually.'));
  check('Offline assistance preserves the explicit local-provider-unavailable manual flow', true);
  check('No external module or fetch was attempted, including caught failures', externalRequests.length === 0);
  check('No application error was reported during the compiled flow', errors.length === 0);
  const result = {
    status: 'passed',
    checkedAt: new Date().toISOString(),
    checks: checks.length,
    details: checks,
    scope: 'Compiled self-contained artifact executed in Happy DOM. Asset completeness and DOM interactions only; no real browser, device, screenshot or layout verification.',
  };
  await writeFile(new URL('../../verification/preview-result.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'passed', checks: checks.length, bytes: Buffer.byteLength(html), artifact: fileURLToPath(new URL('../../preview.html', import.meta.url)) }));
} finally {
  await window.happyDOM.abort();
  await inspection.happyDOM.abort();
}
