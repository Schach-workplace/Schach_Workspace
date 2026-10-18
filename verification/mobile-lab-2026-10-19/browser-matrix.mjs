// Actual RN Web components in real WebKit/Chromium, with explicit fictional boundaries.
// This is mobile-browser emulation, never native iOS/Android certification.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
const modulePath = process.env.PLAYWRIGHT_MODULE;
const pw = await import(
  modulePath ? pathToFileURL(modulePath).href : "playwright"
);
const out = new URL("./browser/", import.meta.url);
await mkdir(out, { recursive: true });
const profiles = [
  ["ios-small", "webkit", "iPhone SE (3rd gen)"],
  ["ios-large", "webkit", "iPhone 15 Pro Max"],
  ["android-pixel", "chromium", "Pixel 5"],
  ["android-galaxy", "chromium", "Galaxy S24"],
];
const screens = {
  login: "Your work, conversations and company in one place.",
  modules: "Explore your workspace",
  work: "Search work",
  finance: "Track expenses from draft to payment.",
  reports: "Report basis",
  inbox: "Decisions and updates, clearly separated.",
  connect: "People, teams and company channels",
  chat: "Please review the selected drawings",
  overview: "Read-only · current role and company scope",
  workload: "Visible remaining effort",
  planning: "Planning authorized work",
  agenda: "Deadline agenda",
  goals: "Measured outcomes",
  people: "Company directory and access",
  account: "Notifications, devices and account security",
  project: "Fictional Project",
  growth: "Your learning, evidence and mentor conversations.",
  knowledge: "Reviewed guidance for engineering, office and field work.",
};
const results = {
  qualification:
    "Real WebKit/Chromium mobile browser profiles and actual current RN Web components with fictional Workspace/client/native-boundary fixtures. Native OS controls, device keyboards, screen readers, calls/push and physical iOS are not covered.",
  profiles: [],
  cases: [],
  errors: [],
  blockedExternalRequests: [],
};
function url(view, extra = "") {
  return `http://127.0.0.1:${["login", "modules"].includes(view) ? 5186 : 5187}/?view=${view}${extra}`;
}
const filter = process.env.LAB_SCREEN_FILTER;
const engines = {};
async function bounds(page) {
  return page.evaluate(() => {
    const width = innerWidth;
    const contained = (e, axis) => {
      for (let p = e.parentElement; p; p = p.parentElement)
        if (/auto|scroll|hidden|clip/.test(getComputedStyle(p)[axis]))
          return true;
      return false;
    };
    return {
      width,
      documentWidth: document.documentElement.scrollWidth,
      overflow: [
        ...document.querySelectorAll('[dir="auto"],input,button,[role=button]'),
      ]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return (
            r.width > 0 &&
            r.height > 0 &&
            (r.right > width + 1 || r.left < -1) &&
            !contained(e, "overflowX")
          );
        })
        .map((e) => ({
          text: (e.getAttribute("aria-label") || e.textContent).slice(0, 80),
          right: e.getBoundingClientRect().right,
        }))
        .slice(0, 12),
      headingClipping: [
        ...document.querySelectorAll('[data-testid="screen-heading"]'),
      ].flatMap((h) => {
        const box = h.getBoundingClientRect();
        return [...h.querySelectorAll('[dir="auto"]')]
          .filter((e) => e.getBoundingClientRect().bottom > box.bottom + 1)
          .map((e) => e.textContent.slice(0, 80));
      }),
    };
  });
}
async function capture(page, name, bottom = false) {
  await page.screenshot({
    path: fileURLToPath(new URL(name + ".png", out)),
    animations: "disabled",
  });
  if (bottom) {
    await page.evaluate(() => {
      for (const e of document.querySelectorAll("div"))
        if (
          e.scrollHeight > e.clientHeight + 20 &&
          /(auto|scroll)/.test(getComputedStyle(e).overflowY)
        )
          e.scrollTop = e.scrollHeight;
    });
    await page.screenshot({
      path: fileURLToPath(new URL(name + "-bottom.png", out)),
      animations: "disabled",
    });
  }
}
try {
  for (const [profile, engine, device] of profiles) {
    if (!engines[engine])
      engines[engine] = await pw[engine].launch({
        headless: true,
        ...(engine === "chromium"
          ? { executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium" }
          : {}),
      });
    const options = {
      ...pw.devices[device],
      deviceScaleFactor: 1,
      locale: "en-IN",
      timezoneId: "Asia/Kolkata",
      reducedMotion: "reduce",
    };
    delete options.defaultBrowserType;
    const context = await engines[engine].newContext(options);
    let current = "startup";
    await context.route("**/*", async (route) => {
      const u = new URL(route.request().url());
      if (
        ["http:", "https:", "ws:", "wss:"].includes(u.protocol) &&
        !(
          ["127.0.0.1", "localhost"].includes(u.hostname) &&
          ["5186", "5187"].includes(u.port)
        )
      ) {
        results.blockedExternalRequests.push({
          profile,
          current,
          url: u.origin,
        });
        await route.abort();
      } else await route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", (e) =>
      results.errors.push({ profile, current, error: e.message }),
    );
    page.on("console", (m) => {
      if (m.type() === "error")
        results.errors.push({ profile, current, error: m.text() });
    });
    results.profiles.push({
      name: profile,
      engine,
      engineVersion: engines[engine].version(),
      device,
      options,
    });
    const checks = Object.keys(screens).map((view) => ({
      view,
      mode: "portrait",
    }));
    if (["ios-small", "android-pixel"].includes(profile)) {
      checks.push(
        ...[
          "work",
          "finance",
          "reports",
          "inbox",
          "connect",
          "overview",
          "workload",
          "planning",
          "agenda",
          "goals",
          "growth",
          "knowledge",
        ].map((view) => ({ view, mode: "large" })),
      );
      checks.push(
        ...["work", "chat", "finance"].map((view) => ({
          view,
          mode: "landscape",
        })),
      );
      checks.push(
        ...["login", "work", "chat"].map((view) => ({ view, mode: "short" })),
      );
      checks.push(
        ...["work", "finance", "connect", "inbox", "growth", "knowledge"].map(
          (view) => ({ view, mode: "empty" }),
        ),
      );
    }
    for (const { view, mode } of checks.filter(
      (c) => !filter || c.view === filter,
    )) {
      current = view + "-" + mode;
      const record = { profile, engine, view, mode, status: "FAIL" };
      try {
        await page.setViewportSize(
          mode === "landscape"
            ? { width: 844, height: 390 }
            : mode === "short"
              ? { width: 320, height: 568 }
              : options.viewport,
        );
        await page.goto(
          url(
            view,
            mode === "empty" ? "&empty" : mode === "large" ? "&long" : "",
          ),
          { waitUntil: "networkidle" },
        );
        if (view === "work")
          await page.getByLabel("Search work").waitFor({ state: "attached" });
        else
          await page
            .getByText(screens[view], { exact: false })
            .first()
            .waitFor({ state: "attached" });
        if (mode === "large")
          await page.evaluate(() => {
            for (const e of document.querySelectorAll('[dir="auto"],input')) {
              const s = getComputedStyle(e);
              e.style.fontSize = parseFloat(s.fontSize) * 1.6 + "px";
              e.style.lineHeight =
                parseFloat(s.lineHeight || s.fontSize) * 1.6 + "px";
            }
          });
        await page.waitForTimeout(100);
        record.layout = await bounds(page);
        await capture(
          page,
          `${profile}-${view}-${mode}`,
          ["large", "short", "landscape"].includes(mode),
        );
        assert(
          record.layout.documentWidth <= record.layout.width + 1,
          "Document horizontal overflow",
        );
        assert.equal(
          record.layout.overflow.length,
          0,
          "Uncontained horizontal content overflow",
        );
        assert.equal(
          record.layout.headingClipping.length,
          0,
          "Heading clipping",
        );
        record.status = "PASS";
      } catch (e) {
        record.error = e.message;
        await capture(page, `${profile}-${view}-${mode}-failure`).catch(
          () => {},
        );
      }
      results.cases.push(record);
      if (record.status === "FAIL") console.log(profile, current, record.error);
    }
    // Actual touch/input interactions through existing presentation controls.
    const interact = async (name, view, fn) => {
      current = name;
      const r = {
        profile,
        engine,
        view,
        mode: "interaction",
        name,
        status: "FAIL",
      };
      try {
        await page.setViewportSize(options.viewport);
        await page.goto(url(view), { waitUntil: "networkidle" });
        await fn(page);
        r.layout = await bounds(page);
        assert(
          r.layout.documentWidth <= r.layout.width + 1,
          "Interaction document overflow",
        );
        await capture(page, `${profile}-${name}`, true);
        r.status = "PASS";
      } catch (e) {
        r.error = e.message;
        await capture(page, `${profile}-${name}-failure`).catch(() => {});
      }
      results.cases.push(r);
    };
    if (!filter && ["ios-small", "android-pixel"].includes(profile)) {
      await interact("login-password-verification", "login", async (p) => {
        await p
          .getByLabel("Email", { exact: true })
          .fill("fictional@example.invalid");
        await p.getByLabel("Password", { exact: true }).fill("Fictional-only");
        await p
          .getByRole("button", { name: "Show password", exact: true })
          .tap();
        assert.equal(
          await p
            .getByLabel("Password", { exact: true })
            .evaluate((e) => e.type),
          "text",
        );
        await p
          .getByRole("button", { name: "Hide password", exact: true })
          .tap();
        assert.equal(
          await p
            .getByLabel("Password", { exact: true })
            .evaluate((e) => e.type),
          "password",
        );
        await p
          .getByRole("button", {
            name: "Use authenticator or recovery code",
            exact: true,
          })
          .tap();
        await p.getByText("Additional verification", { exact: true }).waitFor();
      });
      await interact("module-search-reset", "modules", async (p) => {
        await p.getByLabel("Search modules").fill("no-such-module");
        await p.getByText("No matching modules", { exact: false }).waitFor();
        await p.getByLabel("Search modules").fill("Knowledge");
        assert(await p.getByRole("button", { name: /Knowledge/ }).count());
        await p.getByLabel("Search modules").fill("");
        await p.getByText("Plan & deliver", { exact: true }).waitFor();
      });
      await interact("work-search-and-tools", "work", async (p) => {
        await p.getByLabel("Search work").fill("no-such-work");
        await p
          .getByText("No work matches these filters.", { exact: false })
          .waitFor();
        await p.getByLabel("Search work").fill("");
        await p.getByRole("button", { name: "Work tools", exact: true }).tap();
        await p.getByText("Tasks CSV", { exact: false }).first().waitFor();
      });
      await interact("connect-search-clear", "connect", async (p) => {
        await p.getByLabel("Filter conversations").fill("no-such-person");
        await p
          .getByText("No matching conversations", { exact: false })
          .waitFor();
        await p.getByLabel("Filter conversations").fill("");
        await p.getByRole("button", { name: "Unread", exact: true }).tap();
        await p.getByText("Unread conversations", { exact: false }).waitFor();
      });
      await interact("chat-tools", "chat", async (p) => {
        await p.getByRole("button", { name: /Conversation tools/ }).tap();
        await p.getByRole("button", { name: "Details", exact: true }).waitFor();
      });
      await interact("growth-editor", "growth", async (p) => {
        await p
          .getByRole("button", { name: "New development plan", exact: true })
          .tap();
        await p.getByText("Plan audience:", { exact: false }).first().waitFor();
        assert(
          await p
            .getByRole("button", { name: "Save development plan", exact: true })
            .isDisabled(),
        );
      });
      await interact("knowledge-editor", "knowledge", async (p) => {
        await p
          .getByRole("button", { name: "New guidance", exact: true })
          .tap();
        await p
          .getByText("Publication audience", { exact: false })
          .first()
          .waitFor();
        assert(
          await p
            .getByRole("button", { name: "Save guidance draft", exact: true })
            .isDisabled(),
        );
      });
    }
    await context.close();
    console.log(
      profile,
      "complete",
      results.cases.filter((r) => r.profile === profile && r.status === "PASS")
        .length,
      "PASS",
      results.cases.filter((r) => r.profile === profile && r.status !== "PASS")
        .length,
      "FAIL",
    );
  }
} catch (e) {
  results.setupError = e.stack;
  process.exitCode = 1;
} finally {
  for (const b of Object.values(engines)) await b.close();
  results.summary = {
    passed: results.cases.filter((x) => x.status === "PASS").length,
    failed: results.cases.filter((x) => x.status !== "PASS").length,
    errors: results.errors.length,
    external: results.blockedExternalRequests.length,
  };
  results.status =
    results.setupError ||
    results.summary.failed ||
    results.summary.errors ||
    results.summary.external
      ? "FAIL"
      : "PASS";
  await writeFile(
    new URL(
      filter ? "./browser-" + filter + "-result.json" : "./browser-result.json",
      import.meta.url,
    ),
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(JSON.stringify(results.summary));
  if (results.status !== "PASS") process.exitCode = 1;
}
