# Shared brief for UI/UX improvement agents (Schach Workspace web frontend)

Worktree: /home/brahma/Projects/Schach_Workspace/.worktrees/workspace-improvements (branch improve/workspace-improvements). Frontend: frontend/src (React + Vite + plain CSS, lucide-react icons). Several agents edit different areas CONCURRENTLY.

## Live preview (already running — do NOT start/stop servers)
- Vite dev server with hot reload at http://127.0.0.1:5174 serving the worktree source, proxying /api to a DISPOSABLE fictional QA server on 127.0.0.1:9080. NEVER use port 8080 (real company data).
- Demo logins (password `SchachDemo!2026`): founder@schach.demo, ceo@schach.demo, finance@schach.demo, head@schach.demo, member@schach.demo.
- Screenshot tool: copy verification/runtime/ui_screenshots.mjs into your OWN scratch subfolder (same scratchpad dir, e.g. scratchpad/<area>/) and run: `WIDTHS=1440,390 node shots.mjs http://127.0.0.1:5174 <outdir> ceo@schach.demo <view> [view...]`. Views are hash routes: overview connect my-work tasks projects calendar workload goals finance reports people inbox settings. Extend your copy to open pop-ups/drawers/tabs (click via Runtime.evaluate on DOM selectors) and screenshot them. Read PNGs with the Read tool to SEE the result. Before-screenshots exist in scratchpad/before/.
- Fictional data may be mutated harmlessly, but prefer opening and cancelling dialogs; don't delete/archive shared demo records other agents may be viewing.

## Design direction
- Match the app's EXISTING design system — the polished parts (Overview metric cards, "Needs your attention" table, Reports page, department tables) are the reference. Reuse CSS custom properties and class patterns from frontend/src/styles.css (read it; reuse tokens like colors/radii/shadows/fonts). Do not introduce new fonts, a new accent color, gradients-for-decoration, grain, stock photos, or new dependencies.
- Many newer feature components were never styled (browser-default h2/p/buttons, raw text dumps, repeated identical rows). Bring them up to the house style: card containers, section headers with title + one-line description, proper button variants (primary/secondary/ghost as already defined), tables or compact lists for data, chips/badges for statuses, tabular numbers, utilization bars, sensible spacing, aligned rows.
- Fix information design, not just paint: group repeated warnings (e.g. "N items: <message>" with an expandable list) instead of 30 identical blocks; collapse rarely used controls behind disclosure; put primary actions where expected; show empty/loading/error states consistently; make dense text scannable.
- Responsive: must work at 390px and 320px with no horizontal page scroll (wide tables may scroll inside a container).
- Accessibility: keep/maintain labels, roles, aria attributes, focus visibility, keyboard operation, contrast ≥ 4.5:1.
- Copy: you may tighten wording for clarity, but NEVER remove or weaken disclosure/qualification text that encodes a product control (e.g. "Capacity is not attendance", "Task completion never changes an independently measured result", "advisory only", recording off, audience disclosures). You may move it into a help disclosure or caption.

## Hard rules
- Do NOT git commit/stash/reset/checkout/clean. Coordinator commits.
- Edit ONLY files in your assigned area (listed in your task) plus NEW CSS files you create (name them e.g. frontend/src/styles/<area>.css and import them from your components). Do NOT edit frontend/src/styles.css or App.tsx unless your task explicitly grants it. If you need a shared change, report it.
- No behavior changes to data/API/authorization/retry/version logic. Presentation and information architecture only.
- No `vite build` into frontend/dist (tracked). Checks: `cd frontend && npx tsc --noEmit` and `npx vitest run <your related tests>`; full `npx vitest run` at the end (other agents' in-flight edits may cause unrelated transient failures — rerun, and report any failures that are in your area). Update tests only where you intentionally changed copy/structure; never weaken assertions about controls/permissions.
- Finish with before/after screenshots of every view/pop-up you changed at 1440 and 390 and LOOK at them.

## Report (under 400 words)
Files changed/created; per view/pop-up what was wrong and what you changed; screenshot paths of after-state; test results; anything you couldn't fix or that needs a shared/global change.
