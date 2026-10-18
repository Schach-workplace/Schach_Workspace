// Compiled web app plus actual fictional API in mobile WebKit/Chromium profiles.
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
const pw = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : "playwright"
);
const base = process.env.SCHACH_SMOKE_URL;
assert(process.argv.includes("--allow-demo-mutations"));
assert(
  new URL(base).hostname === "127.0.0.1" && new URL(base).port === "9092",
  "Use the newly owned9092 fictional fixture",
);
const out = new URL("./web-api/", import.meta.url);
await mkdir(out, { recursive: true });
const result = {
  qualification:
    "Real compiled web and fictional API under mobile browser emulation. No native iOS/Android or provider acceptance.",
  cases: [],
  errors: [],
  expectedAnonymousDenials: [],
  consoleDiagnostics: [],
  external: [],
};
for (const [engine, device] of [
  ["webkit", "iPhone SE (3rd gen)"],
  ["chromium", "Pixel 5"],
]) {
  const b = await pw[engine].launch({
    headless: true,
    ...(engine === "chromium" ? { executablePath: "/usr/bin/chromium" } : {}),
  });
  const options = {
    ...pw.devices[device],
    deviceScaleFactor: 1,
    timezoneId: "Asia/Kolkata",
  };
  delete options.defaultBrowserType;
  const context = await b.newContext(options);
  let current = "sign-in";
  try {
    await context.route("**/*", async (route) => {
      const u = route.request().url();
      if (/^(http|ws)s?:/.test(u) && !u.startsWith(base + "/")) {
        result.external.push({ engine, current, url: new URL(u).origin });
        await route.abort();
      } else await route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) =>
      result.errors.push({ engine, current, error: e.message }),
    );
    page.on("response", (r) => {
      if (
        r.status() === 401 &&
        r.request().method() === "GET" &&
        r.url() === base + "/api/auth/session" &&
        current === "sign-in"
      )
        result.expectedAnonymousDenials.push({
          engine,
          path: "/api/auth/session",
          status: 401,
        });
      else if (r.status() >= 400)
        result.errors.push({
          engine,
          current,
          error:
            "Unexpected HTTP " + r.status() + " " + new URL(r.url()).pathname,
        });
    });
    page.on("console", (m) => {
      if (m.type() === "error") {
        const entry = {
          engine,
          current,
          error: m.text(),
          location: m.location(),
        };
        result.consoleDiagnostics.push(entry);
        if (!(
          current === "sign-in" &&
          m.location().url === base + "/api/auth/session" &&
          /401/.test(m.text())
        ))
          result.errors.push(entry);
      }
    });
    await page.goto(base, { waitUntil: "networkidle" });
    await page.locator("input[type=email]").fill("founder@schach.demo");
    await page.locator("input[type=password]").fill("SchachDemo!2026");
    await page.locator("form button[type=submit]").click();
    await page.locator("input[type=password]").waitFor({ state: "detached" });
    result.cases.push({
      engine,
      name: "Fictional actual API sign-in",
      status: "PASS",
    });
    for (const view of [
      "connect",
      "overview",
      "my-work",
      "tasks",
      "projects",
      "calendar",
      "workload",
      "goals",
      "finance",
      "reports",
      "people",
      "inbox",
      "settings",
    ]) {
      current = view;
      const r = { engine, view, status: "FAIL" };
      try {
        await page.goto(base + "/#" + view, { waitUntil: "networkidle" });
        await page.locator("main").waitFor();
        const identity = {
          connect: "Company conversations and accountable work.",
          overview: "Your business, in focus.",
          "my-work":
            "Your priorities, commitments and reviews. All in one place.",
          tasks:
            "Clear ownership. Visible progress. Nothing lost in the follow-up.",
          projects: "Bring people and work together around a shared outcome.",
          calendar: "Deadlines in Asia/Kolkata",
          workload: "Planning authorized work",
          goals: "Measured outcomes",
          finance:
            "Plan department budgets, review spending and keep every decision accountable.",
          reports: "Current state",
          people: "Active people",
          inbox: "Resolve this Inbox item; this does not approve the work.",
          settings: "Company details",
        }[view];
        await page
          .locator("main")
          .getByText(identity, { exact: false })
          .first()
          .waitFor();
        if (view === "connect")
          await page
            .getByLabel("Filter conversations", { exact: true })
            .waitFor();
        r.heading = await page.locator("main").innerText();
        r.heading = r.heading.slice(0, 160);
        assert(
          !(await page.locator("input[type=password]").count()),
          "Authenticated route returned to sign-in",
        );
        r.width = await page.evaluate(() => ({
          viewport: innerWidth,
          document: document.documentElement.scrollWidth,
        }));
        assert(
          r.width.document <= r.width.viewport + 1,
          "Horizontal document overflow",
        );
        await page.screenshot({
          path: fileURLToPath(new URL(engine + "-" + view + ".png", out)),
        });
        r.status = "PASS";
      } catch (e) {
        r.error = e.message;
      }
      result.cases.push(r);
    }
    // Exercise a real native-file-adjacent workflow in both browser engines.
    current = "calendar-export";
    const r = { engine, name: current, status: "FAIL" };
    try {
      await page.goto(base + "/#calendar", { waitUntil: "networkidle" });
      await page
        .getByRole("button", { name: "Export calendar", exact: true })
        .click();
      await page
        .getByLabel("I reviewed the export fields and external audience")
        .check();
      const download = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Download calendar file", exact: true })
        .click();
      const d = await download;
      const text = await readFile(await d.path(), "utf8");
      assert(
        text.includes("BEGIN:VCALENDAR") && text.includes("END:VCALENDAR"),
      );
      r.status = "PASS";
      r.bytes = Buffer.byteLength(text);
    } catch (e) {
      r.error = e.message;
    }
    result.cases.push(r);
  } catch (e) {
    result.cases.push({
      engine,
      name: current,
      status: "FAIL",
      error: e.message,
    });
  } finally {
    await context.close();
    await b.close();
  }
  console.log(
    engine,
    result.cases.filter((x) => x.engine === engine && x.status === "FAIL"),
  );
}
result.summary = {
  passed: result.cases.filter((x) => x.status === "PASS").length,
  failed: result.cases.filter((x) => x.status === "FAIL").length,
  errors: result.errors.length,
  external: result.external.length,
};
result.status = Object.values(result.summary)
  .slice(1)
  .some((x) => x)
  ? "FAIL"
  : "PASS";
await writeFile(
  new URL("./web-api-result.json", import.meta.url),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result.summary));
if (result.status !== "PASS") process.exitCode = 1;
